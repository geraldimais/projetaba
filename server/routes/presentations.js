import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_LIBRARY, UPLOADS } from "../config.js";
import { countPresentations, deletePresentation, listPresentations, savePresentation } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { describeUpload } from "../services/fileProcessor.js";
import { describeUrl } from "../services/urlPresentation.js";
import { assertSafeId, resolveInside } from "../util/safePath.js";
import { handleMulter, makeChunkUploader, makeUploader } from "../util/upload.js";

export const presentationsRouter = express.Router();

const upload = makeUploader();
const chunkUpload = makeChunkUploader();
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true });

presentationsRouter.use(requireAuth);

async function persistDescribed(userId, described, title) {
  return savePresentation({
    id: described.id,
    userId,
    title: (title || described.title || path.parse(described.originalName || "arquivo").name).slice(0, 180),
    originalName: described.originalName,
    mime: described.mime,
    kind: described.kind,
    pageCount: described.pageCount,
    sizeBytes: described.sizeBytes,
    sourceUrl: described.sourceUrl || null,
    tempPath: described.tempPath,
  });
}

presentationsRouter.get("/", async (req, res, next) => {
  try {
    res.json({ presentations: await listPresentations(req.user.id) });
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post("/url", uploadLimiter, async (req, res, next) => {
  try {
    const current = await countPresentations(req.user.id);
    if (current + 1 > MAX_LIBRARY) {
      res.status(400).json({ error: `Limite de ${MAX_LIBRARY} apresentações na biblioteca.` });
      return;
    }
    const described = await describeUrl(req.body?.url);
    const created = await persistDescribed(req.user.id, described, req.body?.title);
    res.status(201).json({ presentations: [created] });
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post("/uploads", uploadLimiter, async (req, res, next) => {
  try {
    const size = Number(req.body?.size || 0);
    const originalName = String(req.body?.originalName || "arquivo").slice(0, 180);
    if (!Number.isFinite(size) || size <= 0) {
      res.status(400).json({ error: "Tamanho do arquivo inválido." });
      return;
    }
    if (size > MAX_FILE_BYTES) {
      res.status(413).json({ error: `Arquivo grande demais. O limite é ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB por ficheiro.` });
      return;
    }
    const current = await countPresentations(req.user.id);
    if (current + 1 > MAX_LIBRARY) {
      res.status(400).json({ error: `Limite de ${MAX_LIBRARY} apresentações na biblioteca.` });
      return;
    }
    const uploadId = crypto.randomBytes(12).toString("hex");
    const dir = resolveInside(UPLOADS, "_tmp", `up-${uploadId}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify({
        uploadId,
        userId: req.user.id,
        originalName,
        mime: String(req.body?.mime || "application/octet-stream"),
        size,
        createdAt: Date.now(),
      })
    );
    res.status(201).json({ uploadId, chunkBytes: CHUNK_BYTES });
  } catch (error) {
    next(error);
  }
});

presentationsRouter.post(
  "/uploads/:uploadId/chunk",
  uploadLimiter,
  handleMulter(chunkUpload.single("chunk")),
  async (req, res, next) => {
    try {
      const uploadId = assertSafeId(req.params.uploadId, "upload");
      const dir = resolveInside(UPLOADS, "_tmp", `up-${uploadId}`);
      const metaRaw = await fs.readFile(path.join(dir, "meta.json"), "utf8").catch(() => null);
      if (!metaRaw) {
        res.status(404).json({ error: "Envio não encontrado. Recomece o carregamento." });
        return;
      }
      const meta = JSON.parse(metaRaw);
      if (Number(meta.userId) !== Number(req.user.id)) {
        res.status(404).json({ error: "Envio não encontrado. Recomece o carregamento." });
        return;
      }
      const index = Number(req.query.index);
      if (!Number.isInteger(index) || index < 0 || index > 400) {
        res.status(400).json({ error: "Parte do arquivo inválida." });
        return;
      }
      if (!req.file?.path) {
        res.status(400).json({ error: "Parte do arquivo em falta." });
        return;
      }
      const dest = resolveInside(dir, `chunk-${String(index).padStart(5, "0")}`);
      await fs.copyFile(req.file.path, dest);
      await fs.unlink(req.file.path).catch(() => {});
      const names = (await fs.readdir(dir)).filter((name) => name.startsWith("chunk-"));
      let written = 0;
      for (const name of names) {
        written += (await fs.stat(path.join(dir, name))).size;
      }
      if (written > Number(meta.size) || written > MAX_FILE_BYTES) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        res.status(413).json({ error: "O arquivo excedeu o tamanho declarado." });
        return;
      }
      res.json({ ok: true, index });
    } catch (error) {
      next(error);
    }
  }
);

presentationsRouter.post("/uploads/:uploadId/complete", uploadLimiter, async (req, res, next) => {
  let dir;
  try {
    const uploadId = assertSafeId(req.params.uploadId, "upload");
    dir = resolveInside(UPLOADS, "_tmp", `up-${uploadId}`);
    const metaRaw = await fs.readFile(path.join(dir, "meta.json"), "utf8").catch(() => null);
    if (!metaRaw) {
      res.status(404).json({ error: "Envio não encontrado. Recomece o carregamento." });
      return;
    }
    const meta = JSON.parse(metaRaw);
    if (Number(meta.userId) !== Number(req.user.id)) {
      res.status(404).json({ error: "Envio não encontrado. Recomece o carregamento." });
      return;
    }
    const names = (await fs.readdir(dir)).filter((name) => name.startsWith("chunk-")).sort();
    if (!names.length) {
      res.status(400).json({ error: "Nenhuma parte do arquivo chegou ao servidor." });
      return;
    }
    const assembled = path.join(dir, "assembled.bin");
    await fs.writeFile(assembled, "");
    for (const name of names) {
      const part = await fs.readFile(path.join(dir, name));
      await fs.appendFile(assembled, part);
    }
    const stat = await fs.stat(assembled);
    if (stat.size !== Number(meta.size)) {
      const error = new Error("O arquivo chegou incompleto. Tente enviar de novo.");
      error.status = 400;
      throw error;
    }
    const described = await describeUpload({
      path: assembled,
      originalname: meta.originalName,
      mimetype: meta.mime,
    });
    const created = await persistDescribed(req.user.id, described);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    res.status(201).json({ presentations: [created] });
  } catch (error) {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    next(error);
  }
});

presentationsRouter.post("/", uploadLimiter, handleMulter(upload.array("file", 8)), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: "Envie ao menos um arquivo." });
      return;
    }
    const current = await countPresentations(req.user.id);
    if (current + files.length > MAX_LIBRARY) {
      res.status(400).json({ error: `Limite de ${MAX_LIBRARY} apresentações na biblioteca.` });
      return;
    }
    const created = [];
    for (const file of files) {
      const described = await describeUpload(file);
      created.push(await persistDescribed(req.user.id, described));
    }
    res.status(201).json({ presentations: created });
  } catch (error) {
    next(error);
  }
});

presentationsRouter.delete("/:id", async (req, res, next) => {
  try {
    const ok = await deletePresentation(req.params.id, req.user.id);
    if (!ok) {
      res.status(404).json({ error: "Apresentação não encontrada." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
