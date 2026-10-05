import { getSession } from "../services/sessionStore.js";
import { assertPublicHttpUrl, normalizeHttpUrl } from "../util/publicUrl.js";
import express from "express";
import rateLimit from "express-rate-limit";

export const siteRouter = express.Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true });

function escapeAttr(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function bootScript(cfg) {
  return `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script>window.__PROJETABA__=${JSON.stringify(cfg)};</script>
<script src="/socket.io/socket.io.js"></script>`;
}

function shellPage(cfg) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>PROJET-ABA — Apresentador</title>
${bootScript({ token: cfg.token, role: "presenter", url: cfg.url, mode: "shell" })}
<style>
html,body{margin:0;height:100%;background:#020617;color:#f4f7fb;font:15px/1.35 system-ui,Segoe UI,sans-serif}
body{display:flex;flex-direction:column;min-height:100dvh}
#projetaba-chrome{flex:0 0 auto;z-index:3;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:#020617;border-bottom:1px solid rgba(0,180,255,.35)}
#projetaba-chrome .pb-btn{min-height:44px;padding:0 12px;border:1px solid rgba(0,180,255,.4);background:#0a1628;color:#f4f7fb;border-radius:6px;font:inherit}
#projetaba-chrome .pb-go,#projetaba-open{background:#00b4ff;color:#020617;font-weight:700}
#projetaba-mirror[data-on="1"]{background:#22c55e;color:#020617;font-weight:700}
#projetaba-url{flex:1 1 160px;min-height:44px;min-width:0;padding:0 10px;border:1px solid rgba(0,180,255,.4);border-radius:6px;background:#01040c;color:#f4f7fb;font:14px/1.3 ui-monospace,monospace}
#projetaba-stage{flex:1;min-height:0;position:relative;background:#01040c;display:grid;place-items:center}
#projetaba-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;visibility:hidden}
#projetaba-preview[data-on="1"]{visibility:visible}
#projetaba-yt{position:absolute;inset:0;background:#000;visibility:hidden;z-index:2}
#projetaba-yt[data-on="1"]{visibility:visible}
#projetaba-yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}
#projetaba-hint{max-width:36rem;padding:24px;text-align:center;color:#c5d0dc}
#projetaba-hint strong{color:#00b4ff}
@media(max-width:720px){#projetaba-chrome{gap:6px}#projetaba-chrome .pb-btn{flex:1 1 calc(50% - 6px)}}
</style>
</head>
<body>
  <div id="projetaba-chrome" role="navigation" aria-label="Controlos do apresentador">
    <a class="pb-btn" href="/sessao/${encodeURIComponent(cfg.token)}?painel=1">Painel</a>
    <button class="pb-btn" id="projetaba-prev" type="button">Anterior</button>
    <button class="pb-btn" id="projetaba-next" type="button">Próximo</button>
    <input id="projetaba-url" type="url" inputmode="url" value="${escapeAttr(cfg.url)}" aria-label="Endereço do site">
    <button class="pb-btn" id="projetaba-open" type="button">Abrir site</button>
    <button class="pb-btn" id="projetaba-mirror" type="button">Espelhar na projeção</button>
  </div>
  <div id="projetaba-stage">
    <video id="projetaba-preview" autoplay muted playsinline></video>
    <div id="projetaba-yt"></div>
    <p id="projetaba-hint">YouTube entra direto no player (com som). Outros sites: <strong>Abrir site</strong> e depois <strong>Espelhar na projeção</strong>, marcando o áudio da aba.</p>
  </div>
  <script src="/projetaba-youtube.js"></script>
  <script src="/projetaba-shell.js"></script>
</body>
</html>`;
}

function mirrorPage(cfg) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PROJET-ABA — Projeção</title>
${bootScript({ token: cfg.token, role: "viewer", mode: "mirror" })}
<style>
html,body{margin:0;height:100%;background:#000;color:#f4f7fb;font:16px/1.4 system-ui,Segoe UI,sans-serif;overflow:hidden}
#mirror{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
#live{position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;visibility:hidden;z-index:2}
#live[data-on="1"]{visibility:visible}
#yt{position:fixed;inset:0;width:100%;height:100%;background:#000;visibility:hidden;z-index:2}
#yt[data-on="1"]{visibility:visible}
#yt iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
#wait{position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;background:#000;z-index:3}
#wait[data-hide="1"]{display:none}
</style>
</head>
<body>
  <img id="mirror" alt="Espelho da tela do apresentador">
  <video id="live" autoplay playsinline></video>
  <div id="yt"></div>
  <p id="wait">Aguardando o apresentador espelhar a tela…</p>
  <script src="/projetaba-youtube.js"></script>
  <script src="/projetaba-mirror.js"></script>
</body>
</html>`;
}

function errorPage(message) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PROJET-ABA</title>
<style>body{margin:0;background:#020617;color:#f4f7fb;font:16px/1.5 system-ui;display:grid;place-items:center;min-height:100dvh;padding:24px;text-align:center}</style>
</head><body><p>${escapeHtml(message)}</p></body></html>`;
}

async function resolveTarget(req, session) {
  const file =
    session.files.find((item) => item.fileId === session.activeFileId) ||
    session.files.find((item) => item.kind !== "url") ||
    session.files[0];
  const hasHttp = /^https?:\/\//i.test(String(file?.sourceUrl || file?.history?.[0] || ""));
  if (!file || file.kind !== "url" || !hasHttp) {
    return { file: null, target: null };
  }
  const target = await assertPublicHttpUrl(normalizeHttpUrl(req.query.u || session.currentUrl || file.sourceUrl));
  return { file, target };
}

siteRouter.get("/:token/page", limiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession(req.params.token);
  if (!session || session.status !== "live") {
    res.status(404).type("html").send(errorPage("Sessão não encontrada."));
    return;
  }
  try {
    const { file, target } = await resolveTarget(req, session);
    if (!file || !target) {
      res.redirect(`/sessao/${encodeURIComponent(session.token)}`);
      return;
    }
    res.redirect(302, target.href);
  } catch (error) {
    res.status(200).type("html").send(errorPage(error.message || "Não foi possível abrir este site."));
  }
});

siteRouter.get("/:token", limiter, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession(req.params.token);
  if (!session || session.status !== "live") {
    res.status(404).type("html").send(errorPage("Sessão não encontrada."));
    return;
  }
  const role = req.query.role === "presenter" ? "presenter" : "viewer";
  try {
    const { file, target } = await resolveTarget(req, session);
    if (!file || !target) {
      res.redirect(role === "presenter" ? `/sessao/${encodeURIComponent(session.token)}` : `/projetar/${encodeURIComponent(session.token)}`);
      return;
    }
    if (role === "viewer") {
      res.type("html").send(mirrorPage({ token: session.token }));
      return;
    }
    res.type("html").send(shellPage({ token: session.token, url: target.href }));
  } catch (error) {
    res.status(error.status || 400).type("html").send(errorPage(error.message || "URL inválida."));
  }
});
