import fs from "node:fs";
import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { PORT, UPLOADS } from "./config.js";
import { startGc } from "./services/sessionStore.js";
import { bindSocket } from "./socket/index.js";

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(`${UPLOADS}/_tmp`, { recursive: true });

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  path: "/socket.io",
});
app.set("io", io);
bindSocket(io);
startGc();

server.listen(PORT, () => {
  console.log(`PROJETABA on port ${PORT}`);
});
