"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Face from "@/components/Face";
import { FACE_IDS, faceUrl } from "@/lib/mosaic";
import { connectNoir, disconnectNoir, PLAYER_KEY, restoreNoir, waitForNoir, watchNoir } from "@/lib/noir";
import { bootSfx, sfx } from "@/lib/sfx";

type Screen = "home" | "table";
type Mark = "X" | "O";
type Player = { mark: Mark; faceId: number; cpu?: boolean; online?: boolean };
type Round = { round: number; winner: Mark | null; draw: boolean; reason: string | null };
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
  round: number;
  lastCell: number | null;
  history: Round[];
  score: { X: number; O: number; D: number };
  seriesGoal: number;
  seriesOver: boolean;
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
    return localStorage.getItem(ROOM_KEY) || sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

function writeRoom(code: string | null) {
  try {
    if (code) localStorage.setItem(ROOM_KEY, code);
    else localStorage.removeItem(ROOM_KEY);
    sessionStorage.removeItem(ROOM_KEY);
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

function glyph(r: Round) {
  if (r.draw) return "–";
  return r.winner || "·";
}

export default function GameApp() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [mpOpen, setMpOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [hint, setHint] = useState("");
  const [shakeConnect, setShakeConnect] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const keyRef = useRef<string | null>(null);
  const prevRef = useRef<GameState | null>(null);
  const clockRef = useRef({ t: 0, move: 0, game: 0, sig: "" });
  const now = useNow(Boolean(state && !state.ended && !state.waiting));
  const clockSig = state
    ? `${state.code}:${state.round}:${state.turn}:${state.moveLeft}:${state.gameLeft}:${state.ended}`
    : "";
  if (state && clockRef.current.sig !== clockSig) {
    clockRef.current = {
      t: Date.now(),
      move: state.moveLeft || 0,
      game: state.gameLeft || 0,
      sig: clockSig,
    };
  }

  useEffect(() => {
    bootSfx();
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!state) return;
    if (!prev || prev.code !== state.code) {
      if (!state.waiting) sfx("join");
      return;
    }
    if (!prev.waiting && state.waiting === false && prev.players.length < state.players.length) sfx("join");
    if (prev.lastCell !== state.lastCell && state.lastCell != null) {
      const mark = state.board[state.lastCell];
      sfx(mark === state.you ? "place" : "cpu");
    }
    if (!prev.ended && state.ended) {
      if (state.reason === "move-timeout" || state.reason === "game-timeout") sfx("timeout");
      else if (state.draw) sfx("draw");
      else if (state.winner === state.you) sfx("win");
      else sfx("lose");
    }
  }, [state]);

  const applyKey = useCallback((key: string | null) => {
    keyRef.current = key;
    setConnected(Boolean(key));
    if (!key) {
      setState(null);
      setScreen("home");
      setMpOpen(false);
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
    if (q) {
      setJoinCode(q.toUpperCase());
      setMpOpen(true);
    }
    return () => {
      live = false;
      stopWatch();
    };
  }, [applyKey]);

  const connect = useCallback(async () => {
    setHint("");
    sfx("ui");
    try {
      const key = await connectNoir();
      applyKey(key);
      setInstalled(true);
    } catch (e) {
      setInstalled(false);
      setHint(e instanceof Error ? e.message : "Connect was cancelled.");
    }
  }, [applyKey]);

  const disconnect = useCallback(async () => {
    sfx("ui");
    writeRoom(null);
    setState(null);
    setScreen("home");
    history.replaceState(null, "", "/");
    await disconnectNoir();
    applyKey(null);
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
        setScreen("home");
        setMpOpen(false);
        history.replaceState(null, "", "/");
      }
      if (msg.type === "state") {
        setHint("");
        setPick(null);
        setState(msg as GameState);
        setScreen("table");
        setMpOpen(false);
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
    sfx("ui");
    return true;
  }, [connected]);

  const createGame = useCallback(
    async (vs: "pvp" | "cpu") => {
      if (needNoir()) return;
      sfx("ui");
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
    sfx("ui");
    try {
      await ensureSocket();
      send({ type: "join", code: joinCode });
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not join.");
    }
  }, [ensureSocket, joinCode, needNoir, send]);

  const leave = useCallback(() => {
    if (state && !state.waiting && !state.ended) return;
    sfx("ui");
    send({ type: "leave" });
    writeRoom(null);
    setState(null);
    setScreen("home");
    setMpOpen(false);
    setHint("");
    history.replaceState(null, "", "/");
  }, [send, state]);

  const playCell = useCallback(
    (i: number) => {
      if (!state || state.ended || state.waiting || state.turn !== state.you || state.board[i]) return;
      setPick(i);
      send({ type: "move", cell: i });
    },
    [send, state],
  );

  const me = state?.players.find((p) => p.mark === state.you);
  const opp = state?.players.find((p) => p.mark !== state.you);
  const win = state ? winningLine(state.board) : null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const share = state ? `${origin}/?join=${state.code}` : "";
  const elapsed = Math.max(0, now - clockRef.current.t);
  const moveLeft = Math.max(0, clockRef.current.move - elapsed);
  const gameLeft = Math.max(0, clockRef.current.game - elapsed);
  const myTurn = Boolean(state && !state.ended && !state.waiting && state.turn === state.you);
  const canLeave = Boolean(state && (state.waiting || state.ended));

  let status = "";
  if (state) {
    if (state.waiting) status = "Waiting for a second face";
    else if (state.ended) status = "";
    else if (!opp?.online && state.mode === "pvp") status = "Opponent reconnecting";
    else status = myTurn ? "Your move" : "Their move";
  }

  function resultLine() {
    if (!state?.ended) return "";
    if (state.seriesOver && state.winner === state.you) return "Match won";
    if (state.seriesOver) return "Match lost";
    if (state.draw || state.reason === "game-timeout") return state.reason === "game-timeout" ? "Time · draw" : "Draw";
    if (state.winner === state.you) return "You take the round";
    return "They take the round";
  }

  function resultSub() {
    if (state?.reason === "move-timeout") return "Move clock ran out.";
    if (state?.reason === "disconnect") return "They didn’t return in time.";
    if (state?.reason === "resign") return "Round ended by resign.";
    if (state?.reason === "game-timeout") return "Match clock ran out.";
    return "";
  }

  return (
    <div className="shell">
      <Mosaic />
      <div className="veil" />
      <header className="nav">
        <button type="button" className="brand" onClick={() => canLeave && leave()}>
          ZADDR
        </button>
        <div className="nav-right">
          <span className={"dot" + (connected ? " on" : "")} />
          {connected ? (
            <button type="button" className="ghost" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="ghost"
              onClick={connect}
              style={shakeConnect ? { boxShadow: "0 0 0 2px var(--gold)" } : undefined}
            >
              Connect Noir
            </button>
          )}
        </div>
      </header>

      {screen !== "table" && (
        <main className="center">
          <p className="kicker">zaddr xo</p>
          <h1>No names. Just moves.</h1>
          <p className="caption">
            A public face takes the seat. X and O tell the story. The owner stays offscreen.
          </p>

          {!connected && (
            <p className="hint">
              {hint || "Connect Noir first."}
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

          {connected && (
            <>
              <div className="menu-list">
                <button type="button" className="text" onClick={() => createGame("cpu")}>
                  Singleplayer
                </button>
                <button
                  type="button"
                  className="text"
                  onClick={() => {
                    sfx("ui");
                    setHint("");
                    setMpOpen(true);
                  }}
                >
                  Multiplayer
                </button>
              </div>
              {hint && <p className="hint">{hint}</p>}
            </>
          )}
        </main>
      )}

      {screen === "table" && state && (
        <section className="stage">
          <aside className={"dock me" + (myTurn ? " hot" : "")}>
            <div className="label">You · {state.you}</div>
            <Face id={me?.faceId} empty={!me} />
            <div className="tag">{me ? `#${String(me.faceId).padStart(4, "0")}` : "—"}</div>
            <div className="score">
              {state.score[state.you]}<small>/{state.seriesGoal}</small> <span>wins</span>
            </div>
          </aside>

          <div className="arena">
            <div className="status">{status || `Round ${state.round}`}</div>
            {!state.ended && !state.waiting && (
              <div className="clocks">
                <span>
                  Move <b className={moveLeft < 5000 ? "low" : ""}>{fmt(moveLeft)}</b>
                </span>
                <span>
                  Round <b>{fmt(gameLeft)}</b>
                </span>
              </div>
            )}
            {state.waiting && (
              <div className="share">
                Code <code>{state.code}</code>
                <button type="button" className="ghost tiny" onClick={() => navigator.clipboard?.writeText(share)}>
                  Copy link
                </button>
                <button type="button" className="ghost tiny" onClick={leave}>
                  Leave
                </button>
                <span className="link">{share}</span>
              </div>
            )}
            <div className={"board" + (myTurn ? " live" : "")}>
              {state.board.map((mark, i) => {
                const playable = myTurn && !mark;
                return (
                  <button
                    type="button"
                    key={i}
                    className={
                      "cell" +
                      (win?.includes(i) ? " win" : "") +
                      (state.lastCell === i ? " last" : "") +
                      (pick === i ? " pick" : "") +
                      (playable ? " playable" : "")
                    }
                    disabled={!playable}
                    onMouseEnter={() => playable && setPick(i)}
                    onFocus={() => playable && setPick(i)}
                    onClick={() => playCell(i)}
                  >
                    {mark || ""}
                  </button>
                );
              })}
            </div>
            {state.ended && (
              <div className="result">
                <strong>{resultLine()}</strong>
                {resultSub() && <span>{resultSub()}</span>}
                <div className="result-row">
                  <button type="button" onClick={() => send({ type: "again" })}>
                    {state.seriesOver ? "New match" : "Next round"}
                  </button>
                  <button type="button" className="ghost" onClick={leave}>
                    Home
                  </button>
                </div>
              </div>
            )}
            {hint && <p className="hint">{hint}</p>}
          </div>

          <aside className={"dock opp" + (!myTurn && state && !state.ended && !state.waiting ? " hot" : "")}>
            <div className="label">{opp?.cpu ? "Computer" : "Opponent"} · {opp?.mark || "O"}</div>
            <Face id={opp?.faceId} empty={!opp} />
            <div className="tag">
              {opp ? `#${String(opp.faceId).padStart(4, "0")}` : "Waiting"}
              {opp && opp.online === false ? " · away" : ""}
            </div>
            <div className="score">
              {opp ? state.score[opp.mark] : 0}<small>/{state.seriesGoal}</small> <span>wins</span>
            </div>
          </aside>

          <div className="matchbar">
            <div>
              <b>First to {state.seriesGoal}</b>
              <span>Round {state.round}</span>
            </div>
            <ol className="history">
              {state.history.length === 0 && <li className="dim">No rounds yet</li>}
              {state.history.map((r) => (
                <li key={r.round} className={r.winner === state.you ? "mine" : r.draw ? "draw" : "theirs"}>
                  <span>R{r.round}</span>
                  <b>{glyph(r)}</b>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {mpOpen && (
        <div
          className="modal"
          onClick={() => {
            if (screen !== "table") setMpOpen(false);
          }}
        >
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Multiplayer</h2>
            <p className="panel-lead">One creates a room. The other types the code. Same two faces until the series ends.</p>
            <button
              type="button"
              className="wide"
              onClick={() => createGame("pvp")}
            >
              Create room
            </button>
            <div className="or">or</div>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="CODE"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && joinGame()}
            />
            <div className="panel-row">
              <button type="button" onClick={joinGame} disabled={joinCode.length < 3}>
                Join
              </button>
              <button type="button" className="ghost" onClick={() => setMpOpen(false)}>
                Back
              </button>
            </div>
            {hint && <p className="hint">{hint}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
