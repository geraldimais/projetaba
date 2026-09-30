import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { extractPptxSlides } from "./pptxExtractor.js";
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
  return null;
}

async function countPdfPages(filePath) {
  const bytes = await fs.readFile(filePath);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf.getPageCount();
}

export async function processUpload(session, file) {
  const detected = detectKind(file);
  if (!detected) {
    throw Object.assign(new Error("Tipo de arquivo não suportado. Use PDF, PPTX, PNG, JPG ou WEBP."), {
      status: 415,
    });
  }
  if (path.extname(file.originalname || "").toLowerCase() === ".ppt") {
    throw Object.assign(new Error("PPT legado não é suportado. Exporte para PPTX ou PDF."), { status: 415 });
  }

  const fileId = crypto.randomBytes(8).toString("hex");
  const key = tokenKey(session.token);
  const root = sessionDir(key);
  const originalDir = resolveInside(root, "original");
  const slidesDir = resolveInside(root, "slides", fileId);
  await fs.mkdir(originalDir, { recursive: true });
  const storedName = `${fileId}${detected.ext}`;
  const storedPath = resolveInside(originalDir, storedName);
  await fs.copyFile(file.path, storedPath);
  await fs.unlink(file.path).catch(() => {});

  const entry = {
    fileId,
    originalName: path.basename(file.originalname || storedName).slice(0, 180),
    mime: file.mimetype,
    kind: detected.kind,
    storedRelPath: path.join("original", storedName),
    pageCount: 0,
    processingStatus: "pending",
    hasExtractedSlides: false,
  };

  try {
    if (detected.kind === "pdf") {
      entry.pageCount = await countPdfPages(storedPath);
      entry.hasExtractedSlides = false;
    } else if (detected.kind === "image") {
      await fs.mkdir(slidesDir, { recursive: true });
      const dest = resolveInside(slidesDir, `0${detected.ext}`);
      await fs.copyFile(storedPath, dest);
      entry.pageCount = 1;
      entry.hasExtractedSlides = true;
    } else if (detected.kind === "pptx") {
      const result = await extractPptxSlides(storedPath, slidesDir);
      entry.pageCount = result.pageCount;
      entry.hasExtractedSlides = true;
    }
    entry.processingStatus = "ready";
  } catch (error) {
    entry.processingStatus = "failed";
    throw error;
  }

  session.files.push(entry);
  if (!session.activeFileId) {
    session.activeFileId = fileId;
    session.currentIndex = 0;
  }
  return entry;
}
