import { createHash } from 'node:crypto';

export const CODEX_TARGET = 3;
export const CODEX_STALE_MS = 10 * 60_000;
const KINDS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd'];
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
function ensure(value) { if (!value) throw Object.assign(new Error('Codex 联动记录格式无效。'), { code: 'INVALID_CODEX_EVENT', status: 400 }); }
const turnKey = (sessionId, turnId) => hash(`${sessionId}:${turnId}`);

export function createCodexState() {
  return { schemaVersion: 1, revision: 0, lastEventAt: null, turns: [], credits: [] };
}

export function validateCodex(value) {
  ensure(exact(value, ['schemaVersion', 'revision', 'lastEventAt', 'turns', 'credits']));
  ensure(value.schemaVersion === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0);
  ensure(value.lastEventAt === null || time(value.lastEventAt));
  ensure(Array.isArray(value.turns) && Array.isArray(value.credits));
  const turns = new Map();
  for (const turn of value.turns) {
    ensure(exact(turn, ['key', 'sessionId', 'turnId', 'startedAt', 'toolAt', 'lastEventAt', 'status', 'credited']));
    ensure(digest(turn.sessionId) && digest(turn.turnId) && turn.key === turnKey(turn.sessionId, turn.turnId) && !turns.has(turn.key));
    ensure(time(turn.lastEventAt) && turn.lastEventAt <= value.lastEventAt);
    ensure([turn.startedAt, turn.toolAt].every(at => at === null || time(at) && at <= turn.lastEventAt));
    ensure(['working', 'waiting', 'stopped', 'interrupted'].includes(turn.status) && typeof turn.credited === 'boolean');
    ensure(!turn.credited || turn.status === 'stopped' && turn.startedAt !== null && turn.toolAt !== null);
    turns.set(turn.key, turn);
  }
  const credited = new Set();
  let previousAt = 0;
  for (const credit of value.credits) {
    ensure(exact(credit, ['key', 'at']) && turns.get(credit.key)?.credited && !credited.has(credit.key));
    ensure(time(credit.at) && credit.at >= previousAt);
    credited.add(credit.key);
    previousAt = credit.at;
  }
  ensure(value.turns.filter(turn => turn.credited).length === credited.size && value.revision >= credited.size);
  return structuredClone(value);
}

export function validateCodexEvent(event) {
  ensure(exact(event, ['schemaVersion', 'id', 'kind', 'sessionId', 'turnId', 'at']));
  ensure(event.schemaVersion === 1 && digest(event.id) && KINDS.includes(event.kind) && digest(event.sessionId));
  ensure((event.turnId === null || digest(event.turnId)) && time(event.at));
  ensure(!['UserPromptSubmit', 'Stop', 'Interrupt'].includes(event.kind) || event.turnId !== null);
  return event;
}

/** Local hook observations, not proof of task success or human focus time. */
export function applyCodexEvent(input, event, now) {
  validateCodexEvent(event);
  ensure(time(now) && event.at <= now + 60_000);
  const state = validateCodex(input);
  const before = JSON.stringify(state);
  state.lastEventAt = Math.max(state.lastEventAt ?? 0, event.at);
  if (event.kind === 'SessionEnd') {
    for (const turn of state.turns) {
      if (turn.sessionId === event.sessionId && ['working', 'waiting'].includes(turn.status) && event.at >= turn.lastEventAt) {
        turn.status = 'interrupted';
        turn.lastEventAt = event.at;
      }
    }
  } else if (event.turnId) {
    const key = turnKey(event.sessionId, event.turnId);
    let turn = state.turns.find(item => item.key === key);
    if (!turn) {
      turn = { key, sessionId: event.sessionId, turnId: event.turnId, startedAt: null, toolAt: null, lastEventAt: event.at, status: 'working', credited: false };
      state.turns.push(turn);
    }
    const terminal = ['stopped', 'interrupted'].includes(turn.status);
    if (!terminal || turn.status === 'stopped' && !turn.credited) {
      if (event.kind === 'UserPromptSubmit') turn.startedAt ??= event.at;
      if (event.kind === 'PostToolUse') turn.toolAt ??= event.at;
      if (event.kind === 'Interrupt') {
        turn.status = 'interrupted';
      } else if (terminal) {
        // Async hooks can deliver the tool observation after the Stop signal.
      } else if (event.at >= turn.lastEventAt) {
        turn.status = event.kind === 'PermissionRequest' ? 'waiting' : event.kind === 'Stop' ? 'stopped' : event.kind === 'Interrupt' ? 'interrupted' : 'working';
      } else if (event.kind === 'Interrupt' || event.kind === 'Stop') {
        // A late terminal observation must never leave a turn looking busy.
        turn.status = event.kind === 'Interrupt' ? 'interrupted' : 'stopped';
      }
      turn.lastEventAt = Math.max(turn.lastEventAt, event.at);
      if (turn.status === 'stopped' && turn.startedAt !== null && turn.toolAt !== null) {
        turn.credited = true;
        state.credits.push({ key, at: Math.max(now, state.credits.at(-1)?.at ?? 0) });
      }
    }
  }
  if (JSON.stringify(state) !== before) state.revision++;
  return validateCodex(state);
}

export function codexEntitlements(state) {
  const rewards = [];
  for (let i = 0; i + CODEX_TARGET <= state.credits.length; i += CODEX_TARGET) {
    const group = state.credits.slice(i, i + CODEX_TARGET);
    rewards.push({ id: `codex-${hash(group.map(credit => credit.key).join(':'))}`, startedAt: group[0].at, completedAt: group.at(-1).at });
  }
  return rewards;
}

export function codexView(state, receipts, now, installed = false) {
  const active = state.turns.filter(turn => ['working', 'waiting'].includes(turn.status));
  const fresh = active.filter(turn => now - turn.lastEventAt < CODEX_STALE_MS);
  const status = state.lastEventAt === null ? 'disconnected'
    : fresh.some(turn => turn.status === 'waiting') ? 'waiting'
      : fresh.length ? 'working' : active.length ? 'stale' : 'idle';
  const claimed = receipts.filter(receipt => receipt.mode === 'codex');
  return {
    enabled: installed || state.lastEventAt !== null, status, lastEventAt: state.lastEventAt,
    activeSessions: new Set(fresh.map(turn => turn.sessionId)).size,
    completedTurns: state.credits.length, progress: state.credits.length % CODEX_TARGET, target: CODEX_TARGET,
    pendingRewards: Math.floor(state.credits.length / CODEX_TARGET) - claimed.length,
    lastRewardAt: claimed.at(-1)?.claimedAt ?? null,
  };
}
