import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../catalog.mjs';
import { createInitialState, applyAction, viewState, validateState, RECENT_ACTION_LIMIT } from '../domain.mjs';

const T = 1_800_000_000_000;
const copy = (value) => JSON.parse(JSON.stringify(value));
function action(state, type, payload = {}, id = `${type}-${state.revision}`) {
  return { id, type, expectedRevision: state.revision, payload };
}
function perform(state, type, payload, now, id) { return applyAction(state, action(state, type, payload, id), now); }
function start(mode = 'trial', minutes = 15, id = 'trip-1') {
  const state = createInitialState(T);
  return perform(state, 'start', mode === 'trial' ? { mode } : { mode, minutes }, T, id).state;
}
function expectCode(callback, code, status = 409) {
  assert.throws(callback, (error) => error.code === code && error.status === status);
}

test('content matches six atlas cells, 24 lines, 12 stories and three keepsakes', () => {
  assert.deepEqual(catalog.snacks.map((item) => item.id), ['pudding', 'melonpan', 'strawberry-milk', 'onigiri', 'taiyaki', 'dango']);
  assert.deepEqual(catalog.snacks.map((item) => item.artIndex), [0, 1, 2, 3, 4, 5]);
  assert.ok(catalog.snacks.every((item) => item.lines.length === 4 && new Set(item.lines).size === 4));
  assert.equal(catalog.stories.length, 12);
  assert.equal(catalog.keepsakes.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(catalog)), catalog);
});

test('new save has one of every snack and independent JSON data', () => {
  const state = createInitialState(T);
  assert.equal(state.revision, 0);
  assert.equal(Object.values(state.inventory).reduce((a, b) => a + b), 6);
  assert.ok(Object.values(state.collection).every((entry) => entry.feedCount === 0));
  const saved = validateState(state);
  saved.inventory.pudding = 0;
  assert.equal(state.inventory.pudding, 1);
});

test('read projection becomes ready after sleep without changing stored data or revision', () => {
  const state = start();
  const original = copy(state);
  const before = viewState(state, T + 29_999);
  assert.equal(before.activeTrip.status, 'running');
  assert.equal(before.activeTrip.remainingMs, 30_000);
  const after = viewState(state, T + 10 * 60_000);
  assert.equal(after.activeTrip.status, 'ready');
  assert.equal(after.activeTrip.remainingMs, 0);
  assert.equal(after.activeTrip.deadlineAt, T + 30_000);
  assert.equal(after.revision, state.revision);
  assert.deepEqual(state, original);
  assert.deepEqual(validateState(after), after);
});

test('pause survives serialization and long sleep; resume preserves only unspent time', () => {
  let state = start('focus', 15);
  const reward = copy(state.activeTrip.reward);
  state = perform(state, 'pause', {}, T + 5 * 60_000).state;
  assert.equal(state.activeTrip.remainingMs, 10 * 60_000);
  assert.equal(state.activeTrip.deadlineAt, null);
  state = validateState(copy(state));
  state = viewState(state, T + 2 * 60 * 60_000);
  assert.equal(state.activeTrip.status, 'paused');
  state = perform(state, 'resume', {}, T + 2 * 60 * 60_000).state;
  assert.equal(state.activeTrip.deadlineAt, T + 130 * 60_000);
  assert.deepEqual(state.activeTrip.reward, reward);
  assert.equal(viewState(state, T + 129 * 60_000).activeTrip.status, 'running');
  const claimed = perform(state, 'claim', {}, T + 131 * 60_000).state;
  assert.equal(claimed.receipts[0].focusMinutes, 15);
  assert.equal(claimed.receipts[0].completedAt, T + 130 * 60_000);
});

test('trial receipt is distinct and never earns focus minutes', () => {
  const result = perform(start(), 'claim', {}, T + 30_000);
  assert.equal(result.state.receipts[0].mode, 'trial');
  assert.equal(result.state.receipts[0].durationMs, 30_000);
  assert.equal(result.state.receipts[0].focusMinutes, 0);
  assert.equal(result.state.receipts[0].quantity, 1);
});

test('each focus duration earns its fixed amount once, independent of refresh', () => {
  for (const [minutes, quantity] of [[15, 1], [25, 2], [45, 3]]) {
    const state = start('focus', minutes, `focus-${minutes}`);
    const reward = copy(state.activeTrip.reward);
    assert.deepEqual(viewState(state, T + 5).activeTrip.reward, reward);
    const result = perform(state, 'claim', {}, T + minutes * 60_000 + 1000);
    assert.equal(result.state.inventory[reward.snackId], 1 + quantity);
    assert.equal(result.state.receipts[0].focusMinutes, minutes);
    assert.equal(result.feedback.receipt.snackId, reward.snackId);
  }
});

test('double claim and a retried claim never issue a second reward', () => {
  const state = start();
  const claim = action(state, 'claim', {}, 'claim-once');
  const first = applyAction(state, claim, T + 30_000);
  const retry = applyAction(first.state, claim, T + 60_000);
  assert.deepEqual(retry.state, first.state);
  assert.deepEqual(retry.feedback, first.feedback);
  assert.equal(first.state.receipts.length, 1);
  expectCode(() => perform(first.state, 'claim', {}, T + 60_000, 'claim-twice'), 'TRIP_NOT_READY');
});

test('duplicate start is idempotent before revision conflict, with no timer reset', () => {
  const initial = createInitialState(T);
  const request = action(initial, 'start', { mode: 'trial' }, 'same-start');
  const first = applyAction(initial, request, T);
  const retry = applyAction(first.state, request, T + 5000);
  assert.deepEqual(retry.state, first.state);
  assert.deepEqual(retry.feedback, first.feedback);
  const due = applyAction(first.state, request, T + 40_000);
  assert.equal(due.state.activeTrip.status, 'ready');
  assert.equal(due.state.revision, 1);
});

test('same action ID with a different intent is rejected', () => {
  const initial = createInitialState(T);
  const first = perform(initial, 'feed', { snackId: 'pudding' }, T, 'same-id').state;
  expectCode(() => perform(first, 'feed', { snackId: 'dango' }, T, 'same-id'), 'ACTION_ID_CONFLICT');
});

test('JSON field order does not change a saved request or its idempotency identity', () => {
  const initial = createInitialState(T);
  const request = action(initial, 'start', { minutes: 15, mode: 'focus' }, 'ordered-request');
  const first = applyAction(initial, request, T);
  const reordered = copy(first.state);
  reordered.recentActions[0].payload = { minutes: 15, mode: 'focus' };
  assert.deepEqual(validateState(reordered), reordered);
  assert.equal(applyAction(reordered, request, T + 1).state.revision, 1);
});

test('stale window is rejected before the now-empty inventory check', () => {
  const initial = createInitialState(T);
  const stale = action(initial, 'feed', { snackId: 'pudding' }, 'stale');
  const state = perform(initial, 'feed', { snackId: 'pudding' }, T).state;
  expectCode(() => applyAction(state, stale, T), 'REVISION_CONFLICT');
  expectCode(() => perform(state, 'feed', { snackId: 'pudding' }, T), 'OUT_OF_STOCK');
  assert.equal(state.inventory.pudding, 0);
});

test('feeding consumes one and records first/latest, while repeats preserve one consumption', () => {
  const initial = createInitialState(T);
  const request = action(initial, 'feed', { snackId: 'pudding' }, 'first-taste');
  const first = applyAction(initial, request, T + 100);
  const again = applyAction(first.state, request, T + 200);
  assert.deepEqual(again, first);
  assert.deepEqual(first.state.collection.pudding, { feedCount: 1, firstFedAt: T + 100, lastFedAt: T + 100, lastLineIndex: 0 });
  assert.equal(first.state.feeds[0].firstTime, true);
  assert.equal(first.feedback.message, catalog.snacks[0].lines[0]);
});

test('replenishing and feeding the same snack rotates all four lines without adjacent repeats', () => {
  let state = createInitialState(T);
  let now = T;
  const seen = [];
  // Every trip supplies a known snack. Consume it repeatedly as its inventory permits.
  for (let n = 0; n < 40; n++) {
    state = perform(state, 'start', { mode: 'trial' }, now, `supply-${n}`).state;
    const id = state.activeTrip.reward.snackId;
    now += 30_000;
    state = perform(state, 'claim', {}, now).state;
    while (state.inventory[id] > 0) {
      const result = perform(state, 'feed', { snackId: id }, now);
      state = result.state;
      if (id === 'pudding') seen.push(result.feedback.lineIndex);
    }
  }
  assert.ok(seen.length >= 4);
  assert.deepEqual(seen, seen.map((_, index) => index % 4));
  assert.deepEqual(validateState(state), state);
});

test('canceling a running, paused or ready trip changes neither inventory nor receipts', () => {
  for (const status of ['running', 'paused', 'ready']) {
    let state = start();
    if (status === 'paused') state = perform(state, 'pause', {}, T + 1000).state;
    if (status === 'ready') state = viewState(state, T + 30_000);
    const canceled = perform(state, 'cancel', {}, T + 30_000).state;
    assert.equal(canceled.activeTrip, null);
    assert.equal(canceled.receipts.length, 0);
    assert.deepEqual(canceled.inventory, createInitialState(T).inventory);
  }
});

test('cannot pause a trip already due or claim early even if a status was edited to ready', () => {
  const state = start();
  expectCode(() => perform(state, 'pause', {}, T + 30_000), 'TRIP_NOT_RUNNING');
  expectCode(() => perform(state, 'claim', {}, T + 29_999), 'TRIP_NOT_READY');
  const edited = copy(state);
  edited.activeTrip.status = 'ready';
  edited.activeTrip.remainingMs = 0;
  expectCode(() => perform(edited, 'claim', {}, T + 29_999), 'TRIP_NOT_READY');
});

test('settings persist, deduplication is bounded and old request revisions remain stale', () => {
  let state = createInitialState(T);
  const oldest = action(state, 'settings', { reducedMotion: true }, 'oldest');
  state = applyAction(state, oldest, T).state;
  for (let i = 1; i <= RECENT_ACTION_LIMIT + 1; i++) state = perform(state, 'settings', { reducedMotion: i % 2 === 0 }, T + i).state;
  assert.equal(state.recentActions.length, RECENT_ACTION_LIMIT);
  assert.equal(state.recentActions.some((entry) => entry.id === 'oldest'), false);
  assert.equal(state.recentActions.at(-1).appliedRevision, state.revision);
  expectCode(() => applyAction(state, oldest, T + 1000), 'REVISION_CONFLICT');
  assert.equal(validateState(copy(state)).settings.reducedMotion, false);
});

test('rejects corrupt saves: inventory, fixed reward, unknown fields and collection ledger', () => {
  const cases = [];
  let changed = createInitialState(T); changed.inventory.pudding = 99; cases.push(changed);
  changed = createInitialState(T); changed.inventory.pudding = -1; cases.push(changed);
  changed = createInitialState(T); changed.extra = true; cases.push(changed);
  changed = createInitialState(T); changed.collection.pudding.feedCount = 1; cases.push(changed);
  changed = start(); changed.activeTrip.reward.quantity = 3; cases.push(changed);
  changed = start(); changed.activeTrip.durationMs = 1; cases.push(changed);
  changed = start(); changed.recentActions[0].appliedRevision = 99; cases.push(changed);
  changed = perform(start(), 'claim', {}, T + 30_000).state; changed.receipts[0].focusMinutes = 1; cases.push(changed);
  changed = perform(start(), 'claim', {}, T + 30_000).state; changed.recentActions.at(-1).feedback.receipt.quantity = 99; cases.push(changed);
  for (const bad of cases) expectCode(() => validateState(bad), 'INVALID_STATE', 400);
});

test('rejects malformed actions and unsupported intervals without mutating input', () => {
  const state = createInitialState(T);
  const original = copy(state);
  for (const request of [
    action(state, 'start', { mode: 'focus', minutes: 1 }),
    action(state, 'start', { mode: 'trial', minutes: 15 }),
    action(state, 'feed', { snackId: '__proto__' }),
    action(state, 'settings', { reducedMotion: 'true' }),
    { ...action(state, 'cancel'), extra: true },
    { ...action(state, 'cancel'), id: '' },
  ]) expectCode(() => applyAction(state, request, T), 'INVALID_ACTION', 400);
  assert.deepEqual(state, original);
});

test('successful changes and failed transitions do not mutate input', () => {
  const state = start();
  const original = copy(state);
  perform(state, 'pause', {}, T + 500);
  expectCode(() => perform(state, 'resume', {}, T + 500), 'TRIP_NOT_PAUSED');
  assert.deepEqual(state, original);
});
