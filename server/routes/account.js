import express from "express";
import rateLimit from "express-rate-limit";
import { getOutboundMailRow, saveOutboundMail } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { outboundSettingsView, resolveOutboundMail, verifyOutbound } from "../services/resetMail.js";
import { decryptSecret, encryptSecret } from "../util/secret.js";

export const accountRouter = express.Router();

accountRouter.use(requireAuth);

const smtpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12, standardHeaders: true });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readSmtp(body) {
  const user = String(body?.user || "").trim().toLowerCase();
  const host = String(body?.host || "smtp.gmail.com").trim();
  const port = Number(body?.port) || 587;
  const secure = Boolean(body?.secure);
  const from = String(body?.from || user).trim().toLowerCase();
  const pass = String(body?.password || "").replace(/\s+/g, "");
  return { user, host, port, secure, from, pass };
}

function invalidSmtp(input) {
  if (!EMAIL.test(input.user)) {
    return "Informe um e-mail válido.";
  }
  if (!input.host || input.port < 1 || input.port > 65535) {
    return "Informe o servidor e a porta SMTP.";
  }
  if (!EMAIL.test(input.from)) {
    return "O remetente precisa ser um e-mail válido.";
  }
  return "";
}

async function storedPassword() {
  const row = await getOutboundMailRow();
  if (!row) {
    return "";
  }
  return decryptSecret(row.pass_enc || row.passEnc || "");
}

accountRouter.get("/smtp", async (_req, res, next) => {
  try {
    res.json({ settings: await outboundSettingsView() });
  } catch (error) {
    next(error);
  }
});

accountRouter.put("/smtp", smtpLimiter, async (req, res, next) => {
  try {
    const current = await outboundSettingsView();
    if (current.fromEnv) {
      res.status(409).json({ error: "O SMTP já está definido no servidor. Esta tela não o substitui." });
      return;
    }
    const input = readSmtp(req.body);
    const problem = invalidSmtp(input);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
    const pass = input.pass || (await storedPassword());
    if (!pass) {
      res.status(400).json({ error: "Informe a senha de aplicativo." });
      return;
    }
    try {
      await verifyOutbound({ host: input.host, port: input.port, secure: input.secure, user: input.user, pass });
    } catch {
      res.status(400).json({ error: "Não foi possível autenticar no SMTP. Confira o e-mail e a senha de aplicativo." });
      return;
    }
    const row = await getOutboundMailRow();
    await saveOutboundMail({
      host: input.host,
      port: input.port,
      secure: input.secure,
      user: input.user,
      from: input.from,
      passEnc: input.pass ? encryptSecret(input.pass) : row?.pass_enc || row?.passEnc || "",
    });
    res.json({ settings: await outboundSettingsView() });
  } catch (error) {
    next(error);
  }
});

accountRouter.post("/smtp/test", smtpLimiter, async (req, res, next) => {
  try {
    const current = await outboundSettingsView();
    let target;
    if (current.fromEnv) {
      target = await resolveOutboundMail();
    } else {
      const input = readSmtp(req.body);
      const problem = invalidSmtp(input);
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }
      const pass = input.pass || (await storedPassword());
      if (!pass) {
        res.status(400).json({ error: "Informe a senha de aplicativo." });
        return;
      }
      target = { host: input.host, port: input.port, secure: input.secure, user: input.user, pass };
    }
    try {
      await verifyOutbound(target);
    } catch {
      res.status(400).json({ error: "Não foi possível autenticar no SMTP. Confira o e-mail e a senha de aplicativo." });
      return;
    }
    res.json({ ok: true, inbox: target.user });
  } catch (error) {
    next(error);
  }
});
