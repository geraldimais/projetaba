import crypto from "node:crypto";
import { SESSION_SECRET } from "../config.js";

function key() {
  return crypto.createHash("sha256").update(String(SESSION_SECRET)).digest();
}

export function encryptSecret(plain) {
  const value = String(plain || "");
  if (!value) {
    return "";
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${enc.toString("hex")}`;
}

export function decryptSecret(packed) {
  const value = String(packed || "");
  if (!value) {
    return "";
  }
  const [ivHex, tagHex, dataHex] = value.split(".");
  if (!ivHex || !tagHex || !dataHex) {
    return "";
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
