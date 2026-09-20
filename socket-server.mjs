import { createServer } from "node:http";
import { attachGame } from "./lib/rooms.mjs";

const port = Number(process.env.PORT || 3000);

const server = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("ZADDR XO game server. WebSocket path: /ws\n");
});

attachGame(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`game server listening on :${port}`);
});
