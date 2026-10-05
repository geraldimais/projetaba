import fs from "node:fs";
import http from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { PORT, UPLOADS } from "./config.js";
import { initDb } from "./db.js";
import { startGc } from "./services/sessionStore.js";
import { bindSocket, restoreLiveSessions } from "./socket/index.js";

fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(`${UPLOADS}/_tmp`, { recursive: true });

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  path: "/socket.io",
  maxHttpBufferSize: 512 * 1024,
  perMessageDeflate: false,
});
app.set("io", io);
bindSocket(io);
startGc();

initDb()
  .then(async () => {
    try {
      await restoreLiveSessions();
    } catch (error) {
      console.error("Falha ao restaurar sessões ao vivo", error);
    }
    server.timeout = 15 * 60 * 1000;
    server.headersTimeout = 16 * 60 * 1000;
    server.requestTimeout = 15 * 60 * 1000;
    server.listen(PORT, () => {
      console.log(`PROJET-ABA on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao iniciar a base de dados", error);
    process.exit(1);
  });
