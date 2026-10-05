import path from "node:path";
import multer from "multer";
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_FILE_MB, MAX_FILES, UPLOADS } from "../config.js";

export function fileTooLargeError() {
  const error = new Error(`Arquivo grande demais. O limite é ${MAX_FILE_MB} MB por ficheiro.`);
  error.status = 413;
  return error;
}

export function isFileTooLarge(error) {
  return error?.code === "LIMIT_FILE_SIZE" || /file too large/i.test(String(error?.message || ""));
}

export function handleMulter(middleware) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (isFileTooLarge(error)) {
        next(fileTooLargeError());
        return;
      }
      if (error?.code === "LIMIT_FILE_COUNT") {
        const limited = new Error(`Envie no máximo ${MAX_FILES} ficheiros de cada vez.`);
        limited.status = 400;
        next(limited);
        return;
      }
      next(error);
    });
  };
}

export function makeUploader(fileSize = MAX_FILE_BYTES) {
  return multer({
    dest: path.join(UPLOADS, "_tmp"),
    limits: {
      fileSize,
      files: MAX_FILES,
      fieldSize: 1024 * 1024,
    },
  });
}

export function makeChunkUploader() {
  return makeUploader(CHUNK_BYTES + 1024 * 1024);
}
