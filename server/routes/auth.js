import express from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { AUTH_COOKIE, AUTH_TTL_MS, cookieSecure } from "../config.js";
import {
  consumePasswordReset,
  createAuthToken,
  createPasswordReset,
  createUser,
  deleteAuthToken,
  findUserByEmail,
  updateUserPassword,
} from "../db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { sendPasswordResetMail } from "../services/resetMail.js";

export const authRouter = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25, standardHeaders: true });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true });

const EMAIL =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(req),
    path: "/",
    maxAge: AUTH_TTL_MS,
  };
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

authRouter.get("/me", optionalAuth, (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

authRouter.post("/register", authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || "").trim();
    const password = String(req.body?.password || "");
    if (!EMAIL.test(email)) {
      res.status(400).json({ error: "Informe um e-mail válido." });
      return;
    }
    if (name.length < 2 || name.length > 120) {
      res.status(400).json({ error: "Informe o seu nome." });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
      return;
    }
    if (await findUserByEmail(email)) {
      res.status(409).json({ error: "Já existe uma conta com este e-mail." });
      return;
    }
    const user = await createUser({
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
      role: "user",
    });
    const token = await createAuthToken(user.id, AUTH_TTL_MS);
    res.cookie(AUTH_COOKIE, token, cookieOptions(req));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const row = await findUserByEmail(email);
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      res.status(401).json({ error: "E-mail ou senha incorretos." });
      return;
    }
    const token = await createAuthToken(row.id, AUTH_TTL_MS);
    res.cookie(AUTH_COOKIE, token, cookieOptions(req));
    res.json({
      user: { id: Number(row.id), email: row.email, name: row.name, role: row.role },
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot", resetLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const message = "Se existir uma conta com esse e-mail, enviaremos o link de redefinição.";
    if (!EMAIL.test(email)) {
      res.status(400).json({ error: "Informe um e-mail válido." });
      return;
    }
    const user = await findUserByEmail(email);
    if (!user) {
      res.json({ ok: true, message });
      return;
    }
    const token = await createPasswordReset(user.id);
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const link = `${proto}://${req.get("host")}/?redefinir=${token}`;
    try {
      await sendPasswordResetMail({ to: email, link });
    } catch (error) {
      console.error("Falha ao enviar redefinição de senha", error.message);
      res.status(503).json({ error: "Não foi possível enviar o e-mail agora. Tente de novo em instantes." });
      return;
    }
    res.json({ ok: true, message });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/reset", resetLimiter, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (password.length < 8) {
      res.status(400).json({ error: "A senha precisa ter pelo menos 8 caracteres." });
      return;
    }
    const userId = await consumePasswordReset(token);
    if (!userId) {
      res.status(400).json({ error: "Este link expirou ou já foi usado. Peça um novo." });
      return;
    }
    await updateUserPassword(userId, await bcrypt.hash(password, 12));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await deleteAuthToken(req.cookies?.[AUTH_COOKIE]);
    res.clearCookie(AUTH_COOKIE, { path: "/" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
