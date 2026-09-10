import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPending, savePending, clearPending, uncertainResponse } from '../client-action.mjs';
import { applyAction, createInitialState } from '../domain.mjs';

const NOW = Date.UTC(2026, 8, 10, 10);
const feed = { id: 'preserve-this-id', type: 'feed', expectedRevision: 0, payload: { snackId: 'pudding' } };
function storageFixture() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test('lost response keeps the exact action and same-id retry consumes only one snack', () => {
  const storage = storageFixture();
  savePending(storage, feed);
  const committed = applyAction(createInitialState(NOW), feed, NOW);
  // The response was lost; there is no trustworthy HTTP status to resolve it.
  assert.equal(uncertainResponse(undefined), true);
  const retry = loadPending(storage);
  assert.deepEqual(retry, feed);
  const confirmed = applyAction(committed.state, retry, NOW + 1);
  assert.equal(confirmed.state.inventory.pudding, 0);
  assert.equal(confirmed.state.feeds.length, 1);
  assert.deepEqual(confirmed.feedback, committed.feedback);
  clearPending(storage);
  assert.equal(loadPending(storage), null);
});

test('503 after an actual commit stays pending and can recover the original feedback', () => {
  const storage = storageFixture();
  savePending(storage, feed);
  const committed = applyAction(createInitialState(NOW), feed, NOW);
  // Matches store's main-rename-success / later-sync-failure branch.
  if (!uncertainResponse(503)) clearPending(storage);
  const pending = loadPending(storage);
  assert.ok(pending);
  const retried = applyAction(committed.state, pending, NOW + 10);
  assert.equal(retried.state.revision, 1);
  assert.equal(retried.state.feeds.length, 1);
  assert.equal(retried.feedback.message, committed.feedback.message);
});

test('refresh recovers a detached action from session storage, including frozen revision', () => {
  const storage = storageFixture();
  const original = { id: 'refresh-start', type: 'start', expectedRevision: 17, payload: { minutes: 45, mode: 'focus' } };
  savePending(storage, original);
  original.payload.minutes = 15;
  // A new application instance reads the same storage; no React state is required.
  const recovered = loadPending(storage);
  assert.equal(recovered.expectedRevision, 17);
  assert.equal(recovered.payload.minutes, 45);
  recovered.payload.minutes = 25;
  assert.equal(loadPending(storage).payload.minutes, 45);
});

test('storage denial or a silent write failure prevents a send from being reached', () => {
  const denied = storageFixture();
  denied.setItem = () => { throw new Error('Quota exceeded'); };
  let sent = false;
  assert.throws(() => { savePending(denied, feed); sent = true; }, /Quota exceeded/);
  assert.equal(sent, false);
  const silent = storageFixture();
  silent.setItem = () => {};
  assert.throws(() => { savePending(silent, feed); sent = true; }, { code: 'PENDING_STORAGE_UNAVAILABLE' });
  assert.equal(sent, false);
});

test('corrupt, oversized and invalid pending JSON is reported and preserved', () => {
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...feed, payload: { snackId: 'unknown' } }), JSON.stringify({ ...feed, expectedRevision: -1 }), ' '.repeat(4097)]) {
    const storage = storageFixture();
    savePending(storage, feed);
    const [key] = storage.values.keys();
    storage.values.set(key, raw);
    assert.throws(() => loadPending(storage), { code: 'INVALID_PENDING_ACTION' });
    assert.equal(storage.values.get(key), raw);
  }
});

test('invalid actions never overwrite a valid pending operation', () => {
  const storage = storageFixture();
  savePending(storage, feed);
  for (const invalid of [null, [], { ...feed, extra: true }, { ...feed, id: '' }, { ...feed, type: 'pause', payload: { minutes: 2 } }, { ...feed, type: 'settings', payload: { reducedMotion: 'true' } }, { ...feed, type: 'start', payload: { mode: 'trial', minutes: 15 } }]) {
    assert.throws(() => savePending(storage, invalid), { code: 'INVALID_PENDING_ACTION' });
    assert.deepEqual(loadPending(storage), feed);
  }
  assert.throws(() => savePending(storage, { ...feed, id: 'another-valid-action' }), { code: 'PENDING_ACTION_EXISTS' });
  assert.deepEqual(loadPending(storage), feed);
});

test('definitive rejection can clear a journal; uncertain statuses cannot', () => {
  for (const status of [200, 201, 204, 400, 403, 409, 413, 415, 421]) assert.equal(uncertainResponse(status), false, String(status));
  for (const status of [undefined, null, 0, 101, 302, 408, 500, 503, 504, '200', NaN]) assert.equal(uncertainResponse(status), true, String(status));
  const storage = storageFixture();
  savePending(storage, feed);
  if (!uncertainResponse(409)) clearPending(storage);
  assert.equal(loadPending(storage), null);
});

test('unavailable reads or removal failures surface instead of claiming there is no pending action', () => {
  assert.throws(() => loadPending(null), { code: 'PENDING_STORAGE_UNAVAILABLE' });
  const storage = storageFixture();
  savePending(storage, feed);
  storage.removeItem = () => {};
  assert.throws(() => clearPending(storage), { code: 'PENDING_STORAGE_UNAVAILABLE' });
  assert.deepEqual(loadPending(storage), feed);
  storage.getItem = () => { throw new Error('Storage disabled'); };
  assert.throws(() => loadPending(storage), /Storage disabled/);
});
