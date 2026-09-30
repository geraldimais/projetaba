import { COOKIE_NAME } from "../config.js";
import { getSession } from "../services/sessionStore.js";
import { keysMatch } from "../util/tokens.js";

export function presenterKeyFrom(req) {
  return req.get("x-presenter-key") || req.cookies?.[COOKIE_NAME] || req.body?.presenterKey || "";
}

export function requirePresenter(req, res, next) {
  const session = getSession(req.params.token);
  if (!session || session.status !== "live") {
    res.status(404).json({ error: "Sessão não encontrada." });
    return;
  }
  if (!keysMatch(session.presenterKeyHash, presenterKeyFrom(req))) {
    res.status(401).json({ error: "Chave do apresentador inválida." });
    return;
  }
  req.session = session;
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
