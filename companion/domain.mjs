import { catalog } from './catalog.mjs';

const SNACK_IDS = catalog.snacks.map(({ id }) => id);
const ACTION_TYPES = ['start', 'pause', 'resume', 'cancel', 'claim', 'feed', 'settings'];
const FOCUS_MINUTES = [15, 25, 45];
export const RECENT_ACTION_LIMIT = 128;
const MAX_TIME = 8_640_000_000_000_000;

export class DomainError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) { throw new DomainError(code, message, status); }
function ensure(condition, message) { if (!condition) fail('INVALID_STATE', message); }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function keys(value, expected, label) {
  ensure(plain(value), `${label} 必须是普通对象。`);
  const actual = Object.keys(value).sort();
  ensure(actual.length === expected.length && actual.every((key, i) => key === [...expected].sort()[i]), `${label} 字段不完整或包含未知字段。`);
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function time(value) { return integer(value, 0, MAX_TIME); }
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function same(a, b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
function snack(id) { return catalog.snacks.find((item) => item.id === id); }
function checkNow(now) { if (!time(now)) fail('INVALID_TIME', '时间必须是有效的毫秒时间戳。'); }

function normalizeIntent(type, payload) {
  if (!ACTION_TYPES.includes(type)) fail('INVALID_ACTION', '不支持这个操作。');
  if (!plain(payload)) fail('INVALID_ACTION', '操作内容必须是对象。');
  const hasExactly = (expected) => {
    if (Object.keys(payload).length !== expected.length || expected.some((key) => !Object.hasOwn(payload, key))) {
      fail('INVALID_ACTION', '操作内容包含缺失或未知字段。');
    }
  };
  if (type === 'start') {
    if (payload.mode === 'trial') { hasExactly(['mode']); return { mode: 'trial' }; }
    hasExactly(['mode', 'minutes']);
    if (payload.mode !== 'focus' || !FOCUS_MINUTES.includes(payload.minutes)) fail('INVALID_ACTION', '请选择 15、25 或 45 分钟专注，或 30 秒体验。');
    return { mode: 'focus', minutes: payload.minutes };
  }
  if (type === 'feed') {
    hasExactly(['snackId']);
    if (!SNACK_IDS.includes(payload.snackId)) fail('INVALID_ACTION', '没有这种点心。');
    return { snackId: payload.snackId };
  }
  if (type === 'settings') {
    hasExactly(['reducedMotion']);
    if (typeof payload.reducedMotion !== 'boolean') fail('INVALID_ACTION', '减少动态设置必须为开或关。');
    return { reducedMotion: payload.reducedMotion };
  }
  hasExactly([]);
  return {};
}

function validateAction(action) {
  if (!plain(action) || Object.keys(action).length !== 4 || !['id', 'type', 'expectedRevision', 'payload'].every((key) => Object.hasOwn(action, key))) {
    fail('INVALID_ACTION', '操作必须包含 id、type、expectedRevision 和 payload。');
  }
  if (!identifier(action.id) || !integer(action.expectedRevision)) fail('INVALID_ACTION', '操作编号或版本无效。');
  return { id: action.id, type: action.type, expectedRevision: action.expectedRevision, payload: normalizeIntent(action.type, action.payload) };
}

// Deterministic variety, not a security primitive. The full reward is saved at start.
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
  return value;
}
function rewardFor(id, startedAt, mode, durationMs) {
  const seed = `${id}|${startedAt}|${mode}|${durationMs}`;
  return {
    snackId: SNACK_IDS[hash(`${seed}|snack`) % SNACK_IDS.length],
    quantity: mode === 'trial' ? 1 : ({ 15: 1, 25: 2, 45: 3 })[durationMs / 60_000],
    storyId: catalog.stories[hash(`${seed}|story`) % catalog.stories.length].id,
    keepsakeId: hash(`${seed}|sticker-chance`) % 3 === 0 ? catalog.keepsakes[hash(`${seed}|sticker`) % catalog.keepsakes.length].id : null,
  };
}
function durationValid(mode, durationMs) {
  return mode === 'trial' ? durationMs === 30_000 : mode === 'focus' && FOCUS_MINUTES.includes(durationMs / 60_000);
}
function validateReward(value, expected, label) {
  keys(value, ['snackId', 'quantity', 'storyId', 'keepsakeId'], label);
  ensure(SNACK_IDS.includes(value.snackId) && integer(value.quantity, 1, 3), `${label} 点心或数量无效。`);
  ensure(catalog.stories.some((item) => item.id === value.storyId), `${label} 见闻无效。`);
  ensure(value.keepsakeId === null || catalog.keepsakes.some((item) => item.id === value.keepsakeId), `${label} 贴纸无效。`);
  ensure(['snackId', 'quantity', 'storyId', 'keepsakeId'].every((key) => value[key] === expected[key]), `${label} 与开始时的固定结果不一致。`);
}

export function createInitialState(now) {
  checkNow(now);
  return {
    schemaVersion: 1, revision: 0, createdAt: now, updatedAt: now,
    inventory: Object.fromEntries(SNACK_IDS.map((id) => [id, 1])),
    collection: Object.fromEntries(SNACK_IDS.map((id) => [id, { feedCount: 0, firstFedAt: null, lastFedAt: null, lastLineIndex: null }])),
    receipts: [], feeds: [], activeTrip: null, settings: { reducedMotion: false }, recentActions: [],
  };
}

/** Validate a JSON save by schema, fixed rewards and inventory/collection ledgers.
 * This detects malformed/inconsistent edits; an unsigned local save is not an anti-cheat system.
 * Returns an independent JSON copy and never mutates the caller's object.
 */
export function validateState(value) {
  try { return validateSavedState(value); }
  catch (error) {
    if (error instanceof DomainError && error.code === 'INVALID_STATE') throw error;
    fail('INVALID_STATE', '存档内容损坏或格式无效。');
  }
}

function validateSavedState(value) {
  keys(value, ['schemaVersion', 'revision', 'createdAt', 'updatedAt', 'inventory', 'collection', 'receipts', 'feeds', 'activeTrip', 'settings', 'recentActions'], '存档');
  ensure(value.schemaVersion === 1, '不支持此存档版本。');
  ensure(integer(value.revision) && time(value.createdAt) && time(value.updatedAt) && value.updatedAt >= value.createdAt, '存档版本或时间无效。');
  keys(value.inventory, SNACK_IDS, '库存');
  keys(value.collection, SNACK_IDS, '收藏');
  keys(value.settings, ['reducedMotion'], '设置');
  ensure(typeof value.settings.reducedMotion === 'boolean', '设置无效。');
  ensure(Array.isArray(value.receipts) && Array.isArray(value.feeds) && Array.isArray(value.recentActions), '记录必须是数组。');
  ensure(value.receipts.length + value.feeds.length <= value.revision, '记录数量与存档版本不一致。');
  const expectedInventory = Object.fromEntries(SNACK_IDS.map((id) => [id, 1]));
  const expectedCollection = createInitialState(value.createdAt).collection;
  const tripIds = new Set();
  const feedIds = new Set();
  let previousClaim = value.createdAt;
  for (const receipt of value.receipts) {
    keys(receipt, ['id', 'tripId', 'mode', 'focusMinutes', 'durationMs', 'startedAt', 'completedAt', 'claimedAt', 'snackId', 'quantity', 'storyId', 'keepsakeId'], '小票');
    ensure(identifier(receipt.tripId) && receipt.id === receipt.tripId && !tripIds.has(receipt.tripId), '小票编号重复或无效。');
    tripIds.add(receipt.tripId);
    ensure(durationValid(receipt.mode, receipt.durationMs), '小票模式或时长无效。');
    ensure(receipt.focusMinutes === (receipt.mode === 'trial' ? 0 : receipt.durationMs / 60_000), '体验采购不能计入专注分钟。');
    ensure([receipt.startedAt, receipt.completedAt, receipt.claimedAt].every(time)
      && receipt.startedAt >= value.createdAt && receipt.completedAt >= receipt.startedAt + receipt.durationMs
      && receipt.claimedAt >= receipt.completedAt && receipt.claimedAt >= previousClaim && receipt.claimedAt <= value.updatedAt, '小票时间顺序无效。');
    previousClaim = receipt.claimedAt;
    validateReward({ snackId: receipt.snackId, quantity: receipt.quantity, storyId: receipt.storyId, keepsakeId: receipt.keepsakeId }, rewardFor(receipt.tripId, receipt.startedAt, receipt.mode, receipt.durationMs), '小票结果');
    expectedInventory[receipt.snackId] += receipt.quantity;
  }
  let previousFeed = value.createdAt;
  for (const feed of value.feeds) {
    keys(feed, ['id', 'snackId', 'at', 'lineIndex', 'firstTime'], '投喂记录');
    ensure(identifier(feed.id) && !feedIds.has(feed.id) && SNACK_IDS.includes(feed.snackId), '投喂编号或点心无效。');
    feedIds.add(feed.id);
    ensure(time(feed.at) && feed.at >= previousFeed && feed.at <= value.updatedAt, '投喂时间无效。');
    previousFeed = feed.at;
    const entry = expectedCollection[feed.snackId];
    const nextLine = ((entry.lastLineIndex ?? -1) + 1) % snack(feed.snackId).lines.length;
    ensure(feed.lineIndex === nextLine && feed.firstTime === (entry.feedCount === 0), '投喂台词或首次记录不一致。');
    entry.feedCount++;
    entry.firstFedAt ??= feed.at;
    entry.lastFedAt = feed.at;
    entry.lastLineIndex = feed.lineIndex;
    expectedInventory[feed.snackId]--;
  }
  for (const id of SNACK_IDS) {
    ensure(integer(value.inventory[id]) && value.inventory[id] === expectedInventory[id], '库存与采购、投喂记录不一致。');
    keys(value.collection[id], ['feedCount', 'firstFedAt', 'lastFedAt', 'lastLineIndex'], '点心收藏');
    ensure(Object.keys(expectedCollection[id]).every((key) => value.collection[id][key] === expectedCollection[id][key]), '收藏与投喂记录不一致。');
  }
  if (value.activeTrip !== null) {
    const trip = value.activeTrip;
    keys(trip, ['id', 'mode', 'status', 'durationMs', 'remainingMs', 'deadlineAt', 'startedAt', 'reward'], '当前采购');
    ensure(value.revision > 0 && identifier(trip.id) && !tripIds.has(trip.id), '当前采购编号无效或已领取。');
    ensure(durationValid(trip.mode, trip.durationMs) && ['running', 'paused', 'ready'].includes(trip.status), '采购模式、时长或状态无效。');
    ensure(time(trip.startedAt) && trip.startedAt >= value.createdAt && trip.startedAt <= value.updatedAt, '采购开始时间无效。');
    ensure(integer(trip.remainingMs, trip.status === 'ready' ? 0 : 1, trip.durationMs), '采购剩余时间无效。');
    if (trip.status === 'paused') ensure(trip.deadlineAt === null, '暂停采购不能继续计时。');
    else ensure(time(trip.deadlineAt) && trip.deadlineAt >= trip.startedAt + trip.durationMs, '采购截止时间无效。');
    if (trip.status === 'ready') ensure(trip.remainingMs === 0, '已归来采购的剩余时间必须为零。');
    validateReward(trip.reward, rewardFor(trip.id, trip.startedAt, trip.mode, trip.durationMs), '当前采购结果');
  }
  ensure(value.recentActions.length === Math.min(value.revision, RECENT_ACTION_LIMIT), '操作去重记录长度不一致。');
  const actionIds = new Set();
  value.recentActions.forEach((record, index) => {
    keys(record, ['id', 'type', 'payload', 'appliedRevision', 'feedback'], '操作记录');
    ensure(identifier(record.id) && !actionIds.has(record.id), '操作编号重复或无效。');
    actionIds.add(record.id);
    ensure(record.appliedRevision === value.revision - value.recentActions.length + index + 1, '操作版本顺序无效。');
    ensure(same(record.payload, normalizeIntent(record.type, record.payload)), '操作内容无效。');
    validateFeedback(record.feedback, record.type);
    if (record.type === 'claim') {
      const receipt = value.receipts.find((item) => item.tripId === record.feedback.receipt.tripId);
      ensure(receipt && same(record.feedback.receipt, receipt), '领取反馈与小票不一致。');
    }
    if (record.type === 'feed') {
      const feed = value.feeds.find((item) => item.id === record.id);
      ensure(feed && feed.snackId === record.payload.snackId && record.feedback.snackId === feed.snackId && record.feedback.lineIndex === feed.lineIndex, '投喂操作与记录不一致。');
    }
  });
  return clone(value);
}

function validateFeedback(feedback, type) {
  const extra = type === 'feed' ? ['snackId', 'lineIndex'] : type === 'claim' ? ['receipt'] : [];
  keys(feedback, ['kind', 'title', 'message', ...extra], '操作反馈');
  ensure(feedback.kind === type && ['title', 'message'].every((key) => typeof feedback[key] === 'string' && feedback[key].length > 0 && feedback[key].length <= 500), '操作反馈无效。');
  if (type === 'feed') ensure(SNACK_IDS.includes(feedback.snackId) && integer(feedback.lineIndex, 0, 3) && feedback.message === snack(feedback.snackId).lines[feedback.lineIndex], '投喂反馈无效。');
  if (type === 'claim') {
    const receipt = feedback.receipt;
    ensure(plain(receipt) && identifier(receipt.tripId), '领取反馈无效。');
    // The enclosing save validator also requires equality with a validated ledger receipt.
  }
}

function project(state, now) {
  const trip = state.activeTrip;
  if (trip?.status === 'running' && now >= trip.deadlineAt) {
    trip.status = 'ready';
    trip.remainingMs = 0;
  }
  return state;
}

/** Read projection only: reaching a deadline is not a persisted user mutation. */
export function viewState(state, now) {
  checkNow(now);
  return project(validateState(state), now);
}

function feedback(kind, title, message, extra = {}) { return { kind, title, message, ...extra }; }

export function applyAction(inputState, inputAction, now) {
  checkNow(now);
  const state = validateState(inputState);
  const action = validateAction(inputAction);
  const previous = state.recentActions.find((record) => record.id === action.id);
  if (previous) {
    if (previous.type !== action.type || !same(previous.payload, action.payload)) fail('ACTION_ID_CONFLICT', '这个操作编号已用于另一个操作。', 409);
    return { state: project(state, now), feedback: clone(previous.feedback) };
  }
  if (action.expectedRevision !== state.revision) fail('REVISION_CONFLICT', '另一张卡片已经更新了进度，请刷新后再试。', 409);
  if (now < state.updatedAt) fail('CLOCK_MOVED_BACKWARDS', '系统时间早于最近记录，请校准时间后重试。', 409);
  project(state, now);
  const trip = state.activeTrip;
  let result;
  switch (action.type) {
    case 'start': {
      if (trip) fail('TRIP_ACTIVE', '还有一次采购正在进行或等待领取。', 409);
      if (state.receipts.some((receipt) => receipt.tripId === action.id)) fail('TRIP_ALREADY_CLAIMED', '这次采购已经领取过了。', 409);
      const { mode } = action.payload;
      const durationMs = mode === 'trial' ? 30_000 : action.payload.minutes * 60_000;
      if (!time(now + durationMs)) fail('INVALID_TIME', '采购截止时间超出有效范围。');
      state.activeTrip = { id: action.id, mode, status: 'running', durationMs, remainingMs: durationMs, deadlineAt: now + durationMs, startedAt: now, reward: rewardFor(action.id, now, mode, durationMs) };
      result = feedback('start', mode === 'trial' ? '体验采购出发了' : '采购出发了', mode === 'trial' ? '30 秒后带回一份点心；这次不计入专注分钟。' : '你安心做眼前的事，点心会在这段专注结束后带回来。');
      break;
    }
    case 'pause':
      if (trip?.status !== 'running') fail('TRIP_NOT_RUNNING', '只有正在进行的采购可以暂停。', 409);
      trip.remainingMs = Math.min(trip.durationMs, trip.deadlineAt - now);
      trip.deadlineAt = null;
      trip.status = 'paused';
      result = feedback('pause', '先歇一会儿', '剩余时间已经留好，准备好了再继续。');
      break;
    case 'resume':
      if (trip?.status !== 'paused') fail('TRIP_NOT_PAUSED', '现在没有暂停的采购。', 409);
      if (!time(now + trip.remainingMs)) fail('INVALID_TIME', '采购截止时间超出有效范围。');
      trip.deadlineAt = now + trip.remainingMs;
      trip.status = 'running';
      result = feedback('resume', '继续出发', '从刚才停下的地方接着走。');
      break;
    case 'cancel':
      if (!trip) fail('NO_ACTIVE_TRIP', '现在没有需要取消的采购。', 409);
      state.activeTrip = null;
      result = feedback('cancel', '这次先到这里', '点心抽屉没有变化，下次再一起出发。');
      break;
    case 'claim': {
      if (trip?.status !== 'ready' || now < trip.deadlineAt) fail('TRIP_NOT_READY', '点心还没有带回来。', 409);
      if (state.receipts.some((receipt) => receipt.tripId === trip.id)) fail('TRIP_ALREADY_CLAIMED', '这次采购已经领取过了。', 409);
      const receipt = { id: trip.id, tripId: trip.id, mode: trip.mode, focusMinutes: trip.mode === 'trial' ? 0 : trip.durationMs / 60_000, durationMs: trip.durationMs, startedAt: trip.startedAt, completedAt: trip.deadlineAt, claimedAt: now, ...trip.reward };
      state.inventory[receipt.snackId] += receipt.quantity;
      state.receipts.push(receipt);
      state.activeTrip = null;
      result = feedback('claim', '点心带回来了', `${snack(receipt.snackId).name} × ${receipt.quantity} 已放进抽屉。`, { receipt: clone(receipt) });
      break;
    }
    case 'feed': {
      const { snackId } = action.payload;
      if (state.inventory[snackId] < 1) fail('OUT_OF_STOCK', '这份点心已经吃完了，采购回来再试试。', 409);
      const entry = state.collection[snackId];
      const lineIndex = ((entry.lastLineIndex ?? -1) + 1) % snack(snackId).lines.length;
      const firstTime = entry.feedCount === 0;
      state.inventory[snackId]--;
      entry.feedCount++;
      entry.firstFedAt ??= now;
      entry.lastFedAt = now;
      entry.lastLineIndex = lineIndex;
      state.feeds.push({ id: action.id, snackId, at: now, lineIndex, firstTime });
      result = feedback('feed', firstTime ? '记住这份味道了' : '又是喜欢的味道', snack(snackId).lines[lineIndex], { snackId, lineIndex });
      break;
    }
    case 'settings':
      state.settings.reducedMotion = action.payload.reducedMotion;
      result = feedback('settings', '设置已保存', action.payload.reducedMotion ? '角色会安静地陪着你。' : '恢复角色的小动作。');
      break;
  }
  state.revision++;
  state.updatedAt = now;
  state.recentActions.push({ id: action.id, type: action.type, payload: action.payload, appliedRevision: state.revision, feedback: clone(result) });
  if (state.recentActions.length > RECENT_ACTION_LIMIT) state.recentActions.shift();
  return { state: validateState(state), feedback: result };
}
