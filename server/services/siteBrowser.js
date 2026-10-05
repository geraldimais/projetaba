import { fetchPublicHttp } from "../util/publicUrl.js";

const MAX_HTML = 2 * 1024 * 1024;

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export async function fetchSitePage(href, { userAgent, acceptLanguage } = {}) {
  const { response, finalUrl } = await fetchPublicHttp(href, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent": userAgent || DESKTOP_UA,
      "Accept-Language": acceptLanguage || "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  const type = String(response.headers.get("content-type") || "text/html");
  if (!response.ok) {
    throw Object.assign(new Error(`O site respondeu ${response.status}.`), { status: 502 });
  }
  if (!type.includes("html")) {
    throw Object.assign(new Error("Esta URL não é uma página web projetável."), { status: 415 });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_HTML) {
    throw Object.assign(new Error("A página é grande demais para projetar."), { status: 413 });
  }
  return {
    html: buffer.toString("utf8"),
    finalUrl: finalUrl || href,
  };
}
