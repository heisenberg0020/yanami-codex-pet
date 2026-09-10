// Per-tab recovery journal. Write before POST; erase only after a definitive response.
const KEY = 'yanami-snack-club.pending-action.v1';
const SNACK_IDS = ['pudding', 'melonpan', 'strawberry-milk', 'onigiri', 'taiyaki', 'dango'];
const EMPTY_ACTIONS = ['pause', 'resume', 'cancel', 'claim', 'claimCodex'];

function invalid(message = '待确认操作记录损坏，无法安全发送。请先处理这份记录。') {
  return Object.assign(new Error(message), { code: 'INVALID_PENDING_ACTION' });
}

function exact(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field));
}

function checked(action) {
  if (!exact(action, ['id', 'type', 'expectedRevision', 'payload'])
    || typeof action.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(action.id)
    || !Number.isSafeInteger(action.expectedRevision) || action.expectedRevision < 0) throw invalid();
  const { type, payload } = action;
  let cleanPayload;
  if (type === 'start') {
    if (exact(payload, ['mode']) && payload.mode === 'trial') cleanPayload = { mode: 'trial' };
    else if (exact(payload, ['mode', 'minutes']) && payload.mode === 'focus' && [15, 25, 45].includes(payload.minutes)) {
      cleanPayload = { mode: 'focus', minutes: payload.minutes };
    } else throw invalid();
  } else if (type === 'feed') {
    if (!exact(payload, ['snackId']) || !SNACK_IDS.includes(payload.snackId)) throw invalid();
    cleanPayload = { snackId: payload.snackId };
  } else if (type === 'settings') {
    if (!exact(payload, ['reducedMotion']) || typeof payload.reducedMotion !== 'boolean') throw invalid();
    cleanPayload = { reducedMotion: payload.reducedMotion };
  } else if (EMPTY_ACTIONS.includes(type) && exact(payload, [])) cleanPayload = {};
  else throw invalid();
  return { id: action.id, type, expectedRevision: action.expectedRevision, payload: cleanPayload };
}

function requireStorage(storage) {
  if (!storage || !['getItem', 'setItem', 'removeItem'].every(method => typeof storage[method] === 'function')) {
    throw Object.assign(new Error('浏览器暂时无法记录待确认操作，尚未发送请求。'), { code: 'PENDING_STORAGE_UNAVAILABLE' });
  }
  return storage;
}

/** Missing is null; unreadable or invalid data throws, never silently resets. */
export function loadPending(storage) {
  const raw = requireStorage(storage).getItem(KEY);
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.length > 4096) throw invalid();
  let value;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  return checked(value);
}

/** Throws if validation, writing or read-back fails. The caller must not POST. */
export function savePending(storage, action) {
  const value = JSON.stringify(checked(action));
  const target = requireStorage(storage);
  const previous = loadPending(target);
  if (previous !== null && JSON.stringify(previous) !== value) {
    throw Object.assign(new Error('还有一步等待确认，请先使用原编号确认，尚未发送新请求。'), { code: 'PENDING_ACTION_EXISTS' });
  }
  target.setItem(KEY, value);
  if (target.getItem(KEY) !== value) {
    throw Object.assign(new Error('未能确认待处理操作已记录，尚未发送请求。'), { code: 'PENDING_STORAGE_UNAVAILABLE' });
  }
}

/** Removal failures remain visible, allowing a safe same-id replay later. */
export function clearPending(storage) {
  const target = requireStorage(storage);
  target.removeItem(KEY);
  if (target.getItem(KEY) !== null) {
    throw Object.assign(new Error('操作已返回结果，但待确认记录尚未清除。重新确认会使用原编号。'), { code: 'PENDING_STORAGE_UNAVAILABLE' });
  }
}

/** HTTP success or a definite client rejection can resolve the journal.
 * Transport failures, timeout/5xx and non-final statuses cannot prove non-commit.
 * Parsing/validating the response body remains the caller's responsibility.
 */
export function uncertainResponse(status) {
  return !Number.isInteger(status) || status < 200 || status >= 500 || status === 408
    || (status >= 300 && status < 400);
}
