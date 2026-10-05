import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^0\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/,
  /^::$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^::ffff:127\./i,
  /^::ffff:10\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./i,
  /^::ffff:100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./i,
];
const MAX_REDIRECTS = 4;

function blockedHost(host) {
  const value = String(host || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (!value || value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local") || value.endsWith(".internal")) {
    return true;
  }
  return PRIVATE.some((pattern) => pattern.test(value));
}

export async function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    const error = new Error("URL inválida.");
    error.status = 400;
    throw error;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    const error = new Error("Use uma URL http ou https.");
    error.status = 400;
    throw error;
  }
  if (blockedHost(url.hostname)) {
    const error = new Error("Este endereço não pode ser projetado.");
    error.status = 400;
    throw error;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const lookedUp = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!lookedUp.length) {
    const error = new Error("Não foi possível resolver esta URL.");
    error.status = 400;
    throw error;
  }
  if (lookedUp.some((item) => blockedHost(item.address))) {
    const error = new Error("Este endereço não pode ser projetado.");
    error.status = 400;
    throw error;
  }
  return url;
}

export async function fetchPublicHttp(href, init = {}) {
  let current = await assertPublicHttpUrl(href);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current.href, {
      ...init,
      redirect: "manual",
      signal: init.signal || AbortSignal.timeout(15000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw Object.assign(new Error("Redirecionamento inválido."), { status: 502 });
      }
      current = await assertPublicHttpUrl(new URL(location, current.href).href);
      continue;
    }
    return { response, finalUrl: current.href };
  }
  throw Object.assign(new Error("Demasiados redirecionamentos."), { status: 502 });
}

export function normalizeHttpUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `https://${value}`;
}
