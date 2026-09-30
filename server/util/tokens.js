import crypto from "node:crypto";
import { customAlphabet } from "nanoid";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeToken = customAlphabet(alphabet, 8);

export function createSessionToken() {
  const raw = makeToken();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizeToken(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^(.{4})(.+)$/, "$1-$2");
}

export function tokenKey(value) {
  return normalizeToken(value).replace(/-/g, "");
}

export function createPresenterKey() {
  return crypto.randomBytes(24).toString("hex");
}

export function hashPresenterKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}

export function keysMatch(hash, candidate) {
  if (!hash || !candidate) {
    return false;
  }
  const other = hashPresenterKey(candidate);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(other, "hex");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
