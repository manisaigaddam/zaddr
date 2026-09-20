import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { pickFace } from "./faces.mjs";
import { GAME_MS, MOVE_MS, REJOIN_MS, cpuMove, lines } from "./engine.mjs";

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function code() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[b[i] % abc.length];
  return s;
}

function now() {
  return Date.now();
}

function isCpu(p) {
  return p.playerKey === "cpu";
}

function humanCount(room) {
  return room.players.filter((p) => !isCpu(p)).length;
}

function waiting(room) {
  return room.mode === "pvp" && humanCount(room) < 2;
}

function live(room) {
  return !waiting(room) && !room.ended;
}

function publicPlayers(room) {
  return room.players.map((p) => ({
    mark: p.mark,
    faceId: p.faceId,
    cpu: isCpu(p),
    online: isCpu(p) ? true : Boolean(p.ws),
  }));
}

function snapshot(room, youMark) {
  const t = now();
  return {
    type: "state",
    code: room.code,
    mode: room.mode,
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    draw: room.draw,
    forfeit: room.forfeit,
    reason: room.reason,
    players: publicPlayers(room),
    you: youMark,
    waiting: waiting(room),
    moveLeft: live(room) ? Math.max(0, (room.moveEndsAt || 0) - t) : null,
    gameLeft: live(room) ? Math.max(0, (room.gameEndsAt || 0) - t) : null,
    ended: room.ended,
    round: room.round,
    lastCell: room.lastCell,
    history: room.history,
    score: room.score,
  };
}

function broadcast(room) {
  for (const p of room.players) send(p.ws, snapshot(room, p.mark));
}

function startClocks(room) {
  const t = now();
  room.gameEndsAt = t + GAME_MS;
  room.moveEndsAt = t + MOVE_MS;
}

function bumpMove(room) {
  room.moveEndsAt = now() + MOVE_MS;
}

function record(room, { winner = null, draw = false, reason = null } = {}) {
  room.history.push({ round: room.round, winner, draw, reason });
  if (winner === "X") room.score.X += 1;
  else if (winner === "O") room.score.O += 1;
  else room.score.D += 1;
}

function finish(room, { winner = null, draw = false, forfeit = null, reason = null } = {}) {
  if (room.ended) return;
  room.ended = true;
  room.winner = winner;
  room.draw = draw;
  room.forfeit = forfeit;
  room.reason = reason;
  room.moveEndsAt = null;
  record(room, { winner, draw, reason });
}

function applyMove(room, mark, cell) {
  if (!live(room)) return false;
  if (room.turn !== mark) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || room.board[cell]) return false;
  room.board[cell] = mark;
  room.lastCell = cell;
  const w = lines(room.board);
  if (w) finish(room, { winner: w, reason: "line" });
  else if (room.board.every(Boolean)) finish(room, { draw: true, reason: "draw" });
  else {
    room.turn = mark === "X" ? "O" : "X";
    bumpMove(room);
  }
  return true;
}

function maybeCpu(room) {
  if (room.mode !== "cpu" || room.ended || room.turn !== "O") return;
  const delay = 450 + Math.floor(Math.random() * 500);
  const token = ++room.cpuGen;
  setTimeout(() => {
    if (token !== room.cpuGen || room.ended || room.turn !== "O") return;
    const i = cpuMove(room.board.slice());
    if (i == null || i < 0) return;
    applyMove(room, "O", i);
    broadcast(room);
  }, delay);
}

function resetBoard(room) {
  room.board = Array(9).fill(null);
  room.turn = "X";
  room.ended = false;
  room.winner = null;
  room.draw = false;
  room.forfeit = null;
  room.reason = null;
  room.lastCell = null;
  room.cpuGen = 0;
  room.round += 1;
  startClocks(room);
}

export function attachGame(server) {
  const rooms = new Map();
  const socketRoom = new WeakMap();
  const lastRoom = new Map();

  function getRoom(ws) {
    const c = socketRoom.get(ws);
    return c ? rooms.get(c) : undefined;
  }

  function detach(ws) {
    const room = getRoom(ws);
    socketRoom.delete(ws);
    if (!room) return;
    const p = room.players.find((x) => x.ws === ws);
    if (!p) return;
    p.ws = null;
    p.droppedAt = now();
    broadcast(room);
  }

  function seat(ws, room, player) {
    player.ws = ws;
    player.droppedAt = null;
    socketRoom.set(ws, room.code);
    lastRoom.set(player.playerKey, room.code);
  }

  function dropEmpty(room) {
    if (humanCount(room) === 0) {
      rooms.delete(room.code);
      return true;
    }
    return false;
  }

  /** Waiting = abort the unstarted room. Live = no cancel. Ended = leave the series. */
  function leaveSeat(room, playerKey) {
    const p = room.players.find((x) => x.playerKey === playerKey);
    if (!p || isCpu(p)) return { ok: false, why: "not seated" };
    if (live(room)) return { ok: false, why: "live" };

    if (p.ws) socketRoom.delete(p.ws);
    p.ws = null;
    lastRoom.delete(playerKey);
    room.players = room.players.filter((x) => x !== p);
    if (!dropEmpty(room)) broadcast(room);
    return { ok: true };
  }

  function newRoom(mode, playerKey, ws) {
    let c = code();
    while (rooms.has(c)) c = code();
    const room = {
      code: c,
      mode,
      board: Array(9).fill(null),
      turn: "X",
      ended: false,
      winner: null,
      draw: false,
      forfeit: null,
      reason: null,
      lastCell: null,
      cpuGen: 0,
      round: 1,
      history: [],
      score: { X: 0, O: 0, D: 0 },
      gameEndsAt: 0,
      moveEndsAt: 0,
      players: [{ ws, playerKey, mark: "X", faceId: pickFace([]), droppedAt: null }],
    };
    if (mode === "cpu") {
      room.players.push({
        ws: null,
        playerKey: "cpu",
        mark: "O",
        faceId: pickFace([room.players[0].faceId]),
        droppedAt: null,
      });
      startClocks(room);
    }
    rooms.set(c, room);
    seat(ws, room, room.players[0]);
    return room;
  }

  function resume(ws, playerKey, wanted) {
    const c = String(wanted || lastRoom.get(playerKey) || "").toUpperCase();
    const room = rooms.get(c);
    if (!room) return null;
    const p = room.players.find((x) => x.playerKey === playerKey);
    if (!p) return null;
    seat(ws, room, p);
    return room;
  }

  function tick() {
    const t = now();
    for (const room of [...rooms.values()]) {
      if (room.ended) continue;

      for (const p of [...room.players]) {
        if (isCpu(p) || p.ws || !p.droppedAt) continue;
        if (t - p.droppedAt < REJOIN_MS) continue;
        if (waiting(room)) {
          room.players = room.players.filter((x) => x !== p);
          lastRoom.delete(p.playerKey);
          if (!dropEmpty(room)) broadcast(room);
          continue;
        }
        finish(room, {
          winner: p.mark === "X" ? "O" : "X",
          forfeit: p.mark,
          reason: "disconnect",
        });
        broadcast(room);
      }

      if (!live(room)) continue;
      if (room.gameEndsAt && t >= room.gameEndsAt) {
        finish(room, { draw: true, reason: "game-timeout" });
        broadcast(room);
        continue;
      }
      const current = room.players.find((p) => p.mark === room.turn);
      if (current && !isCpu(current) && room.moveEndsAt && t >= room.moveEndsAt) {
        finish(room, {
          winner: room.turn === "X" ? "O" : "X",
          reason: "move-timeout",
        });
        broadcast(room);
      }
    }
  }

  setInterval(tick, 250);

  function onMsg(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: "error", error: "Bad message" });
    }
    const playerKey = String(msg.playerKey || "");
    if (!/^[a-f0-9]{64}$/.test(playerKey)) {
      return send(ws, { type: "error", error: "Connect Noir to play" });
    }

    if (msg.type === "resume" || msg.type === "sync") {
      detach(ws);
      const room = resume(ws, playerKey, msg.code);
      if (!room) return send(ws, { type: "idle" });
      return send(ws, snapshot(room, room.players.find((p) => p.playerKey === playerKey).mark));
    }

    if (msg.type === "leave") {
      const held = getRoom(ws) || rooms.get(lastRoom.get(playerKey));
      if (held) {
        const out = leaveSeat(held, playerKey);
        if (!out.ok && out.why === "live") {
          return send(ws, { type: "error", error: "The round has to finish" });
        }
      }
      return send(ws, { type: "left" });
    }

    if (msg.type === "create") {
      const prev = getRoom(ws) || rooms.get(lastRoom.get(playerKey));
      if (prev) {
        if (live(prev)) return send(ws, { type: "error", error: "Finish the round first" });
        leaveSeat(prev, playerKey);
      }
      detach(ws);
      const room = newRoom(msg.vs === "cpu" ? "cpu" : "pvp", playerKey, ws);
      return send(ws, snapshot(room, "X"));
    }

    if (msg.type === "join") {
      const room = resume(ws, playerKey, msg.code);
      if (room) return send(ws, snapshot(room, room.players.find((p) => p.playerKey === playerKey).mark));
      const c = String(msg.code || "").trim().toUpperCase();
      const fresh = rooms.get(c);
      if (!fresh) return send(ws, { type: "error", error: "Game not found" });
      if (fresh.mode === "cpu") return send(ws, { type: "error", error: "That’s a computer game" });
      if (fresh.players.some((p) => p.playerKey === playerKey)) {
        return send(ws, { type: "error", error: "Already in this game" });
      }
      if (humanCount(fresh) >= 2) return send(ws, { type: "error", error: "Game is full" });
      const held = getRoom(ws) || rooms.get(lastRoom.get(playerKey));
      if (held && live(held)) return send(ws, { type: "error", error: "Finish the round first" });
      if (held) leaveSeat(held, playerKey);
      detach(ws);
      const p = {
        ws,
        playerKey,
        mark: "O",
        faceId: pickFace(fresh.players.map((x) => x.faceId)),
        droppedAt: null,
      };
      fresh.players.push(p);
      seat(ws, fresh, p);
      startClocks(fresh);
      return broadcast(fresh);
    }

    const room = getRoom(ws);
    if (!room) return send(ws, { type: "error", error: "Not in a game" });
    const me = room.players.find((p) => p.ws === ws);
    if (!me) return;

    if (msg.type === "move") {
      if (!applyMove(room, me.mark, Number(msg.cell))) return;
      broadcast(room);
      maybeCpu(room);
      return;
    }

    if (msg.type === "again") {
      if (!room.ended) return;
      if (room.mode === "pvp" && humanCount(room) < 2) return;
      resetBoard(room);
      broadcast(room);
      maybeCpu(room);
      return;
    }
  }

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.on("message", (data) => onMsg(ws, String(data)));
    ws.on("close", () => detach(ws));
  });
}
