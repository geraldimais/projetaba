import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { libraryFilePath } from "../config.js";
import { extractPptxSlides, extractPptxVideos, writeSlimPptx } from "./pptxExtractor.js";
import { resolveInside, sessionDir } from "../util/safePath.js";
import { tokenKey } from "../util/tokens.js";

const TYPES = {
  "application/pdf": { kind: "pdf", ext: ".pdf" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    kind: "pptx",
    ext: ".pptx",
  },
  "image/jpeg": { kind: "image", ext: ".jpg" },
  "image/png": { kind: "image", ext: ".png" },
  "image/webp": { kind: "image", ext: ".webp" },
  "video/mp4": { kind: "video", ext: ".mp4" },
  "video/webm": { kind: "video", ext: ".webm" },
  "video/quicktime": { kind: "video", ext: ".mov" },
};

export function detectKind(file) {
  const mime = file.mimetype;
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (TYPES[mime]) {
    return TYPES[mime];
  }
  if (ext === ".pdf") {
    return TYPES["application/pdf"];
  }
  if (ext === ".pptx") {
    return TYPES["application/vnd.openxmlformats-officedocument.presentationml.presentation"];
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return TYPES["image/jpeg"];
  }
  if (ext === ".png") {
    return TYPES["image/png"];
  }
  if (ext === ".webp") {
    return TYPES["image/webp"];
  }
  if (ext === ".mp4") {
    return TYPES["video/mp4"];
  }
  if (ext === ".webm") {
    return TYPES["video/webm"];
  }
  if (ext === ".mov" || ext === ".m4v") {
    return TYPES["video/quicktime"];
  }
  return null;
}

export async function describeUpload(file) {
  const detected = detectKind(file);
  if (!detected) {
    throw Object.assign(new Error("Tipo de arquivo não suportado. Use PDF, PPTX, PNG, JPG, WEBP, MP4 ou WEBM."), {
      status: 415,
    });
  }
  if (path.extname(file.originalname || "").toLowerCase() === ".ppt") {
    throw Object.assign(new Error("PPT legado não é suportado. Exporte para PPTX ou PDF."), { status: 415 });
  }
  const stat = await fs.stat(file.path);
  let pageCount = 1;
  if (detected.kind === "pdf") {
    const bytes = await fs.readFile(file.path);
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    pageCount = pdf.getPageCount();
  } else if (detected.kind === "pptx") {
    const result = await extractPptxSlides(file.path);
    pageCount = result.pageCount;
  }
  return {
    id: crypto.randomBytes(8).toString("hex"),
    originalName: path.basename(file.originalname || `arquivo${detected.ext}`).slice(0, 180),
    mime: file.mimetype || detected.kind,
    kind: detected.kind,
    ext: detected.ext,
    pageCount,
    sizeBytes: stat.size,
    tempPath: file.path,
  };
}

export async function attachPresentation(session, presentation) {
  if (presentation.kind === "url") {
    const fileId = presentation.id;
    const sourceUrl = presentation.sourceUrl;
    const entry = {
      fileId,
      presentationId: presentation.id,
      originalName: presentation.originalName || presentation.title,
      mime: "text/html",
      kind: "url",
      sourceUrl,
      history: [sourceUrl],
      storedRelPath: "url",
      pageCount: 1,
      processingStatus: "ready",
      hasExtractedSlides: false,
    };
    session.files = session.files.filter((item) => item.fileId !== fileId);
    session.files.push(entry);
    if (!session.activeFileId) {
      session.activeFileId = fileId;
      session.currentIndex = 0;
      session.currentUrl = sourceUrl;
    }
    return entry;
  }
  const detected =
    detectKind({
      mimetype: presentation.mime,
      originalname: presentation.originalName,
    }) || { kind: presentation.kind, ext: path.extname(presentation.originalName || "") || ".bin" };
  const fileId = presentation.id;
  const key = tokenKey(session.token);
  const root = sessionDir(key);
  const originalDir = resolveInside(root, "original");
  const slidesDir = resolveInside(root, "slides", fileId);
  await fs.mkdir(originalDir, { recursive: true });
  const storedName = `${fileId}${detected.ext}`;
  const storedPath = resolveInside(originalDir, storedName);
  const source = presentation.diskPath || presentation.tempPath || libraryFilePath(presentation.id);
  try {
    await fs.copyFile(source, storedPath);
  } catch {
    if (presentation.buffer) {
      await fs.writeFile(storedPath, presentation.buffer);
    } else {
      throw Object.assign(new Error("Arquivo da apresentação indisponível."), { status: 404 });
    }
  }

  let videos = [];
  let renderRelPath = path.join("original", storedName);
  if (detected.kind === "image") {
    await fs.mkdir(slidesDir, { recursive: true });
    await fs.copyFile(storedPath, resolveInside(slidesDir, `0${detected.ext}`));
  }
  if (detected.kind === "pptx") {
    const mediaDir = resolveInside(root, "media", fileId);
    try {
      const extracted = await extractPptxVideos(storedPath, mediaDir);
      videos = extracted.videos || [];
      if (videos.length) {
        const slimName = `${fileId}.slim.pptx`;
        await writeSlimPptx(storedPath, resolveInside(originalDir, slimName));
        renderRelPath = path.join("original", slimName);
      }
    } catch (error) {
      console.error("Falha ao extrair vídeos do PPTX", error);
    }
  }

  const entry = {
    fileId,
    presentationId: presentation.id,
    originalName: presentation.originalName,
    mime: presentation.mime,
    kind: presentation.kind,
    storedRelPath: path.join("original", storedName),
    renderRelPath,
    videos,
    pageCount: presentation.pageCount || 1,
    processingStatus: "ready",
    hasExtractedSlides: detected.kind === "image",
  };
  session.files = session.files.filter((item) => item.fileId !== fileId);
  session.files.push(entry);
  if (!session.activeFileId) {
    session.activeFileId = fileId;
    session.currentIndex = 0;
  }
  return entry;
}

export async function processUpload(session, file) {
  const described = await describeUpload(file);
  return attachPresentation(session, {
    id: described.id,
    originalName: described.originalName,
    mime: described.mime,
    kind: described.kind,
    pageCount: described.pageCount,
    tempPath: described.tempPath,
  });
}
