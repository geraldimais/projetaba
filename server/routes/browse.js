import express from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.js";
import { fetchPublicHttp, normalizeHttpUrl } from "../util/publicUrl.js";

export const browseRouter = express.Router();

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true });
const MAX_HTML = 2 * 1024 * 1024;

function escapeAttr(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function interceptorScript() {
  return `<script data-projetaba="nav">(function(){
  function abs(href){
    try { return new URL(href, document.baseURI).href; } catch (e) { return href; }
  }
  function send(url){
    try { parent.postMessage({ type: "projetaba-nav", url: abs(url) }, window.location.origin); } catch (e) {}
  }
  document.addEventListener("click", function(event){
    var link = event.target && event.target.closest && event.target.closest("a[href]");
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^(javascript|mailto|tel):/i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    send(link.href || href);
  }, true);
  document.addEventListener("submit", function(event){
    var form = event.target;
    if (!form || !form.action) return;
    var method = String(form.method || "get").toLowerCase();
    if (method !== "get") return;
    event.preventDefault();
    try {
      var next = new URL(form.action, document.baseURI);
      new FormData(form).forEach(function(value, key){ next.searchParams.set(key, value); });
      send(next.href);
    } catch (e) {}
  }, true);
})();</script>`;
}

function injectHtml(html, pageUrl) {
  const base = new URL(".", pageUrl).href;
  const snippet = `<base href="${escapeAttr(base)}">${interceptorScript()}`;
  let out = String(html || "")
    .replace(/<meta[^>]+http-equiv=["']content-security-policy["'][^>]*>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']x-frame-options["'][^>]*>/gi, "");
  if (/<head[^>]*>/i.test(out)) {
    return out.replace(/<head[^>]*>/i, (match) => `${match}${snippet}`);
  }
  return `<!doctype html><head>${snippet}</head>${out}`;
}

function errorPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>PROJET-ABA</title>
<style>body{margin:0;background:#020617;color:#f4f7fb;font:16px/1.5 system-ui;display:grid;place-items:center;min-height:100dvh;padding:24px;text-align:center}</style>
</head><body><p>${escapeAttr(message)}</p></body></html>`;
}

browseRouter.get("/", requireAuth, limiter, async (req, res) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Cache-Control", "no-store");
  try {
    const { response, finalUrl } = await fetchPublicHttp(normalizeHttpUrl(req.query.url), {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; PROJET-ABA/1.0)",
      },
    });
    const type = String(response.headers.get("content-type") || "text/html");
    if (!response.ok) {
      res.status(200).type("html").send(errorPage(`O site respondeu ${response.status}. Tente outra URL.`));
      return;
    }
    if (!type.includes("html")) {
      res.status(200).type("html").send(errorPage("Esta URL não é uma página web projetável."));
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_HTML) {
      res.status(200).type("html").send(errorPage("A página é grande demais para projetar."));
      return;
    }
    const html = injectHtml(buffer.toString("utf8"), finalUrl);
    res.type("html").send(html);
  } catch (error) {
    if (error.status === 400) {
      res.status(400).type("html").send(errorPage(error.message || "URL inválida."));
      return;
    }
    res.status(200).type("html").send(errorPage("Não foi possível carregar este site para projeção."));
  }
});
