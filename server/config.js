import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const DIST = path.join(ROOT, "dist");
export const DATA = path.join(ROOT, "data");
export const UPLOADS = path.join(DATA, "uploads");
export const PORT = Number(process.env.PORT) || 3001;
export const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000;
export const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 25 * 1024 * 1024;
export const MAX_FILES = 5;
export const MAX_PPTX_SLIDES = 80;
export const COOKIE_NAME = "pb_pk";
