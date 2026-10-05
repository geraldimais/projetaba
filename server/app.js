import fs from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { DIST } from "./config.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { browseRouter } from "./routes/browse.js";
import { presentationsRouter } from "./routes/presentations.js";
import { sessionsRouter } from "./routes/sessions.js";
import { siteRouter } from "./routes/site.js";
import { fileTooLargeError, isFileTooLarge } from "./util/upload.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/presentations", presentationsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/sessions", sessionsRouter);
  app.use("/api/browse", browseRouter);
  app.use("/navegar", siteRouter);

  if (fs.existsSync(DIST)) {
    app.use(
      express.static(DIST, {
        setHeaders(res, filePath) {
          if (filePath.endsWith(".wasm")) {
            res.setHeader("Content-Type", "application/wasm");
          }
        },
      })
    );
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api") || req.path.startsWith("/socket.io") || req.path.startsWith("/navegar")) {
        next();
        return;
      }
      res.sendFile(path.join(DIST, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    if (isFileTooLarge(error)) {
      const tooLarge = fileTooLargeError();
      res.status(tooLarge.status).json({ error: tooLarge.message });
      return;
    }
    const status = error.status || 500;
    if (status >= 500) {
      console.error(error);
      res.status(500).json({ error: "Erro interno." });
      return;
    }
    res.status(status).json({ error: error.message || "Pedido inválido." });
  });

  return app;
}
