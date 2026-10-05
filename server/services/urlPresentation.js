import crypto from "node:crypto";
import { assertPublicHttpUrl, normalizeHttpUrl } from "../util/publicUrl.js";

export async function describeUrl(raw) {
  const url = await assertPublicHttpUrl(normalizeHttpUrl(raw));
  const host = url.hostname.replace(/^www\./, "");
  return {
    id: crypto.randomBytes(8).toString("hex"),
    originalName: host.slice(0, 180),
    mime: "text/html",
    kind: "url",
    pageCount: 1,
    sizeBytes: 0,
    sourceUrl: url.href,
    title: host.slice(0, 180),
  };
}
