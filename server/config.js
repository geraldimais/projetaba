import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");

function defaultDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  if (path.basename(ROOT) === "public_html") {
    return path.resolve(ROOT, "..", "projetaba-data");
  }
  return path.join(ROOT, "data");
}

export const DIST = path.join(ROOT, "dist");
export const DATA = defaultDataDir();
export const UPLOADS = path.join(DATA, "uploads");
export const LIBRARY = path.join(DATA, "library");
export const PORT = Number(process.env.PORT) || 3001;
export const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
export const IS_PROD = process.env.NODE_ENV === "production" || PUBLIC_URL.startsWith("https");

export function cookieSecure(req) {
  return Boolean(req?.secure) || IS_PROD;
}
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 24 * 60 * 60 * 1000;
export const AUTH_TTL_MS = Number(process.env.AUTH_TTL_MS) || 30 * 24 * 60 * 60 * 1000;
export const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES) || 500 * 1024 * 1024;
export const CHUNK_BYTES = Number(process.env.CHUNK_BYTES) || 4 * 1024 * 1024;
export const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));
export const MYSQL_BLOB_MAX = Number(process.env.MYSQL_BLOB_MAX) || 8 * 1024 * 1024;
export const MAX_FILES = 8;
export const MAX_LIBRARY = 30;
export const MAX_PPTX_SLIDES = 250;
export const COOKIE_NAME = "pb_pk";
export const AUTH_COOKIE = "pb_auth";
export const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
export const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@projetaba.app")
  .trim()
  .toLowerCase();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export const MYSQL = {
  host: process.env.MYSQL_HOST || "",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "",
};

export function libraryFilePath(id) {
  return path.join(LIBRARY, `${id}.bin`);
}
