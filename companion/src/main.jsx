import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { frameAt, scheduleFor, positionFor } from "../../preview/animation.mjs";
import atlas from "../../assets/upstream/yanami-anna/spritesheet.webp?url";
import {
  loadPending,
  savePending,
  clearPending,
  uncertainResponse,
} from "../client-action.mjs";
import "./style.css";
function restoreJournal() {
  try {
    const action = loadPending(sessionStorage);
    return {
      action,
      error: action
        ? "上次还有一步等待确认。点击确认即可继续，不会重复领取或投喂。"
        : "",
    };
  } catch {
    return {
      action: null,
      error:
        "这张卡片的待确认记录无法读取。请重新打开小卖部；已有收藏仍在本机。",
      blocked: true,
    };
  }
}

function Icon({ name, size = 21, ...props }) {
  const paths = {
    bag: (
      <>
        <path d="M5 7h14l1 14H4L5 7ZM9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
    bell: (
      <>
        <path d="M5 17h14c-3-3-2-5-2-8a5 5 0 0 0-10 0c0 3 1 5-2 8Zm5 3h4M12 2v2" />
      </>
    ),
    star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" />,
    shop: (
      <>
        <path d="M3 10h18l-2-7H5l-2 7Z" />
        <path d="M4 10v11h16V10M9 21v-7h6v7M3 10c0 4 4 4 4 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 4 4 4 0M8 3l-1 7m5-7v7m4-7 1 7" />
      </>
    ),
    basket: (
      <>
        <path d="m3 9 2 12h14l2-12H3Zm4 0 4-6m6 6-4-6M9 13v4m6-4v4" />
      </>
    ),
    drawer: (
      <>
        <path d="M3 10h18v11H3V10Zm0 0 3-7h12l3 7M9 14h6" />
      </>
    ),
    book: (
      <>
        <path d="M12 5c-4-3-7-2-10-1v16c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-6-2-10 1Zm0 0v16" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    check: <path d="m5 12 4 4 10-10" />,
    flower: (
      <>
        <path d="M12 9C4-3 3 15 9 12c-12 5 5 14 3 3 6 11 14-5 3-3C26 5 8-3 12 9Z" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 4 12 8-12 8V4Z" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.flower}
    </svg>
  );
}
const date = (value) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
const time = (value) => {
  const seconds = Math.max(0, Math.ceil(value / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

function SnackArt({ snack, className = "" }) {
  return (
    <div
      className={`snack-art ${className}`}
      role="img"
      aria-label={snack.name}
      style={{
        backgroundPosition: `${(snack.artIndex % 3) * 50}% ${Math.floor(snack.artIndex / 3) * 100}%`,
      }}
    />
  );
}
function Pet({ reaction, reduced }) {
  const sprite = useRef(null);
  useEffect(() => {
    const schedule = scheduleFor(
      reaction || "idle",
      reduced ? "reduced" : "native",
    );
    const start = performance.now();
    let timer;
    const tick = () => {
      const frame = frameAt(schedule, performance.now() - start);
      if (sprite.current)
        sprite.current.style.backgroundPosition = positionFor(frame);
      if (!reduced) timer = setTimeout(tick, Math.max(16, frame.remaining));
    };
    tick();
    return () => clearTimeout(timer);
  }, [reaction, reduced]);
  return (
    <div
      className="pet"
      ref={sprite}
      role="img"
      aria-label="原版八奈见杏菜"
      style={{ backgroundImage: `url(${atlas})` }}
    />
  );
}
function Modal({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="dialog-title"
    >
      <button
        className="close icon-button"
        aria-label="关闭弹窗"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
      <h2 id="dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}

const codexEventDate = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const codexStatuses = {
  disconnected: ["暂未连接", "新的工作事件到来后，这里会继续更新。"],
  working: ["正在协作", "Codex 正在处理这一回合，杏菜也去看看点心。"],
  waiting: ["等待继续", "先在这里歇一会儿，等下一次工作事件。"],
  idle: ["暂时歇一会儿", "这次收尾已经记下，新的工作回合再一起出发。"],
  stale: ["暂未收到新动态", "有一阵没有收到工作事件，等下一次事件来更新。"],
};

function CodexCard({ codex, online, disabled, onClaim }) {
  const enabled = codex?.enabled === true;
  const lastEventAt = Number.isFinite(codex?.lastEventAt)
    ? codex.lastEventAt
    : null;
  const status = codexStatuses[codex?.status] ? codex.status : "disconnected";
  const [label, detail] = !online
    ? ["连接暂时中断", "暂时连不上小卖部，重连后会更新协作记录。"]
    : !enabled
      ? ["尚未开启", "开启本地 Codex 联动后，工作回合会记在这里。"]
      : lastEventAt === null
        ? ["等待首次工作事件", "配置已安装；审核信任后，新的 Codex 工作事件会出现在这里。"]
        : codexStatuses[status];
  const progress = Math.max(0, Math.min(3, codex?.progress || 0));
  const pendingRewards = Math.max(0, codex?.pendingRewards || 0);
  const completedTurns = Math.max(0, codex?.completedTurns || 0);
  const activeSessions = Math.max(0, codex?.activeSessions || 0);
  return (
    <section className="codex-card" aria-labelledby="codex-heading">
      <div className="codex-heading">
        <h2 id="codex-heading"><Icon name="bag" />Codex 协作采购</h2>
        <span className={`codex-status ${online && enabled ? status : "disconnected"}`} role="status">
          <span aria-hidden="true" />{label}
        </span>
      </div>
      <p className="codex-rule">每 3 次含工具活动的回合收尾，带回 1 份点心</p>
      <div className="codex-body">
        <div className="codex-progress-group">
          <div className="codex-progress-label">
            <span>下一份点心</span><strong>{progress} / 3 <span>次收尾</span></strong>
          </div>
          <div className="codex-progress" role="progressbar" aria-label="下一份协作点心的回合收尾进度" aria-valuemin={0} aria-valuemax={3} aria-valuenow={progress}>
            {[0, 1, 2].map((step) => <span key={step} className={step < progress ? "recorded" : ""} aria-hidden="true" />)}
          </div>
          <p className="codex-detail">{detail}</p>
        </div>
        <div className="codex-reward">
          <p>{pendingRewards > 0 ? <>有 <strong>{pendingRewards}</strong> 份点心等你收好</> : "点心慢慢攒，随时来看看"}</p>
          <button className="secondary" disabled={disabled || pendingRewards === 0} onClick={onClaim}>
            <Icon name="basket" size={18} />领取 1 份点心
          </button>
        </div>
      </div>
      <div className="codex-meta">
        <span>已记录回合 · {completedTurns}{enabled && activeSessions > 0 ? ` · ${activeSessions} 个会话参与中` : ""}</span>
        <span>{lastEventAt === null ? "还没有工作事件记录" : `最后更新 · ${codexEventDate.format(lastEventAt)}`}</span>
      </div>
      {codex?.notice && <p className="codex-note" role="status">{codex.notice}</p>}
      <p className="codex-note">按 Codex 收尾事件计数，不代表任务完成或测试通过，也不计专注分钟。</p>
    </section>
  );
}

function App() {
  const [journal] = useState(restoreJournal);
  const [snapshot, setSnapshot] = useState(null),
    [page, setPage] = useState("focus"),
    [minutes, setMinutes] = useState(25);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(journal.error),
    [retry, setRetry] = useState(journal.action),
    [online, setOnline] = useState(true);
  const [modal, setModal] = useState(null),
    [feedback, setFeedback] = useState(null),
    [clock, setClock] = useState(Date.now()),
    [reaction, setReaction] = useState(null);
  const [systemReduced, setSystemReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const current = useRef(null),
    pending = useRef(false),
    offset = useRef(0);
  const accept = (data) => {
    if (!data.state) return;
    if (current.current && data.state.revision < current.current.state.revision)
      return;
    if (current.current && data.state.revision === current.current.state.revision && data.now < current.current.now)
      return;
    offset.current = (data.now || Date.now()) - Date.now();
    setClock(Date.now() + offset.current);
    const next = { ...current.current, ...data };
    current.current = next;
    setSnapshot(next);
    setOnline(true);
  };
  const refresh = async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error?.message || "小卖部暂时没能打开。");
      accept(data);
    } catch (e) {
      setOnline(false);
      if (!current.current) setError(e.message);
    }
  };
  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5000);
    const show = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", show);
    const tick = setInterval(() => setClock(Date.now() + offset.current), 500);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(media.matches);
    media.addEventListener("change", change);
    return () => {
      clearInterval(interval);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", show);
      media.removeEventListener("change", change);
    };
  }, []);
  useEffect(() => {
    if (!reaction) return;
    const schedule = scheduleFor(reaction.state, "native");
    const duration = schedule.frames.slice(0, schedule.loopStart).reduce((sum, frame) => sum + frame.duration, 0);
    const timer = setTimeout(() => setReaction(null), duration);
    return () => clearTimeout(timer);
  }, [reaction]);
  async function send(type, payload = {}, replayed = null) {
    if (journal.blocked || pending.current || (!replayed && retry)) return;
    const action = replayed || {
      id: crypto.randomUUID(),
      type,
      payload,
      expectedRevision: current.current.state.revision,
    };
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      savePending(sessionStorage, action);
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await res.json();
      if (
        res.ok &&
        (!data.state ||
          !Number.isSafeInteger(data.state.revision) ||
          !Array.isArray(data.catalog?.snacks) ||
          data.feedback?.kind !== action.type ||
          (action.type === "claimCodex" &&
            (!data.feedback?.receipt || data.feedback.receipt.mode !== "codex")))
      )
        throw new Error("结果尚未确认");
      accept(data);
      if (uncertainResponse(res.status)) {
        setRetry(action);
        setError("这一步还没确认保存。请使用原来的记录再确认一次。");
        return false;
      }
      clearPending(sessionStorage);
      setRetry(null);
      if (!res.ok) {
        setError(data.error?.message || "没有完成这一步，请再试一次。");
        return false;
      }
      if (data.feedback) setFeedback(data.feedback);
      const nextReaction = action.type === "feed"
          ? "review"
          : action.type === "start"
            ? "waving"
            : action.type === "claim" || action.type === "claimCodex"
              ? "jumping"
              : null;
      setReaction(nextReaction ? { state: nextReaction, id: action.id } : null);
      if (action.type === "feed") setModal("feed");
      if (action.type === "claim" || action.type === "cancel") setModal(null);
      if (action.type === "claimCodex") setModal("codex-receipt");
      return true;
    } catch {
      setRetry(action);
      setError("还没确认是否保存成功。请点“确认这一步”，不会重复领取或投喂。");
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!snapshot)
    return (
      <div className="loading">
        <Icon name="shop" size={46} />
        <h1>八奈见的小卖部</h1>
        <p role="status">{error || "正在打开零食抽屉…"}</p>
        {error && (
          <button className="primary" onClick={refresh}>
            重新打开
          </button>
        )}
      </div>
    );
  const { state, catalog, codex } = snapshot,
    trip = state.activeTrip;
  const remaining = trip
    ? trip.status === "running"
      ? Math.min(trip.durationMs, Math.max(0, trip.deadlineAt - clock))
      : trip.remainingMs
    : 0;
  const ready =
    trip &&
    (trip.status === "ready" || (trip.status === "running" && remaining === 0));
  const disabled = busy || Boolean(retry) || journal.blocked || !online;
  const snacks = catalog.snacks,
    total = Object.values(state.inventory).reduce((sum, n) => sum + n, 0);
  const collected = Object.keys(state.collection).filter(
    (id) => state.collection[id].feedCount > 0,
  );
  const focusMinutes = state.receipts.reduce(
    (sum, r) => sum + (r.mode === "focus" ? r.focusMinutes : 0),
    0,
  );
  const keepsakes = new Set(state.receipts.map((r) => r.keepsakeId));
  const codexReceipt = modal === "codex-receipt" ? feedback?.receipt : null;
  const reward = codexReceipt || trip?.reward;
  const prize = snacks.find((s) => s.id === reward?.snackId);
  const story = catalog.stories.find((s) => s.id === reward?.storyId);
  const keepsake = catalog.keepsakes.find((s) => s.id === reward?.keepsakeId);
  const close = () => setModal(null);
  const codexReaction = online && codex?.enabled
    ? ({ working: "running", waiting: "waiting" }[codex.status] || "idle")
    : "idle";
  const codexScene = codex?.pendingRewards > 0
    ? ["点心带回来啦，记得收进抽屉。", "点心等你收好"]
    : online && codex?.enabled
      ? {
          working: ["你忙你的，我去挑点心。", "陪你协作中"],
          waiting: ["先看看需要你决定的事，我等你。", "等你做决定"],
          stale: ["先歇会儿，有新动静再叫我。", "等待新动态"],
          idle: ["我在这里，下一回合再一起出发。", "安静陪你"],
        }[codex.status]
      : null;
  const interactionSpeech = reaction && ["feed", "claim", "claimCodex"].includes(feedback?.kind)
    ? feedback.message
    : null;
  const speech = ready
    ? "回来啦。袋子里有一点惊喜。"
    : trip?.status === "paused"
      ? "歇一会儿，我帮你留着。"
      : trip
        ? "慢慢来，我会带着点心回来。"
        : interactionSpeech || codexScene?.[0] || "路过便利店，要带什么吗？";
  const stageCaption = ready
    ? "采购归来"
    : trip
      ? "点心在路上"
      : interactionSpeech
        ? feedback.kind === "feed" ? "一起吃点心" : "点心已收好"
        : codexScene?.[1] || "便利店出发前";
  const title = ready
    ? "点心买到了。"
    : trip?.status === "paused"
      ? "歇一会，也很好。"
      : trip
        ? "把这一会儿，留给自己。"
        : "你专心，我去逛逛。";
  return (
    <div className="app-shell">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("focus");
          }}
        >
          <span className="brand-icon">
            <Icon name="shop" size={29} />
          </span>
          <span>
            八奈见的小卖部<small>小小零食，大大日常</small>
          </span>
        </a>
        <nav aria-label="小卖部导航">
          {[
            ["focus", "basket", "专注采购"],
            ["drawer", "drawer", "零食抽屉"],
            ["collection", "book", "收藏册"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon name={icon} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </header>
      {(!online || error || snapshot.recoveryNotice) && (
        <div className="notice" role="alert">
          {error ||
            (!online
              ? "暂时连不上小卖部。重新连接后就能继续，已有收藏仍保存在本机。"
              : snapshot.recoveryNotice)}{" "}
          {retry ? (
            <button disabled={busy} onClick={() => send(null, {}, retry)}>
              确认这一步
            </button>
          ) : (
            !online && <button onClick={refresh}>重新连接</button>
          )}
        </div>
      )}
      <main>
        {page === "focus" && (
          <>
            <section className="focus-panel" aria-label="专注采购">
              <div className="pet-stage">
                <div className="paper-note">
                  小小的休息，
                  <br />
                  也是前进。
                  <Icon name="flower" />
                </div>
                <div className="speech" aria-live="polite">
                  {speech}
                </div>
                <div className="arch" />
                <Pet
                  key={reaction?.id || `codex-${codexReaction}`}
                  reaction={reaction?.state || codexReaction}
                  reduced={state.settings.reducedMotion || systemReduced}
                />
                <div className="ground" />
                <span className="stage-caption">
                  杏菜 ·{" "}
                  {stageCaption}
                </span>
              </div>
              <div className="focus-controls">
                <h1>{title}</h1>
                <p className="intro">
                  {trip
                    ? trip.mode === "trial"
                      ? "这趟是 30 秒体验，不计入专注记录。"
                      : "专心手边的事，回来的路上带点甜。"
                    : "留一段时间给手边的事，回来的路上带点甜。"}
                </p>
                {!trip ? (
                  <>
                    <fieldset className="durations">
                      <legend className="sr-only">专注时长</legend>
                      {[15, 25, 45].map((n) => (
                        <label
                          key={n}
                          className={minutes === n ? "selected" : ""}
                        >
                          <input
                            type="radio"
                            name="duration"
                            checked={minutes === n}
                            onChange={() => setMinutes(n)}
                          />
                          {n}
                          <span>分钟</span>
                        </label>
                      ))}
                    </fieldset>
                    <button
                      className="primary start"
                      disabled={disabled}
                      onClick={() => send("start", { minutes, mode: "focus" })}
                    >
                      <Icon name="basket" />
                      开始专注
                    </button>
                    <button
                      className="trial text-button"
                      disabled={disabled}
                      onClick={() => send("start", { mode: "trial" })}
                    >
                      体验一次（30秒）
                      <Icon name="arrow" size={15} />
                    </button>
                    <small className="trial-caption">
                      走一遍采购流程，不计入专注记录
                    </small>
                  </>
                ) : (
                  <>
                    <div
                      className={`timer ${ready ? "ready" : ""}`}
                      aria-label={
                        ready ? "采购完成" : `剩余 ${time(remaining)}`
                      }
                    >
                      {ready ? (
                        <>
                          <Icon name="basket" size={44} />
                          <span>她回来啦</span>
                        </>
                      ) : (
                        time(remaining)
                      )}
                    </div>
                    <p className="timer-caption">
                      {ready
                        ? "一份小点心，还有路上的小故事。"
                        : trip.status === "paused"
                          ? "已暂停，剩余时间已经留好。"
                          : "关掉卡片也没关系，采购计时会继续。"}
                    </p>
                    {ready ? (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() => setModal("receipt")}
                      >
                        打开采购袋
                        <Icon name="arrow" size={18} />
                      </button>
                    ) : (
                      <div className="trip-buttons">
                        <button
                          className="primary"
                          disabled={disabled}
                          onClick={() =>
                            send(trip.status === "paused" ? "resume" : "pause")
                          }
                        >
                          <Icon
                            name={trip.status === "paused" ? "play" : "pause"}
                          />
                          {trip.status === "paused" ? "继续专注" : "暂停一下"}
                        </button>
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() => setModal("cancel")}
                        >
                          结束这趟
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
            <CodexCard codex={codex} online={online} disabled={disabled} onClaim={() => send("claimCodex", {})} />
            <section className="drawer-preview">
              <div className="preview-heading">
                <h2>
                  <Icon name="drawer" />
                  零食抽屉
                </h2>
                <p>
                  一些小小的甜，
                  <br />
                  装进平凡的日子里。
                </p>
                <button
                  className="text-button"
                  onClick={() => setPage("drawer")}
                >
                  打开抽屉
                  <Icon name="arrow" size={15} />
                </button>
              </div>
              <div className="mini-snacks">
                {snacks.map((s) => (
                  <button
                    key={s.id}
                    className="mini-snack"
                    onClick={() => setPage("drawer")}
                    aria-label={`${s.name}，${state.inventory[s.id]}份，打开抽屉`}
                  >
                    <SnackArt snack={s} />
                    <span>{s.name}</span>
                    <small>× {state.inventory[s.id]}</small>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
        {page === "drawer" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>今天，想吃哪一种？</h1>
                <p>挑一份给杏菜，小小的心意会被记住。</p>
              </div>
              <span className="soft-tag">抽屉里还有 {total} 份</span>
            </div>
            <div className="snack-grid">
              {snacks.map((s) => (
                <article key={s.id} className="snack-card">
                  <div className="stock">× {state.inventory[s.id]}</div>
                  <SnackArt snack={s} />
                  <h2>{s.name}</h2>
                  <p>{s.description}</p>
                  <button
                    className="secondary"
                    aria-label={`投喂${s.name}`}
                    disabled={disabled || state.inventory[s.id] === 0}
                    onClick={() => send("feed", { snackId: s.id })}
                  >
                    {state.inventory[s.id] > 0
                      ? "给杏菜一份"
                      : "吃完了，采购再带"}
                  </button>
                  {state.collection[s.id]?.feedCount > 0 && (
                    <small className="fed-label">
                      <Icon name="check" size={13} />
                      已一起尝过 {state.collection[s.id].feedCount} 次
                    </small>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        {page === "collection" && (
          <section>
            <div className="page-heading">
              <div>
                <h1>把小日子，收进册子。</h1>
                <p>一起吃过的点心，和每次采购带回的纪念。</p>
              </div>
              <span className="soft-tag">
                一起尝过 {collected.length} / 6 种
              </span>
            </div>
            <div className="collection-layout">
              <div>
                <h2 className="section-title">点心图鉴</h2>
                <div className="collection-grid">
                  {snacks.map((s) => {
                    const entry = state.collection[s.id],
                      known = entry?.feedCount > 0;
                    return (
                      <article
                        key={s.id}
                        className={`collection-item ${known ? "" : "undiscovered"}`}
                      >
                        <SnackArt snack={s} />
                        <h3>{s.name}</h3>
                        <small>
                          {known
                            ? `一起尝过 ${entry.feedCount} 次`
                            : "还没一起尝过"}
                        </small>
                        {known && <p>初次分享 · {date(entry.firstFedAt)}</p>}
                      </article>
                    );
                  })}
                </div>
                <h2 className="section-title souvenir-title">路上的纪念</h2>
                <div className="souvenirs">
                  {catalog.keepsakes.map((k) => (
                    <article
                      key={k.id}
                      className={keepsakes.has(k.id) ? "earned" : ""}
                    >
                      <Icon
                        name={
                          {
                            "paper-bag": "bag",
                            "shop-bell": "bell",
                            "home-star": "star",
                          }[k.id]
                        }
                        size={30}
                      />
                      <h3>{k.name}</h3>
                      <p>
                        {keepsakes.has(k.id)
                          ? k.description
                          : "完成采购后，慢慢遇见。"}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
              <aside className="receipt-book">
                <h2>
                  <Icon name="book" />
                  采购小票
                </h2>
                <p className="focus-total">
                  累计专注 <strong>{focusMinutes}</strong> 分钟
                </p>
                {state.receipts.length === 0 ? (
                  <div className="empty">
                    <Icon name="basket" size={36} />
                    <p>
                      第一张小票，
                      <br />
                      等你和杏菜一起写。
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setPage("focus")}
                    >
                      去采购
                      <Icon name="arrow" size={15} />
                    </button>
                  </div>
                ) : (
                  <ol className="receipt-list">
                    {state.receipts
                      .slice()
                      .reverse()
                      .slice(0, 12)
                      .map((r) => (
                        <li key={r.id}>
                          <div>
                            <strong>
                              {snacks.find((s) => s.id === r.snackId)?.name}
                            </strong>
                            <span>× {r.quantity}</span>
                          </div>
                          <small>
                            {date(r.claimedAt)} ·{" "}
                            {r.mode === "codex"
                              ? "协作采购"
                              : r.mode === "trial"
                                ? "体验采购"
                                : `${r.focusMinutes} 分钟专注`}
                          </small>
                          <p>
                            {
                              catalog.stories.find((s) => s.id === r.storyId)
                                ?.text
                            }
                          </p>
                        </li>
                      ))}
                  </ol>
                )}
                {state.receipts.length > 12 && (
                  <small>
                    显示最近 12 张小票，共 {state.receipts.length} 张。
                  </small>
                )}
              </aside>
            </div>
          </section>
        )}
      </main>
      <footer>
        <span className="footer-motto">
          <Icon name="flower" />
          今天，从一份小点心开始。
        </span>
        <div>
          <span className={`save-status ${online ? "" : "offline"}`}>
            <Icon name="check" size={15} />
            {busy
              ? "正在保存…"
              : retry
                ? "等待确认保存"
                : online
                  ? "已本地保存"
                  : "等待连接"}
          </span>
          <label className="motion-toggle">
            <input
              type="checkbox"
              checked={state.settings.reducedMotion}
              disabled={disabled}
              onChange={(e) =>
                send("settings", { reducedMotion: e.target.checked })
              }
            />
            减少动态{systemReduced ? "（系统已开启）" : ""}
          </label>
        </div>
      </footer>
      <div className="sr-only" role="status" aria-live="polite">
        {feedback?.title} {feedback?.message}
      </div>
      <Modal
        open={modal !== null}
        onClose={close}
        title={
          modal === "receipt" || modal === "codex-receipt"
            ? modal === "codex-receipt" ? "协作带回的小点心" : "今天的采购小票"
            : modal === "cancel"
              ? "结束这趟采购？"
              : feedback?.title || "点心时间"
        }
      >
        {(error || !online) && (
          <div className="notice modal-notice" role="alert">
            {error || "暂时连接不上，请稍后再试。"}
            {retry && (
              <button disabled={busy} onClick={() => send(null, {}, retry)}>
                确认这一步
              </button>
            )}
          </div>
        )}
        {(modal === "receipt" || modal === "codex-receipt") && prize && (
          <div className="receipt-modal">
            <span className="receipt-mode">
              {codexReceipt
                ? "协作采购 · 3 次回合收尾"
                : trip.mode === "trial"
                  ? "体验采购 · 30 秒"
                  : `专注采购 · ${Math.round(trip.durationMs / 60000)} 分钟`}
            </span>
            <SnackArt snack={prize} />
            <h3>
              {prize.name}
              <span> × {reward.quantity || 1}</span>
            </h3>
            <div className="receipt-story">
              <strong>{story?.title}</strong>
              <p>{story?.text}</p>
            </div>
            <p className="souvenir-note">
              <Icon name="flower" />
              {keepsake
                ? `顺手带回：${keepsake.name}`
                : "今天的小见闻，也值得收好。"}
            </p>
            <button
              className="primary"
              disabled={!codexReceipt && disabled}
              onClick={codexReceipt ? close : () => send("claim")}
            >
              {codexReceipt ? "收好啦" : busy ? "正在收好…" : "收进抽屉"}
            </button>
            <small>{codexReceipt ? "点心和小票已保存到本机，不计入专注分钟。" : "领取后，点心和小票会一起保存。"}</small>
          </div>
        )}
        {modal === "feed" && (
          <div className="feeding">
            <Pet
              reaction="review"
              reduced={state.settings.reducedMotion || systemReduced}
            />
            <p>“{feedback?.message}”</p>
            <small>这一份心意，已经记进收藏册。</small>
            <button className="primary" onClick={close}>
              好吃就好
            </button>
          </div>
        )}
        {modal === "cancel" && (
          <div className="cancel-content">
            <p>
              结束后这趟不会带回点心，也不会扣掉抽屉里的零食。下次随时可以再出发。
            </p>
            <button className="primary" onClick={close}>
              再待一会儿
            </button>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => send("cancel")}
            >
              结束这趟采购
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
