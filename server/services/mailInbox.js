import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { MAILBOX, MAX_FILE_BYTES } from "../config.js";
import {
  getMailInboxItem,
  getMailSettings,
  getMailSettingsRow,
  insertMailInbox,
  saveMailSettings,
} from "../db.js";
import { detectKind } from "./fileProcessor.js";
import { decryptSecret } from "../util/secret.js";

let timer = null;
let running = false;

function mailboxPath(id, filename) {
  const ext = path.extname(filename || "").slice(0, 8) || ".bin";
  return path.join(MAILBOX, `${id}${ext}`);
}

export async function credentialsFromSettings() {
  const row = await getMailSettingsRow();
  const settings = await getMailSettings();
  const password = decryptSecret(row?.password_enc || row?.passwordEnc || "");
  return { settings, password };
}

export async function testMailConnection() {
  const { settings, password } = await credentialsFromSettings();
  if (!settings.email || !password) {
    throw Object.assign(new Error("Configure o e-mail e a senha da caixa."), { status: 400 });
  }
  const imap = new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: settings.imapSecure,
    auth: { user: settings.email, pass: password },
    logger: false,
  });
  await imap.connect();
  await imap.mailboxOpen("INBOX");
  await imap.logout();
  let smtpError = null;
  try {
    const smtp = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpSecure,
      auth: { user: settings.email, pass: password },
    });
    await smtp.verify();
  } catch (error) {
    smtpError = error.message;
  }
  return { ok: true, inbox: settings.email, smtpError };
}

async function saveAttachment(parsedName, mime, content) {
  const fake = { originalname: parsedName, mimetype: mime, path: "" };
  const detected = detectKind(fake);
  if (!detected) {
    return null;
  }
  if ((content?.length || 0) > MAX_FILE_BYTES) {
    return null;
  }
  const id = crypto.randomBytes(8).toString("hex");
  const filename = path.basename(parsedName || `arquivo${detected.ext}`).slice(0, 180);
  await fs.mkdir(MAILBOX, { recursive: true });
  const dest = mailboxPath(id, filename);
  await fs.writeFile(dest, content);
  return {
    id,
    filename,
    mime: mime || detected.kind,
    kind: detected.kind,
    sizeBytes: content.length,
    storedRelPath: path.basename(dest),
    diskPath: dest,
  };
}

export async function syncMailbox() {
  if (running) {
    return { imported: 0, skipped: true };
  }
  running = true;
  let imported = 0;
  try {
    const { settings, password } = await credentialsFromSettings();
    if (!settings.enabled || !settings.email || !password) {
      return { imported: 0 };
    }
    const imap = new ImapFlow({
      host: settings.imapHost,
      port: settings.imapPort,
      secure: settings.imapSecure,
      auth: { user: settings.email, pass: password },
      logger: false,
    });
    await imap.connect();
    await imap.mailboxOpen("INBOX");
    const uids = [];
    for await (const msg of imap.fetch({ seen: false }, { uid: true, source: true, envelope: true })) {
      uids.push(msg.uid);
      const parsed = await simpleParser(msg.source);
      const from = String(parsed.from?.text || parsed.from?.value?.[0]?.address || "").slice(0, 190);
      const subject = String(parsed.subject || "(sem assunto)").slice(0, 255);
      const receivedAt = parsed.date || new Date();
      const messageId = String(parsed.messageId || `uid-${msg.uid}`).slice(0, 255);
      const attachments = parsed.attachments || [];
      for (const part of attachments) {
        const saved = await saveAttachment(part.filename, part.contentType, part.content);
        if (!saved) {
          continue;
        }
        const created = await insertMailInbox({
          id: saved.id,
          messageUid: String(msg.uid),
          messageId,
          from,
          subject,
          receivedAt,
          filename: saved.filename,
          mime: saved.mime,
          kind: saved.kind,
          sizeBytes: saved.sizeBytes,
          storedRelPath: saved.storedRelPath,
        });
        if (!created) {
          await fs.unlink(saved.diskPath).catch(() => {});
        } else {
          imported += 1;
        }
      }
    }
    if (uids.length) {
      await imap.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
    }
    await imap.logout();
    await saveMailSettings({
      ...settings,
      lastError: null,
      lastSyncAt: new Date(),
    });
    return { imported };
  } catch (error) {
    const settings = await getMailSettings();
    await saveMailSettings({
      ...settings,
      lastError: String(error.message || "Falha ao ler a caixa.").slice(0, 500),
    });
    throw error;
  } finally {
    running = false;
  }
}

export function startMailPoller() {
  if (timer) {
    return;
  }
  const tick = async () => {
    try {
      const settings = await getMailSettings();
      if (settings.enabled) {
        await syncMailbox();
      }
    } catch (error) {
      console.error("Caixa de e-mail:", error.message);
    }
  };
  tick();
  timer = setInterval(tick, 45 * 1000);
  timer.unref();
}

export async function inboxFilePath(item) {
  const row = item || {};
  const rel = path.basename(row.stored_rel_path || row.storedRelPath || "");
  if (rel) {
    return path.join(MAILBOX, rel);
  }
  return mailboxPath(row.id, row.filename);
}

export async function loadInboxFile(id) {
  const row = await getMailInboxItem(id);
  if (!row) {
    return null;
  }
  const diskPath = await inboxFilePath(row);
  return { row, diskPath };
}
