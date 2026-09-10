import { positionFor } from './animation.mjs';
const $ = id => document.getElementById(id);
const rows = { idle: 0, waiting: 6, running: 7 };
let state = 'idle';
let revision = 'iteration-01';
let frame = 0;
let generation = 0;
const cssPosition = index => `${index % 3 / 2 * 100}% ${Math.floor(index / 3) * 100}%`;

function renderFrame() {
  $('source-image').style.backgroundPosition = cssPosition(frame);
  $('source-frame').value = String(frame);
  $('source-version').textContent = `${revision === 'iteration-01' ? 'r1' : 'r2'} · ${state} · 第 ${frame + 1} 帧`;
  $('source-grid-position').textContent = `源图 row ${Math.floor(frame / 3)} · col ${frame % 3}`;
  for (const button of $('source-thumbnails').children) button.setAttribute('aria-pressed', String(Number(button.dataset.frame) === frame));
}

for (let index = 0; index < 6; index += 1) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.frame = String(index);
  button.setAttribute('aria-label', `查看源图第 ${index + 1} 格`);
  const thumbnail = document.createElement('span');
  thumbnail.className = 'source-thumbnail-image';
  thumbnail.style.backgroundPosition = cssPosition(index);
  const caption = document.createElement('small');
  caption.textContent = `第 ${index + 1} 格`;
  button.append(thumbnail, caption);
  button.addEventListener('click', () => { frame = index; renderFrame(); });
  $('source-thumbnails').append(button);
}

async function loadSource() {
  const token = ++generation;
  const path = `../assets/source/${revision}/${state}.png`;
  $('source-rejected-panel').dataset.ready = 'false';
  $('source-load-status').textContent = '读取中';
  $('source-image-error').hidden = true;
  $('source-file-link').href = path;
  for (const image of document.querySelectorAll('.source-thumbnail-image')) image.style.backgroundImage = 'none';
  $('source-original').style.backgroundPosition = positionFor({ row: rows[state], column: 0 });
  $('source-original-cell').textContent = `row ${rows[state]} · col 0`;
  renderFrame();
  try {
    const image = new Image();
    image.src = path;
    await image.decode();
    if (token !== generation) return;
    if (image.naturalWidth !== 1536 || image.naturalHeight !== 1024) throw new Error('源图尺寸不是 1536 × 1024');
    $('source-image').style.backgroundImage = `url("${path}")`;
    for (const thumbnail of document.querySelectorAll('.source-thumbnail-image')) thumbnail.style.backgroundImage = `url("${path}")`;
    $('source-rejected-panel').dataset.ready = 'true';
    $('source-load-status').textContent = 'RGB · 无 alpha';
    $('source-load-status').dataset.status = 'invalid';
  } catch (error) {
    if (token !== generation) return;
    $('source-load-status').textContent = '读取失败';
    $('source-image-error').textContent = `无法显示退回源图\n${error.message}`;
    $('source-image-error').hidden = false;
  }
}

async function loadOriginal() {
  try {
    const path = '../assets/upstream/yanami-anna/spritesheet.webp';
    const image = new Image();
    image.src = path;
    await image.decode();
    if (image.naturalWidth !== 1536 || image.naturalHeight !== 2288) throw new Error('原版图集尺寸错误');
    $('source-original').style.backgroundImage = `url("${path}")`;
    $('source-original-panel').dataset.ready = 'true';
    $('source-original-status').textContent = '原版已载入';
    $('source-original-status').dataset.status = 'ready';
  } catch (error) {
    $('source-original-status').textContent = '读取失败';
    $('source-original-error').textContent = `无法显示原版\n${error.message}`;
    $('source-original-error').hidden = false;
  }
}

$('source-state').addEventListener('change', event => { state = event.target.value; frame = 0; loadSource(); });
$('source-revision').addEventListener('change', event => { revision = event.target.value; frame = 0; loadSource(); });
$('source-frame').addEventListener('change', event => { frame = Number(event.target.value); renderFrame(); });
$('source-size').addEventListener('change', event => { $('source-comparison').style.setProperty('--sprite-width', `${Number(event.target.value)}px`); });
$('source-background').addEventListener('change', event => { $('source-comparison').dataset.background = event.target.value; });
document.addEventListener('keydown', event => {
  if (event.target.closest('input, select, textarea, button, summary')) return;
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    event.preventDefault();
    frame = (frame + (event.code === 'ArrowLeft' ? -1 : 1) + 6) % 6;
    renderFrame();
  }
});
loadOriginal();
loadSource();
