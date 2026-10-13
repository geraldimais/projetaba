import nodemailer from "nodemailer";
import { getOutboundMailRow } from "../db.js";
import { decryptSecret } from "../util/secret.js";

function envMail() {
  const pass = String(process.env.SMTP_PASS || "");
  const user = String(process.env.SMTP_USER || "").trim();
  if (!pass || !user) {
    return null;
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false") === "true" || port === 465;
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
    user,
    pass,
    from: process.env.SMTP_FROM || user,
  };
}

export async function outboundSettingsView() {
  const fromEnv = envMail();
  if (fromEnv) {
    return {
      host: fromEnv.host,
      port: fromEnv.port,
      secure: fromEnv.secure,
      user: fromEnv.user,
      from: fromEnv.from,
      hasPassword: true,
      fromEnv: true,
    };
  }
  const row = await getOutboundMailRow();
  const user = row?.user_name || row?.user || "";
  const passEnc = row?.pass_enc || row?.passEnc || "";
  return {
    host: row?.host || "smtp.gmail.com",
    port: Number(row?.port) || 587,
    secure: row?.secure === true || Number(row?.secure) === 1,
    user,
    from: row?.from_addr || row?.from || user,
    hasPassword: Boolean(passEnc),
    fromEnv: false,
  };
}

export async function resolveOutboundMail() {
  const fromEnv = envMail();
  if (fromEnv) {
    return fromEnv;
  }
  const row = await getOutboundMailRow();
  if (!row) {
    return null;
  }
  const pass = decryptSecret(row.pass_enc || row.passEnc || "");
  const user = row.user_name || row.user || "";
  if (!pass || !user) {
    return null;
  }
  return {
    host: row.host,
    port: Number(row.port) || 587,
    secure: Boolean(Number(row.secure)),
    user,
    pass,
    from: row.from_addr || row.from || user,
  };
}

export async function verifyOutbound({ host, port, secure, user, pass }) {
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  await transport.verify();
}

export async function sendPasswordResetMail({ to, link }) {
  const settings = await resolveOutboundMail();
  if (!settings) {
    throw Object.assign(new Error("Envio de e-mail não configurado."), { status: 503 });
  }
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass },
  });
  await transport.sendMail({
    from: settings.from,
    to,
    subject: "Redefinir senha — PROJET-ABA",
    text: [
      "Recebemos um pedido para redefinir a senha da sua conta PROJET-ABA.",
      "",
      "Abra o link abaixo nos próximos 30 minutos:",
      link,
      "",
      "Se você não pediu isso, ignore este e-mail. A senha atual continua válida.",
    ].join("\n"),
  });
}
