import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import QRCode from "qrcode";
import rateLimit from "express-rate-limit";
import { COOKIE_NAME, MAX_FILE_BYTES, MAX_FILES, PUBLIC_URL, UPLOADS } from "../config.js";
import { loadSession, presenterKeyFrom, requirePresenter } from "../middleware/presenterAuth.js";
import { processUpload } from "../services/fileProcessor.js";
import {
  destroySession,
  getSession,
  publicSnapshot,
  saveSession,
  touch,
} from "../services/sessionStore.js";
import { resolveInside, sessionDir } from "../util/safePath.js";
import {
  createPresenterKey,
  createSessionToken,
  hashPresenterKey,
  keysMatch,
  tokenKey,
} from "../util/tokens.js";

const upload = multer({
  dest: path.join(UPLOADS, "_tmp"),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true });

export const sessionsRouter = express.Router();

function originOf(req) {
  if (PUBLIC_URL) {
    return PUBLIC_URL;
  }
  return `${req.protocol}://${req.get("host")}`;
}

async function urlsFor(req, token) {
  const origin = originOf(req);
  const joinUrl = `${origin}/ver/${token}`;
  const presenterUrl = `${origin}/sessao/${token}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, {
    margin: 1,
    width: 320,
    color: { dark: "#020617", light: "#f4f7fb" },
  });
  return { joinUrl, presenterUrl, qrDataUrl };
}

sessionsRouter.post("/", createLimiter, async (req, res, next) => {
  try {
    const presenterKey = createPresenterKey();
    const token = createSessionToken();
    const session = {
      token,
      presenterKeyHash: hashPresenterKey(presenterKey),
      title: String(req.body?.title || "Sessão PROJETABA").slice(0, 80),
      status: "live",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      currentIndex: 0,
      activeFileId: null,
      files: [],
      presenterSocketId: null,
      viewers: new Map(),
    };
    await fs.mkdir(sessionDir(tokenKey(token)), { recursive: true });
    saveSession(session);
    const urls = await urlsFor(req, token);
    res.cookie(COOKIE_NAME, presenterKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      path: "/",
    });
    res.status(201).json({ token, presenterKey, ...urls });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/:token", loadSession, async (req, res, next) => {
  try {
    const urls = await urlsFor(req, req.session.token);
    res.json({ ...publicSnapshot(req.session), joinUrl: urls.joinUrl, qrDataUrl: urls.qrDataUrl });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:token/auth", (req, res) => {
  const session = getSession(req.params.token);
  if (!session) {
    res.status(404).json({ error: "Sessão não encontrada." });
    return;
  }
  const key = presenterKeyFrom(req);
  if (!keysMatch(session.presenterKeyHash, key)) {
    res.status(401).json({ error: "Chave do apresentador inválida." });
    return;
  }
  res.cookie(COOKIE_NAME, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    path: "/",
  });
  res.json({ ok: true, token: session.token });
});

sessionsRouter.post("/:token/files", uploadLimiter, requirePresenter, upload.array("file", MAX_FILES), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: "Envie ao menos um arquivo." });
      return;
    }
    if (req.session.files.length + files.length > MAX_FILES) {
      res.status(400).json({ error: `Limite de ${MAX_FILES} arquivos por sessão.` });
      return;
    }
    const processed = [];
    for (const file of files) {
      processed.push(await processUpload(req.session, file));
    }
    touch(req.session);
    const io = req.app.get("io");
    io?.to(`session:${tokenKey(req.session.token)}`).emit("session:state", publicSnapshot(req.session));
    res.status(201).json({ files: processed, session: publicSnapshot(req.session) });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/:token/files/:fileId", loadSession, async (req, res, next) => {
  try {
    const file = req.session.files.find((item) => item.fileId === req.params.fileId);
    if (!file) {
      res.status(404).json({ error: "Arquivo não encontrado." });
      return;
    }
    const abs = resolveInside(sessionDir(tokenKey(req.session.token)), file.storedRelPath);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type(file.mime || "application/octet-stream");
    res.sendFile(abs);
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/:token/slides/:fileId/:index", loadSession, async (req, res, next) => {
  try {
    const file = req.session.files.find((item) => item.fileId === req.params.fileId);
    const index = Number(req.params.index);
    if (!file || !Number.isInteger(index) || index < 0) {
      res.status(404).json({ error: "Slide não encontrado." });
      return;
    }
    const dir = resolveInside(sessionDir(tokenKey(req.session.token)), "slides", file.fileId);
    const names = await fs.readdir(dir).catch(() => []);
    const match = names.find((name) => name.startsWith(`${index}.`));
    if (!match) {
      res.status(404).json({ error: "Slide não encontrado." });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(dir, match));
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:token/end", requirePresenter, async (req, res, next) => {
  try {
    req.session.status = "ended";
    const io = req.app.get("io");
    io?.to(`session:${tokenKey(req.session.token)}`).emit("session:ended", { token: req.session.token });
    await destroySession(req.session.token);
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ status: "ended" });
  } catch (error) {
    next(error);
  }
});
