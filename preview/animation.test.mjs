import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_FRAMES, STATES, scheduleFor, frameAt, directionFrame, positionFor } from './animation.mjs';

test('every state stays inside the host-required atlas cells', () => {
  assert.equal(STATES.length, 9);
  for (const state of STATES) {
    assert.equal(state.frames.length, REQUIRED_FRAMES[state.frames[0].row]);
    for (const frame of state.frames) assert.ok(frame.column < 8 && frame.row < 9 && frame.duration > 0);
  }
});
test('idle uses the real 6.60 second cycle and exact boundary transitions', () => {
  const schedule = scheduleFor('idle');
  assert.deepEqual(schedule.frames.map(frame => frame.duration), [1680, 660, 660, 840, 840, 1920]);
  assert.equal(frameAt(schedule, 1679.99).column, 0);
  assert.equal(frameAt(schedule, 1680).column, 1);
  assert.equal(frameAt(schedule, 6599).column, 5);
  assert.equal(frameAt(schedule, 6600).column, 0);
});
test('every non-idle state returns to idle exactly after three cycles', () => {
  for (const state of STATES.slice(1)) {
    const schedule = scheduleFor(state.id, 'native');
    const boundary = state.frames.reduce((sum, frame) => sum + frame.duration, 0) * 3;
    assert.equal(frameAt(schedule, boundary - 1).row, state.frames[0].row);
    assert.equal(frameAt(schedule, boundary).row, 0);
    assert.equal(frameAt(schedule, boundary).column, 0);
    assert.equal(frameAt(schedule, boundary + 6600).row, 0);
    assert.equal(frameAt(schedule, boundary + 6600).column, 0);
  }
});
test('review loop does not imitate native return-to-idle behavior', () => {
  const schedule = scheduleFor('jumping', 'loop');
  assert.equal(frameAt(schedule, 840 * 20).row, 4);
  assert.equal(frameAt(schedule, 840 * 20).column, 0);
});
test('reduced motion holds the first frame of the requested state', () => {
  assert.equal(frameAt(scheduleFor('failed', 'reduced'), 100000).row, 5);
  assert.equal(frameAt(scheduleFor('failed', 'reduced'), 100000).column, 0);
});
test('16 directions cover exactly the final two atlas rows', () => {
  const frames = Array.from({ length: 16 }, (_, index) => directionFrame(index));
  assert.equal(new Set(frames.map(frame => `${frame.row}:${frame.column}`)).size, 16);
  assert.deepEqual([frames[0].row, frames[0].column], [9, 0]);
  assert.deepEqual([frames[8].row, frames[8].column], [10, 0]);
  assert.deepEqual([frames[15].row, frames[15].column], [10, 7]);
  assert.equal(positionFor(frames[15]), '100% 100%');
  assert.throws(() => directionFrame(16), RangeError);
});
