import { AUTH_COOKIE } from "../config.js";
import { findUserByToken } from "../db.js";

export async function optionalAuth(req, _res, next) {
  try {
    req.user = (await findUserByToken(req.cookies?.[AUTH_COOKIE])) || null;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req, res, next) {
  try {
    req.user = (await findUserByToken(req.cookies?.[AUTH_COOKIE])) || null;
    if (!req.user) {
      res.status(401).json({ error: "Inicie sessão para continuar." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Área restrita ao administrador." });
    return;
  }
  next();
}
