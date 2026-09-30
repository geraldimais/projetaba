import path from "node:path";
import { UPLOADS } from "../config.js";

const SAFE = /^[A-Za-z0-9_-]+$/;

export function assertSafeId(value, label = "id") {
  if (!SAFE.test(String(value || ""))) {
    const error = new Error(`${label} inválido`);
    error.status = 400;
    throw error;
  }
  return String(value);
}

export function sessionDir(tokenKey) {
  assertSafeId(tokenKey, "token");
  return path.join(UPLOADS, tokenKey);
}

export function resolveInside(root, ...parts) {
  const resolved = path.resolve(root, ...parts);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    const error = new Error("Caminho inválido");
    error.status = 400;
    throw error;
  }
  return resolved;
}
