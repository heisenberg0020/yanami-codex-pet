// Timing and direction mapping observed in the local host on 2026-09-10.
// app-initial-1b87ae739476.js: LN, RN, mer, ser, Cer. This is a preview, not a host API.
export const ATLAS = Object.freeze({ width: 1536, height: 2288, cellWidth: 192, cellHeight: 208, columns: 8, rows: 11 });
export const REQUIRED_FRAMES = Object.freeze([6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]);
const lane = (row, count, normal, last) => Array.from({ length: count }, (_, column) => ({ row, column, duration: column === count - 1 ? last : normal }));
export const STATES = Object.freeze([
  { id: 'idle', label: '待机', frames: [280, 110, 110, 140, 140, 320].map((ms, column) => ({ row: 0, column, duration: ms * 6 })) },
  { id: 'running-right', label: '向右跑', frames: lane(1, 8, 120, 220) },
  { id: 'running-left', label: '向左跑', frames: lane(2, 8, 120, 220) },
  { id: 'waving', label: '挥手', frames: lane(3, 4, 140, 280) },
  { id: 'jumping', label: '指针反应', frames: lane(4, 5, 140, 280) },
  { id: 'failed', label: '失败', frames: lane(5, 8, 140, 240) },
  { id: 'waiting', label: '等待', frames: lane(6, 6, 150, 260) },
  { id: 'running', label: '工作中', frames: lane(7, 6, 120, 220) },
  { id: 'review', label: '待审阅', frames: lane(8, 6, 150, 280) },
]);

export function scheduleFor(stateId, mode = 'native') {
  const state = STATES.find(item => item.id === stateId);
  if (!state) throw new RangeError(`Unknown state: ${stateId}`);
  if (!['native', 'loop', 'reduced'].includes(mode)) throw new RangeError(`Unknown mode: ${mode}`);
  if (mode === 'reduced') return { frames: [state.frames[0]], loopStart: 0 };
  if (mode === 'loop' || stateId === 'idle') return { frames: [...state.frames], loopStart: 0 };
  const intro = [...state.frames, ...state.frames, ...state.frames];
  return { frames: [...intro, ...STATES[0].frames], loopStart: intro.length };
}

export function frameAt(schedule, elapsedMs) {
  const { frames, loopStart } = schedule;
  const prefixDuration = frames.slice(0, loopStart).reduce((sum, frame) => sum + frame.duration, 0);
  const loopDuration = frames.slice(loopStart).reduce((sum, frame) => sum + frame.duration, 0);
  let time = Math.max(0, elapsedMs);
  let index = 0;
  if (time >= prefixDuration) {
    time = (time - prefixDuration) % loopDuration;
    index = loopStart;
  }
  while (index < frames.length - 1 && time >= frames[index].duration) {
    time -= frames[index].duration;
    index += 1;
  }
  return { ...frames[index], index, remaining: frames[index].duration - time };
}

export function timeAtIndex(schedule, index) {
  return schedule.frames.slice(0, index).reduce((sum, frame) => sum + frame.duration, 0);
}

export function directionFrame(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 16) throw new RangeError('Direction must be 0–15');
  return { row: 9 + Math.floor(index / 8), column: index % 8, duration: 0, index };
}

export function positionFor({ row, column }) {
  return `${column / (ATLAS.columns - 1) * 100}% ${row / (ATLAS.rows - 1) * 100}%`;
}
