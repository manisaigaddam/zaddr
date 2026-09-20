"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Face from "@/components/Face";
import { FACE_IDS, faceUrl } from "@/lib/mosaic";
import { connectNoir, PLAYER_KEY, restoreNoir, waitForNoir, watchNoir } from "@/lib/noir";

type Screen = "home" | "menu" | "table";
type Mark = "X" | "O";
type Player = { mark: Mark; faceId: number; cpu?: boolean; online?: boolean };
type GameState = {
  code: string;
  mode: "pvp" | "cpu";
  board: (Mark | null)[];
  turn: Mark;
  winner: Mark | null;
  draw: boolean;
  forfeit: Mark | null;
  reason: string | null;
  players: Player[];
  you: Mark;
  waiting: boolean;
  moveLeft: number | null;
  gameLeft: number | null;
  ended: boolean;
};

const ROOM_KEY = "zaddr.room";
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winningLine(board: (Mark | null)[]) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function readRoom() {
  try {
    const local = localStorage.getItem(ROOM_KEY);
    if (local) return local;
    const ses = sessionStorage.getItem(ROOM_KEY);
    if (ses) {
      localStorage.setItem(ROOM_KEY, ses);
      sessionStorage.removeItem(ROOM_KEY);
      return ses;
    }
  } catch {
    return null;
  }
  return null;
}

function writeRoom(code: string | null) {
  try {
    if (code) localStorage.setItem(ROOM_KEY, code);
    else localStorage.removeItem(ROOM_KEY);
  } catch {
    /* ignore */
  }
}

function Mosaic() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  const tiles = useMemo(() => Array.from({ length: 32 }, (_, i) => FACE_IDS[i % FACE_IDS.length]), []);
  if (!on) return <div className="mosaic" aria-hidden />;
  return (
    <div className="mosaic" aria-hidden>
      {tiles.map((id, i) => (
        <span key={i} style={{ backgroundImage: `url(${faceUrl(id)})` }} />
      ))}
    </div>
  );
}

function useNow(active: boolean) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT(Date.now()), 200);
    return () => clearInterval(id);
  }, [active]);
  return t;
}

export default function GameApp() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [hint, setHint] = useState("");
  const [shakeConnect, setShakeConnect] = useState(false);
  const [state, setState] = useState<GameState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const keyRef = useRef<string | null>(null);
  const clockRef = useRef({ t: 0, move: 0, game: 0 });
  const now = useNow(Boolean(state && !state.ended && !state.waiting));

  useEffect(() => {
    if (!state) return;
    clockRef.current = {
      t: Date.now(),
      move: state.moveLeft || 0,
      game: state.gameLeft || 0,
    };
  }, [state?.code, state?.turn, state?.moveLeft, state?.gameLeft, state?.ended]);

  const applyKey = useCallback((key: string | null) => {
    keyRef.current = key;
    setConnected(Boolean(key));
    if (key) setScreen((s) => (s === "home" ? "menu" : s));
    else {
      setState(null);
      setScreen("home");
    }
  }, []);

  useEffect(() => {
    let live = true;
    let stopWatch = () => {};
    try {
      const stored = localStorage.getItem(PLAYER_KEY) || sessionStorage.getItem(PLAYER_KEY);
      if (stored) applyKey(stored);
    } catch {
      /* ignore */
    }
    void (async () => {
      const { key, installed: has } = await restoreNoir();
      if (!live) return;
      setInstalled(has);
      if (key) applyKey(key);
      await waitForNoir(8000);
      if (!live) return;
      stopWatch = watchNoir((next) => {
        if (live) applyKey(next);
      });
    })();
    const q = new URLSearchParams(window.location.search).get("join");
    if (q) setJoinCode(q.toUpperCase());
    return () => {
      live = false;
      stopWatch();
    };
  }, [applyKey]);

  const connect = useCallback(async () => {
    setHint("");
    try {
      const key = await connectNoir();
      applyKey(key);
      setInstalled(true);
    } catch (e) {
      setInstalled(false);
      setHint(e instanceof Error ? e.message : "Connect was cancelled.");
    }
  }, [applyKey]);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    const key = keyRef.current;
    if (!ws || ws.readyState !== 1 || !key) {
      setHint("Connect Noir first.");
      return false;
    }
    ws.send(JSON.stringify({ ...msg, playerKey: key }));
    return true;
  }, []);

  const enterRoom = useCallback(() => {
    const stored = readRoom();
    const q = new URLSearchParams(location.search).get("join");
    if (q && !stored) send({ type: "join", code: q });
    else send({ type: "sync", code: stored || "" });
  }, [send]);

  const ensureSocket = useCallback((): Promise<WebSocket> => {
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      if (existing.readyState === WebSocket.OPEN) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        existing.addEventListener("open", () => resolve(existing), { once: true });
        existing.addEventListener("error", () => reject(new Error("Could not reach the game server.")), { once: true });
      });
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      let msg: { type?: string; error?: string; code?: string; mode?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "idle") {
        writeRoom(null);
        const q = new URLSearchParams(location.search).get("join");
        if (q) send({ type: "join", code: q });
        return;
      }
      if (msg.type === "error") {
        setHint(msg.error || "Something went wrong.");
        return;
      }
      if (msg.type === "left") {
        writeRoom(null);
        setState(null);
        setScreen("menu");
        history.replaceState(null, "", "/");
      }
      if (msg.type === "state") {
        setHint("");
        setState(msg as GameState);
        setScreen("table");
        setJoinOpen(false);
        writeRoom(String(msg.code || ""));
        const url = new URL(location.href);
        if (msg.mode === "pvp") url.searchParams.set("join", String(msg.code || ""));
        else url.searchParams.delete("join");
        history.replaceState(null, "", url);
      }
    };
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
      if (!keyRef.current) return;
      window.setTimeout(() => {
        if (wsRef.current || !keyRef.current) return;
        void ensureSocket()
          .then(() => enterRoom())
          .catch(() => {});
      }, 700);
    };
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error("Could not reach the game server."));
    });
  }, [enterRoom, send]);

  useEffect(() => {
    if (!connected || !keyRef.current) return;
    let dead = false;
    void ensureSocket()
      .then(() => {
        if (!dead) enterRoom();
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [connected, ensureSocket, enterRoom]);

  const needNoir = useCallback(() => {
    if (connected) return false;
    setShakeConnect(true);
    setTimeout(() => setShakeConnect(false), 500);
    setHint("Connect Noir (top right).");
    return true;
  }, [connected]);

  const createGame = useCallback(
    async (vs: "pvp" | "cpu") => {
      if (needNoir()) return;
      try {
        await ensureSocket();
        send({ type: "create", vs });
      } catch (e) {
        setHint(e instanceof Error ? e.message : "Could not start a game.");
      }
    },
    [ensureSocket, needNoir, send],
  );

  const joinGame = useCallback(async () => {
    if (needNoir()) return;
    try {
      await ensureSocket();
      send({ type: "join", code: joinCode });
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not join.");
    }
  }, [ensureSocket, joinCode, needNoir, send]);

  const leave = useCallback(() => {
    send({ type: "leave" });
    writeRoom(null);
    setState(null);
    setScreen("menu");
    history.replaceState(null, "", "/");
  }, [send]);

  const me = state?.players.find((p) => p.mark === state.you);
  const opp = state?.players.find((p) => p.mark !== state.you);
  const win = state ? winningLine(state.board) : null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const share = state ? `${origin}/?join=${state.code}` : "";
  const elapsed = now - clockRef.current.t;
  const moveLeft = Math.max(0, clockRef.current.move - elapsed);
  const gameLeft = Math.max(0, clockRef.current.game - elapsed);

  let status = "";
  if (state) {
    if (state.waiting) status = "Waiting";
    else if (state.ended) status = "";
    else if (!opp?.online && state.mode === "pvp") status = "Opponent reconnecting";
    else status = state.turn === state.you ? "Your move" : "Their move";
  }

  function endTitle() {
    if (!state?.ended) return "";
    if (state.draw || state.reason === "game-timeout") return state.reason === "game-timeout" ? "Time" : "Draw";
    if (state.winner === state.you) return "You win";
    return "They win";
  }

  function endSub() {
    if (state?.reason === "move-timeout") return "Move clock ran out.";
    if (state?.reason === "disconnect") return "Someone didn’t return.";
    if (state?.reason === "leave") return "Someone left.";
    if (state?.reason === "game-timeout") return "Match clock ran out.";
    return "";
  }

  return (
    <div className="shell">
      <Mosaic />
      <div className="veil" />
      <header className="nav">
        <div className="brand">ZADDR</div>
        <div className="nav-right">
          <span className={"dot" + (connected ? " on" : "")} />
          <button
            type="button"
            className="ghost"
            onClick={connect}
            disabled={connected}
            style={shakeConnect ? { boxShadow: "0 0 0 2px var(--gold)" } : undefined}
          >
            {connected ? "Connected" : "Connect Noir"}
          </button>
        </div>
      </header>

      {screen !== "table" && (
        <main className="center">
          <p className="kicker">2,800 · shielded</p>
          <h1>Nice to not meet you.</h1>
          <p className="caption">Every face is public. Every owner isn’t.</p>

          {screen === "home" && (
            <p className="hint">
              {hint || "Connect Noir to play."}
              {installed === false && (
                <>
                  {" "}
                  <a href="https://chromewebstore.google.com/detail/noir-wallet/mfoghjbpfanobmnoemoepenjjcmfpmdn">
                    Get Noir
                  </a>
                </>
              )}
            </p>
          )}

          {screen === "menu" && (
            <>
              <div className="menu-list">
                <button type="button" className="text" onClick={() => createGame("pvp")}>
                  Create room
                </button>
                <button type="button" className="text" onClick={() => setJoinOpen(true)}>
                  Join room
                </button>
                <button type="button" className="text" onClick={() => createGame("cpu")}>
                  Play computer
                </button>
              </div>
              {hint && <p className="hint">{hint}</p>}
            </>
          )}
        </main>
      )}

      {screen === "table" && state && (
        <section className="table">
          <article className="seat me">
            <div className="label">You</div>
            <Face id={me?.faceId} empty={!me} />
            <div className="tag">{me ? `#${String(me.faceId).padStart(4, "0")}` : "—"}</div>
          </article>

          <div className="arena">
            <div className="status">{status}</div>
            {!state.ended && !state.waiting && (
              <div className="clocks">
                <span>
                  Move <b>{fmt(moveLeft)}</b>
                </span>
                <span>
                  Game <b>{fmt(gameLeft)}</b>
                </span>
              </div>
            )}
            {state.waiting && (
              <div className="share">
                Code <code>{state.code}</code>
                <button
                  type="button"
                  className="ghost"
                  style={{ marginLeft: "0.6rem", padding: "0.35rem 0.6rem" }}
                  onClick={() => navigator.clipboard?.writeText(share)}
                >
                  Copy link
                </button>
                <button
                  type="button"
                  className="ghost"
                  style={{ marginLeft: "0.4rem", padding: "0.35rem 0.6rem" }}
                  onClick={leave}
                >
                  Leave
                </button>
                <span className="link">{share}</span>
              </div>
            )}
            <div className="board">
              {state.board.map((mark, i) => (
                <button
                  type="button"
                  key={i}
                  className={"cell" + (win?.includes(i) ? " win" : "")}
                  disabled={Boolean(mark) || state.ended || state.waiting || state.turn !== state.you}
                  onClick={() => send({ type: "move", cell: i })}
                >
                  {mark || ""}
                </button>
              ))}
            </div>
            {hint && <p className="hint">{hint}</p>}
          </div>

          <article className="seat opp">
            <div className="label">{opp?.cpu ? "Computer" : "Opponent"}</div>
            <Face id={opp?.faceId} empty={!opp} />
            <div className="tag">
              {opp ? `#${String(opp.faceId).padStart(4, "0")}` : "Waiting"}
              {opp && opp.online === false ? " · away" : ""}
            </div>
          </article>

          {state.ended && (
            <div className="end">
              <h2>{endTitle()}</h2>
              {endSub() && <p className="caption">{endSub()}</p>}
              <button type="button" onClick={() => send({ type: "again" })}>
                Play again
              </button>
              <button type="button" className="ghost" onClick={leave}>
                Menu
              </button>
            </div>
          )}
        </section>
      )}

      {joinOpen && (
        <div className="modal" onClick={() => setJoinOpen(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Join room</h2>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && joinGame()}
            />
            <div className="panel-row">
              <button type="button" onClick={joinGame}>
                Join
              </button>
              <button type="button" className="ghost" onClick={() => setJoinOpen(false)}>
                Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
