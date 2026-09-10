import { ATLAS, STATES, scheduleFor, frameAt, timeAtIndex, directionFrame, positionFor } from './animation.mjs';

const $ = id => document.getElementById(id);
const stateSelect = $('state');
const directionSelect = $('direction');
const comparison = $('comparison');
const sourcePaths = {
  upstream: '../assets/upstream/yanami-anna/spritesheet.webp',
  candidate: '../pets/yanami-anna-refined/spritesheet.webp',
};
let selected = 'idle';
let view = 'animation';
let mode = 'native';
let direction = 0;
let elapsed = 0;
let speed = 1;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let schedule = scheduleFor(selected, mode);
let lastTimestamp = null;
let lastRender = '';
let stripKey = '';
let loadGeneration = 0;
const objectUrls = new Map();

for (const state of STATES) stateSelect.add(new Option(`${state.label} · ${state.id}`, state.id));
for (let i = 0; i < 16; i += 1) {
  const cardinal = { 0: '上', 4: '右', 8: '下', 12: '左' }[i];
  directionSelect.add(new Option(`${i * 22.5}°${cardinal ? ` · ${cardinal}` : ''}`, String(i)));
}

const requestedRevision = new URLSearchParams(location.search).get('revision');
if (requestedRevision) $('revision').value = requestedRevision.slice(0, 80);
function updateRevision() {
  $('revision-label').textContent = $('revision').value.trim() || '未标注';
}
$('revision').addEventListener('input', updateRevision);
updateRevision();

function updateControls() {
  const animation = view === 'animation';
  $('state-control').hidden = !animation;
  $('direction-control').hidden = animation;
  $('mode-control').hidden = !animation;
  $('speed-control').hidden = !animation;
  $('play').disabled = !animation || mode === 'reduced';
  $('restart').disabled = !animation || mode === 'reduced';
  $('play').textContent = playing && animation && mode !== 'reduced' ? '暂停' : '播放';
  $('previous').disabled = animation && mode === 'reduced';
  $('next').disabled = animation && mode === 'reduced';
}

function restart(autoplay = playing) {
  schedule = scheduleFor(selected, mode);
  elapsed = 0;
  lastTimestamp = null;
  lastRender = '';
  playing = autoplay && view === 'animation' && mode !== 'reduced';
  updateControls();
  render();
}

function setPlaying(value) {
  playing = value && view === 'animation' && mode !== 'reduced';
  lastTimestamp = null;
  updateControls();
}

function seek(index) {
  setPlaying(false);
  if (view === 'direction') {
    direction = index;
    directionSelect.value = String(index);
  } else {
    // Timeline buttons address the visible lane, including idle after the introduction.
    const current = frameAt(schedule, elapsed);
    const laneStart = current.row === 0 && selected !== 'idle' && mode === 'native' ? schedule.loopStart : 0;
    elapsed = timeAtIndex(schedule, laneStart + index);
  }
  render();
}

function step(delta) {
  setPlaying(false);
  if (view === 'direction') {
    direction = (direction + delta + 16) % 16;
    directionSelect.value = String(direction);
  } else {
    const current = frameAt(schedule, elapsed);
    const count = schedule.frames.length;
    let next = current.index + delta;
    if (next >= count) next = schedule.loopStart;
    if (next < 0) next = count - 1;
    elapsed = timeAtIndex(schedule, next);
  }
  render();
}

function buildStrip(frame) {
  const state = view === 'direction' ? null : STATES.find(item => item.frames[0].row === frame.row);
  const key = view === 'direction' ? 'directions' : `${state.id}:${mode}`;
  if (stripKey === key) return;
  stripKey = key;
  $('frame-strip').replaceChildren();
  const frames = view === 'direction' ? Array.from({ length: 16 }, (_, index) => directionFrame(index)) : mode === 'reduced' ? [state.frames[0]] : state.frames;
  frames.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.frame = String(index);
    button.setAttribute('aria-label', view === 'direction' ? `查看 ${index * 22.5} 度朝向` : `查看第 ${index + 1} 帧`);
    button.textContent = view === 'direction' ? `${index * 22.5}°` : `${index + 1}`;
    if (view === 'animation') {
      const duration = document.createElement('small');
      duration.textContent = mode === 'reduced' ? '静止' : `${item.duration} ms`;
      button.append(duration);
    }
    button.addEventListener('click', () => seek(index));
    $('frame-strip').append(button);
  });
}

function render() {
  const frame = view === 'direction' ? directionFrame(direction) : frameAt(schedule, elapsed);
  const signature = `${view}:${mode}:${selected}:${frame.row}:${frame.column}:${frame.index}`;
  if (lastRender === signature) return;
  lastRender = signature;
  const state = STATES.find(item => item.frames[0].row === frame.row);
  const cellLabel = `row ${frame.row} · col ${frame.column}`;
  for (const name of Object.keys(sourcePaths)) {
    $(name + '-sprite').style.backgroundPosition = positionFor(frame);
    $(name + '-sprite').dataset.row = String(frame.row);
    $(name + '-sprite').dataset.column = String(frame.column);
    $(name + '-cell').textContent = cellLabel;
  }
  buildStrip(frame);
  for (const button of $('frame-strip').children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.frame) === (view === 'direction' ? direction : frame.column)));
  }
  if (view === 'direction') {
    $('frame-info').textContent = `${direction * 22.5}° · 方向 ${direction + 1} / 16`;
    $('playback-note').textContent = '朝向审阅：固定姿势，不播放动画。0° 向上，顺时针增加；方向帧会覆盖状态帧。';
  } else {
    $('frame-info').textContent = `${state.label} · 帧 ${frame.column + 1} / ${mode === 'reduced' ? 1 : state.frames.length} · ${mode === 'reduced' ? '静止' : `${frame.duration} ms`}`;
    if (mode === 'reduced') $('playback-note').textContent = '减少动态模拟：保持所选状态的第 0 格；不影响动画 WebP 自身时钟。';
    else if (mode === 'loop') $('playback-note').textContent = '循环审阅：持续重复当前动作，便于检查衔接。此模式不是原生非 idle 行为。';
    else if (selected === 'idle') $('playback-note').textContent = '原生时序：待机 6 帧持续循环；已应用 idle 的 6 倍时长，单轮 6.60 秒。';
    else if (frame.row === 0) $('playback-note').textContent = '原生时序：所选动作已完成 3 轮，当前回到待机。可点“从头播放”重新触发。';
    else $('playback-note').textContent = `原生时序：当前第 ${Math.floor(frame.index / STATES.find(item => item.id === selected).frames.length) + 1} / 3 轮；随后进入待机循环。逐帧按钮沿完整序列移动。`;
  }
}

async function loadAssets() {
  const generation = ++loadGeneration;
  $('reload-assets').disabled = true;
  await Promise.all(Object.entries(sourcePaths).map(async ([name, path]) => {
    const panel = $(name + '-panel');
    const status = $(name + '-status');
    const message = $(name + '-message');
    status.textContent = '读取中';
    status.dataset.status = 'loading';
    panel.dataset.ready = 'false';
    message.hidden = true;
    let temporaryUrl;
    try {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 404 ? 'missing' : `HTTP ${response.status}`);
      temporaryUrl = URL.createObjectURL(await response.blob());
      const image = new Image();
      image.src = temporaryUrl;
      await image.decode();
      if (generation !== loadGeneration) return;
      if (image.naturalWidth !== ATLAS.width || image.naturalHeight !== ATLAS.height) {
        throw new Error(`尺寸不符：${image.naturalWidth} × ${image.naturalHeight}\n应为 1536 × 2288`);
      }
      if (objectUrls.has(name)) URL.revokeObjectURL(objectUrls.get(name));
      objectUrls.set(name, temporaryUrl);
      $(name + '-sprite').style.backgroundImage = `url("${temporaryUrl}")`;
      temporaryUrl = null;
      panel.dataset.ready = 'true';
      status.dataset.status = 'ready';
      status.textContent = '素材已载入';
    } catch (error) {
      if (generation !== loadGeneration) return;
      const missing = error.message === 'missing';
      status.dataset.status = missing ? 'missing' : 'invalid';
      status.textContent = missing ? '素材缺失' : '无法预览';
      message.textContent = missing
        ? name === 'candidate' ? '候选素材尚未生成\n生成精修版后，点击“重新读取素材”。' : '找不到原版素材\n请从仓库根目录启动 HTTP 服务。'
        : `素材读取失败\n${error.message}\n请确认通过本地 HTTP 服务打开。`;
      message.hidden = false;
    } finally {
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    }
  }));
  if (generation === loadGeneration) $('reload-assets').disabled = false;
}

$('view').addEventListener('change', event => { view = event.target.value; restart(view === 'animation' && playing); });
stateSelect.addEventListener('change', event => { selected = event.target.value; restart(); });
directionSelect.addEventListener('change', event => { direction = Number(event.target.value); render(); });
$('mode').addEventListener('change', event => { mode = event.target.value; restart(); });
$('speed').addEventListener('change', event => { speed = Number(event.target.value); lastTimestamp = null; });
$('play').addEventListener('click', () => setPlaying(!playing));
$('restart').addEventListener('click', () => restart(true));
$('previous').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));
$('background').addEventListener('change', event => { comparison.dataset.background = event.target.value; });
$('size').addEventListener('change', event => { comparison.style.setProperty('--sprite-width', `${Number(event.target.value)}px`); });
$('grid').addEventListener('change', event => { comparison.classList.toggle('show-grid', event.target.checked); });
$('baseline').addEventListener('change', event => { comparison.classList.toggle('show-baseline', event.target.checked); $('baseline-control').hidden = !event.target.checked; });
$('baseline-y').addEventListener('input', event => {
  const value = Number(event.target.value);
  if (Number.isFinite(value)) comparison.style.setProperty('--baseline', `${Math.min(208, Math.max(0, value)) / 208 * 100}%`);
});
$('reload-assets').addEventListener('click', loadAssets);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
document.addEventListener('keydown', event => {
  if (event.target.closest('input, select, textarea, button, summary')) return;
  if (event.code === 'Space' && view === 'animation' && mode !== 'reduced') { event.preventDefault(); setPlaying(!playing); }
  if (event.code === 'ArrowLeft' && !(view === 'animation' && mode === 'reduced')) { event.preventDefault(); step(-1); }
  if (event.code === 'ArrowRight' && !(view === 'animation' && mode === 'reduced')) { event.preventDefault(); step(1); }
});

function tick(timestamp) {
  if (playing && view === 'animation' && mode !== 'reduced' && lastTimestamp !== null) {
    elapsed += (timestamp - lastTimestamp) * speed;
    render();
  }
  lastTimestamp = timestamp;
  requestAnimationFrame(tick);
}
updateControls();
render();
loadAssets();
requestAnimationFrame(tick);
