import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { attachGame } from "./lib/rooms.mjs";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname: "localhost", port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  handle(req, res, parse(req.url || "/", true));
});

attachGame(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`http://localhost:${port}`);
});
