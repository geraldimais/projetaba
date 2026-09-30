import fs from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { DIST } from "./config.js";
import { sessionsRouter } from "./routes/sessions.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use("/api/sessions", sessionsRouter);

  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
        next();
        return;
      }
      res.sendFile(path.join(DIST, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || "Erro interno." });
  });

  return app;
}
