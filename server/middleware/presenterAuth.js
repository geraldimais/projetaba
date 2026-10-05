import { COOKIE_NAME } from "../config.js";
import { getSession } from "../services/sessionStore.js";
import { keysMatch } from "../util/tokens.js";

export function cookieFromHeader(header, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(header || "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (!match) {
    return "";
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function presenterKeyFrom(req) {
  return req.get("x-presenter-key") || req.cookies?.[COOKIE_NAME] || req.body?.presenterKey || "";
}

export function isSessionOwner(req, session) {
  if (!session || session.status !== "live") {
    return false;
  }
  if (req.user && Number(req.user.id) === Number(session.userId)) {
    return true;
  }
  const key = presenterKeyFrom(req);
  if (key && keysMatch(session.presenterKeyHash, key)) {
    return true;
  }
  return false;
}

export function requirePresenter(req, res, next) {
  const session = getSession(req.params.token);
  if (!session || session.status !== "live") {
    res.status(404).json({ error: "Sessão não encontrada." });
    return;
  }
  req.session = session;
  if (!isSessionOwner(req, session)) {
    res.status(403).json({ error: "Sem permissão para controlar esta sessão." });
    return;
  }
  next();
}

export function loadSession(req, res, next) {
  const session = getSession(req.params.token);
  if (!session || session.status !== "live") {
    res.status(404).json({ error: "Sessão não encontrada." });
    return;
  }
  req.session = session;
  next();
}
