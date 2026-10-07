import fsPromises from "node:fs/promises";
import path from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import { COOKIE_NAME, MAX_FILES, PUBLIC_URL, cookieSecure } from "../config.js";
import {
  findLiveSessionByUser,
  getPresentation,
  insertProjectionSession,
  recordEvent,
  savePresentation,
  updateSessionStats,
  upsertSessionFile,
} from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { loadSession, presenterKeyFrom, requireOperator } from "../middleware/presenterAuth.js";
import { attachPresentation, describeUpload } from "../services/fileProcessor.js";
import { describeUrl } from "../services/urlPresentation.js";
import {
  destroySession,
  getSession,
  publicSnapshot,
  saveSession,
  touch,
} from "../services/sessionStore.js";
import { resolveInside, sessionDir } from "../util/safePath.js";
import { createPresenterKey, createSessionToken, hashPresenterKey, keysMatch, tokenKey } from "../util/tokens.js";
import { handleMulter, makeUploader } from "../util/upload.js";

const upload = makeUploader();
const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 8, standardHeaders: true });

export const sessionsRouter = express.Router();

function originOf(req) {
  if (PUBLIC_URL) {
    return PUBLIC_URL;
  }
  return `${req.protocol}://${req.get("host")}`;
}

function urlsFor(req, token) {
  const origin = originOf(req);
  return {
    telaoUrl: `${origin}/telao/${token}`,
    projectionUrl: `${origin}/telao/${token}`,
    presenterUrl: `${origin}/palestrante/${token}`,
  };
}

async function persistFile(session, entry) {
  await upsertSessionFile({
    fileId: entry.fileId,
    sessionToken: session.token,
    presentationId: entry.presentationId || entry.fileId,
    originalName: entry.originalName,
    mime: entry.mime,
    kind: entry.kind,
    pageCount: entry.pageCount,
    storedRelPath: entry.storedRelPath,
  });
}

sessionsRouter.get("/live", requireAuth, async (req, res, next) => {
  try {
    const row = await findLiveSessionByUser(req.user.id);
    const memory = row ? getSession(row.token) : null;
    res.json({ session: memory ? publicSnapshot(memory) : null });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/", requireAuth, createLimiter, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.presentationIds)
      ? req.body.presentationIds.map(String)
      : req.body?.presentationId
        ? [String(req.body.presentationId)]
        : [];
    if (!ids.length) {
      res.status(400).json({ error: "Selecione ao menos uma apresentação para projetar." });
      return;
    }
    const existing = await findLiveSessionByUser(req.user.id);
    if (existing && getSession(existing.token)) {
      res.status(409).json({
        error: "Já existe uma projeção ao vivo. Encerre-a ou continue nela.",
        token: existing.token,
      });
      return;
    }
    const presenterKey = createPresenterKey();
    const token = createSessionToken();
    const session = {
      token,
      userId: req.user.id,
      presenterKeyHash: hashPresenterKey(presenterKey),
      title: String(req.body?.title || "Sessão PROJET-ABA").slice(0, 80),
      status: "live",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      currentIndex: 0,
      activeFileId: null,
      files: [],
      presenterSocketId: null,
      viewers: new Map(),
      viewerPeak: 0,
      viewerJoins: 0,
      slideChanges: 0,
    };
    await fsPromises.mkdir(sessionDir(tokenKey(token)), { recursive: true });
    for (const id of ids.slice(0, MAX_FILES)) {
      const presentation = await getPresentation(id, { blob: true });
      if (!presentation || Number(presentation.userId) !== Number(req.user.id)) {
        const error = new Error("Uma das apresentações não pertence a esta conta.");
        error.status = 404;
        throw error;
      }
      const entry = await attachPresentation(session, presentation);
      await persistFile(session, entry);
    }
    if (!session.files.length) {
      res.status(400).json({ error: "Não foi possível carregar as apresentações." });
      return;
    }
    saveSession(session);
    await insertProjectionSession({
      token,
      userId: req.user.id,
      presenterKeyHash: session.presenterKeyHash,
      title: session.title,
      activeFileId: session.activeFileId,
    });
    await recordEvent({
      sessionToken: token,
      userId: req.user.id,
      type: "session_start",
      payload: { presentationIds: ids },
    });
    const urls = urlsFor(req, token);
    res.cookie(COOKIE_NAME, presenterKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(req),
      path: "/",
    });
    res.status(201).json({ token, presenterKey, ...urls, session: publicSnapshot(session) });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/:token", loadSession, async (req, res, next) => {
  try {
    const urls = urlsFor(req, req.session.token);
    res.json({
      ...publicSnapshot(req.session),
      telaoUrl: urls.telaoUrl,
      projectionUrl: urls.projectionUrl,
      presenterUrl: urls.presenterUrl,
    });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:token/auth", optionalAuth, (req, res) => {
  const session = getSession(req.params.token);
  if (!session || session.status !== "live") {
    res.status(404).json({ error: "Sessão não encontrada." });
    return;
  }
  const key = presenterKeyFrom(req);
  if (key && keysMatch(session.presenterKeyHash, key)) {
    res.cookie(COOKIE_NAME, key, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure(req),
      path: "/",
    });
  }
  res.json({ ok: true, token: session.token, owner: Boolean(req.user && Number(req.user.id) === Number(session.userId)) });
});

sessionsRouter.post("/:token/select", optionalAuth, requireOperator, async (req, res, next) => {
  try {
    const presentationId = String(req.body?.presentationId || "");
    const presentation = await getPresentation(presentationId, { blob: true });
    if (!presentation || Number(presentation.userId) !== Number(req.session.userId)) {
      res.status(404).json({ error: "Apresentação não encontrada nesta conta." });
      return;
    }
    const entry = await attachPresentation(req.session, presentation);
    req.session.activeFileId = entry.fileId;
    req.session.currentIndex = 0;
    req.session.currentUrl = entry.kind === "url" ? entry.sourceUrl : null;
    req.session.mirroring = false;
    req.session.yt = entry.kind === "url" ? req.session.yt : null;
    touch(req.session);
    await persistFile(req.session, entry);
    await updateSessionStats(req.session.token, {
      active_file_id: entry.fileId,
      current_index: 0,
      last_activity_at: new Date(),
    });
    await recordEvent({
      sessionToken: req.session.token,
      userId: req.session.userId,
      type: "presentation_switch",
      payload: { presentationId },
    });
    const io = req.app.get("io");
    const room = `session:${tokenKey(req.session.token)}`;
    io?.to(room).emit("view:mirror", { active: false });
    io?.to(room).emit("session:state", publicSnapshot(req.session));
    io?.to(room).emit("slide:changed", {
      fileId: entry.fileId,
      index: 0,
      currentUrl: entry.kind === "url" ? entry.sourceUrl : null,
    });
    res.json({ session: publicSnapshot(req.session) });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post("/:token/url", optionalAuth, requireOperator, async (req, res, next) => {
  try {
    const described = await describeUrl(req.body?.url);
    const saved = await savePresentation({
      id: described.id,
      userId: req.session.userId,
      title: described.title,
      originalName: described.originalName,
      mime: described.mime,
      kind: described.kind,
      pageCount: described.pageCount,
      sizeBytes: 0,
      sourceUrl: described.sourceUrl,
    });
    const entry = await attachPresentation(req.session, saved);
    req.session.activeFileId = entry.fileId;
    req.session.currentIndex = 0;
    req.session.currentUrl = entry.sourceUrl;
    touch(req.session);
    await persistFile(req.session, entry);
    await updateSessionStats(req.session.token, {
      active_file_id: entry.fileId,
      current_index: 0,
      last_activity_at: new Date(),
    });
    const io = req.app.get("io");
    io?.to(`session:${tokenKey(req.session.token)}`).emit("session:state", publicSnapshot(req.session));
    io?.to(`session:${tokenKey(req.session.token)}`).emit("slide:changed", { fileId: entry.fileId, index: 0 });
    res.status(201).json({ session: publicSnapshot(req.session) });
  } catch (error) {
    next(error);
  }
});

sessionsRouter.post(
  "/:token/files",
  optionalAuth,
  requireOperator,
  uploadLimiter,
  handleMulter(upload.array("file", MAX_FILES)),
  async (req, res, next) => {
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
        const described = await describeUpload(file);
        const saved = await savePresentation({
          id: described.id,
          userId: req.session.userId,
          title: path.parse(described.originalName).name.slice(0, 180),
          originalName: described.originalName,
          mime: described.mime,
          kind: described.kind,
          pageCount: described.pageCount,
          sizeBytes: described.sizeBytes,
          tempPath: described.tempPath,
        });
        const entry = await attachPresentation(req.session, saved);
        await persistFile(req.session, entry);
        processed.push(entry);
      }
      touch(req.session);
      const io = req.app.get("io");
      io?.to(`session:${tokenKey(req.session.token)}`).emit("session:state", publicSnapshot(req.session));
      res.status(201).json({ files: processed, session: publicSnapshot(req.session) });
    } catch (error) {
      next(error);
    }
  }
);

sessionsRouter.get("/:token/files/:fileId", loadSession, async (req, res, next) => {
  try {
    const file = req.session.files.find((item) => item.fileId === req.params.fileId);
    if (!file || file.kind === "url") {
      res.status(404).json({ error: "Arquivo não encontrado." });
      return;
    }
    const abs = resolveInside(sessionDir(tokenKey(req.session.token)), file.renderRelPath || file.storedRelPath);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Accept-Ranges", "bytes");
    const mime =
      file.kind === "pptx"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : file.kind === "video"
          ? file.mime || "video/mp4"
          : file.mime || "application/octet-stream";
    res.type(mime);
    res.sendFile(abs);
  } catch (error) {
    next(error);
  }
});

sessionsRouter.get("/:token/media/:fileId/:name", loadSession, async (req, res, next) => {
  try {
    const file = req.session.files.find((item) => item.fileId === req.params.fileId);
    const name = path.basename(String(req.params.name || ""));
    if (!file || !name || !/\.(mp4|webm|mov|m4v)$/i.test(name)) {
      res.status(404).json({ error: "Vídeo não encontrado." });
      return;
    }
    const abs = resolveInside(sessionDir(tokenKey(req.session.token)), "media", file.fileId, name);
    await fsPromises.access(abs);
    const ext = path.extname(name).toLowerCase();
    const mime = ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "bytes");
    res.type(mime);
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
    const jsonPath = path.join(dir, `${index}.json`);
    try {
      const json = await fsPromises.readFile(jsonPath, "utf8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("json").send(json);
      return;
    } catch {
      // raster fallback
    }
    const names = await fsPromises.readdir(dir).catch(() => []);
    const match = names.find((name) => name.startsWith(`${index}.`) && !name.endsWith(".json"));
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

sessionsRouter.post("/:token/end", optionalAuth, requireOperator, async (req, res, next) => {
  try {
    req.session.status = "ended";
    const io = req.app.get("io");
    io?.to(`session:${tokenKey(req.session.token)}`).emit("session:ended", { token: req.session.token });
    await updateSessionStats(req.session.token, {
      status: "ended",
      ended_at: new Date(),
      last_activity_at: new Date(),
      viewer_peak: req.session.viewerPeak || 0,
      viewer_joins: req.session.viewerJoins || 0,
      slide_changes: req.session.slideChanges || 0,
    });
    await recordEvent({
      sessionToken: req.session.token,
      userId: req.session.userId,
      type: "session_end",
      payload: {
        viewerPeak: req.session.viewerPeak || 0,
        slideChanges: req.session.slideChanges || 0,
      },
    });
    await destroySession(req.session.token);
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ status: "ended" });
  } catch (error) {
    next(error);
  }
});
