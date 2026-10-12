import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { ADMIN_EMAIL, ADMIN_PASSWORD, DATA, LIBRARY, MYSQL, MYSQL_BLOB_MAX, libraryFilePath } from "./config.js";

let pool = null;
let json = null;
const JSON_PATH = path.join(DATA, "store.json");

function useMysql() {
  return Boolean(MYSQL.host && MYSQL.user && MYSQL.database);
}

async function loadJson() {
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(LIBRARY, { recursive: true });
  try {
    json = JSON.parse(await fs.readFile(JSON_PATH, "utf8"));
    json.mailSettings = json.mailSettings || null;
    json.mailInbox = json.mailInbox || [];
  } catch {
    json = {
      users: [],
      tokens: [],
      presentations: [],
      sessions: [],
      sessionFiles: [],
      events: [],
      mailSettings: null,
      mailInbox: [],
      nextUserId: 1,
      nextEventId: 1,
    };
  }
}

async function saveJson() {
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(JSON_PATH, JSON.stringify(json, null, 2));
}

async function mysqlQuery(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function migrateMysql() {
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'user',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token CHAR(64) PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (user_id),
      INDEX (expires_at)
    )
  `);
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS presentations (
      id CHAR(16) PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(180) NOT NULL,
      original_name VARCHAR(180) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      page_count INT NOT NULL DEFAULT 0,
      size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      source_url VARCHAR(2048) NULL,
      file_blob LONGBLOB NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX (user_id)
    )
  `);
  try {
    await mysqlQuery("ALTER TABLE presentations MODIFY file_blob LONGBLOB NULL");
  } catch {
    // already nullable on fresh installs
  }
  try {
    await mysqlQuery("ALTER TABLE presentations ADD COLUMN source_url VARCHAR(2048) NULL");
  } catch {
    // already present
  }
  try {
    await mysqlQuery("ALTER TABLE presentations MODIFY size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0");
  } catch {
    // already widened
  }
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS projection_sessions (
      token VARCHAR(16) PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      presenter_key_hash CHAR(64) NOT NULL,
      title VARCHAR(80) NOT NULL,
      status VARCHAR(16) NOT NULL,
      active_file_id VARCHAR(32) NULL,
      current_index INT NOT NULL DEFAULT 0,
      viewer_peak INT NOT NULL DEFAULT 0,
      viewer_joins INT NOT NULL DEFAULT 0,
      slide_changes INT NOT NULL DEFAULT 0,
      started_at DATETIME NOT NULL,
      ended_at DATETIME NULL,
      last_activity_at DATETIME NOT NULL,
      INDEX (user_id),
      INDEX (status),
      INDEX (started_at)
    )
  `);
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS session_files (
      file_id VARCHAR(32) PRIMARY KEY,
      session_token VARCHAR(16) NOT NULL,
      presentation_id CHAR(16) NULL,
      original_name VARCHAR(180) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      page_count INT NOT NULL DEFAULT 0,
      stored_rel_path VARCHAR(255) NOT NULL,
      INDEX (session_token)
    )
  `);
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS metric_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      session_token VARCHAR(16) NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      type VARCHAR(32) NOT NULL,
      payload_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX (session_token),
      INDEX (type),
      INDEX (created_at)
    )
  `);
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS mail_settings (
      id TINYINT UNSIGNED PRIMARY KEY,
      imap_host VARCHAR(190) NOT NULL DEFAULT 'imap.hostinger.com',
      imap_port INT NOT NULL DEFAULT 993,
      imap_secure TINYINT NOT NULL DEFAULT 1,
      smtp_host VARCHAR(190) NOT NULL DEFAULT 'smtp.hostinger.com',
      smtp_port INT NOT NULL DEFAULT 465,
      smtp_secure TINYINT NOT NULL DEFAULT 1,
      email VARCHAR(190) NOT NULL DEFAULT '',
      password_enc TEXT NULL,
      poll_seconds INT NOT NULL DEFAULT 60,
      enabled TINYINT NOT NULL DEFAULT 0,
      last_error VARCHAR(500) NULL,
      last_sync_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await mysqlQuery(`
    CREATE TABLE IF NOT EXISTS mail_inbox (
      id CHAR(16) PRIMARY KEY,
      message_uid VARCHAR(190) NOT NULL,
      message_id VARCHAR(255) NOT NULL,
      from_addr VARCHAR(190) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      received_at DATETIME NOT NULL,
      filename VARCHAR(180) NOT NULL,
      mime VARCHAR(120) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
      stored_rel_path VARCHAR(255) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      presentation_id CHAR(16) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_mail_item (message_id, filename),
      INDEX (status),
      INDEX (received_at)
    )
  `);
}

function publicUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at || row.createdAt,
  };
}

function publicPresentation(row, includeBlob = false) {
  const item = {
    id: row.id,
    userId: Number(row.user_id ?? row.userId),
    title: row.title,
    originalName: row.original_name || row.originalName,
    mime: row.mime,
    kind: row.kind,
    sourceUrl: row.source_url || row.sourceUrl || null,
    pageCount: Number(row.page_count ?? row.pageCount ?? 0),
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  };
  if (includeBlob) {
    item.buffer = row.file_blob || row.buffer;
  }
  return item;
}

export async function initDb() {
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(LIBRARY, { recursive: true });
  if (useMysql()) {
    pool = mysql.createPool({
      host: MYSQL.host,
      port: MYSQL.port,
      user: MYSQL.user,
      password: MYSQL.password,
      database: MYSQL.database,
      waitForConnections: true,
      connectionLimit: 8,
      enableKeepAlive: true,
    });
    await migrateMysql();
  } else {
    await loadJson();
  }
  await seedAdmin();
}

async function seedAdmin() {
  if (!ADMIN_PASSWORD) {
    return;
  }
  const existing = await findUserByEmail(ADMIN_EMAIL);
  if (existing) {
    return;
  }
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await createUser({
    email: ADMIN_EMAIL,
    name: "Admin master",
    passwordHash,
    role: "admin",
  });
  console.log(`Conta admin master criada: ${ADMIN_EMAIL}`);
}

export async function findUserByEmail(email) {
  const value = String(email || "")
    .trim()
    .toLowerCase();
  if (pool) {
    const rows = await mysqlQuery("SELECT * FROM users WHERE email = ? LIMIT 1", [value]);
    return rows[0] || null;
  }
  return json.users.find((item) => item.email === value) || null;
}

export async function findUserById(id) {
  if (pool) {
    const rows = await mysqlQuery("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? publicUser(rows[0]) : null;
  }
  const row = json.users.find((item) => item.id === Number(id));
  return row ? publicUser(row) : null;
}

export async function createUser({ email, name, passwordHash, role = "user" }) {
  const cleanEmail = String(email).trim().toLowerCase();
  if (pool) {
    const result = await mysqlQuery(
      "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
      [cleanEmail, name, passwordHash, role]
    );
    return findUserById(result.insertId);
  }
  const user = {
    id: json.nextUserId++,
    email: cleanEmail,
    name,
    password_hash: passwordHash,
    role,
    created_at: new Date().toISOString(),
  };
  json.users.push(user);
  await saveJson();
  return publicUser(user);
}

export async function createAuthToken(userId, ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + ttlMs);
  if (pool) {
    await mysqlQuery("INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)", [
      token,
      userId,
      expires,
    ]);
    return token;
  }
  json.tokens.push({ token, user_id: userId, expires_at: expires.toISOString() });
  await saveJson();
  return token;
}

export async function findUserByToken(token) {
  if (!token) {
    return null;
  }
  if (pool) {
    const rows = await mysqlQuery(
      `SELECT u.* FROM auth_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token = ? AND t.expires_at > NOW() LIMIT 1`,
      [token]
    );
    return rows[0] ? publicUser(rows[0]) : null;
  }
  const row = json.tokens.find((item) => item.token === token && new Date(item.expires_at) > new Date());
  if (!row) {
    return null;
  }
  return findUserById(row.user_id);
}

export async function deleteAuthToken(token) {
  if (pool) {
    await mysqlQuery("DELETE FROM auth_tokens WHERE token = ?", [token]);
    return;
  }
  json.tokens = json.tokens.filter((item) => item.token !== token);
  await saveJson();
}

export async function listPresentations(userId) {
  if (pool) {
    const rows = await mysqlQuery(
      "SELECT id, user_id, title, original_name, mime, kind, page_count, size_bytes, source_url, created_at, updated_at FROM presentations WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    );
    return rows.map((row) => publicPresentation(row));
  }
  return json.presentations
    .filter((item) => item.userId === Number(userId))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((item) => publicPresentation({ ...item, user_id: item.userId, original_name: item.originalName, page_count: item.pageCount, size_bytes: item.sizeBytes, source_url: item.sourceUrl, created_at: item.createdAt, updated_at: item.updatedAt }));
}

export async function countPresentations(userId) {
  if (pool) {
    const rows = await mysqlQuery("SELECT COUNT(*) AS n FROM presentations WHERE user_id = ?", [userId]);
    return Number(rows[0].n);
  }
  return json.presentations.filter((item) => item.userId === Number(userId)).length;
}

export async function getPresentation(id, { blob = false } = {}) {
  let row;
  if (pool) {
    const sql = blob
      ? "SELECT * FROM presentations WHERE id = ? LIMIT 1"
      : "SELECT id, user_id, title, original_name, mime, kind, page_count, size_bytes, source_url, created_at, updated_at FROM presentations WHERE id = ? LIMIT 1";
    const rows = await mysqlQuery(sql, [id]);
    row = rows[0];
  } else {
    row = json.presentations.find((item) => item.id === id);
    if (row) {
      row = {
        ...row,
        user_id: row.userId,
        original_name: row.originalName,
        page_count: row.pageCount,
        size_bytes: row.sizeBytes,
        source_url: row.sourceUrl,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      };
    }
  }
  if (!row) {
    return null;
  }
  const mapped = publicPresentation(row);
  mapped.diskPath = mapped.kind === "url" ? null : libraryFilePath(id);
  if (blob && mapped.kind !== "url") {
    try {
      await fs.access(mapped.diskPath);
    } catch {
      if (row.file_blob) {
        await fs.mkdir(LIBRARY, { recursive: true });
        await fs.writeFile(mapped.diskPath, row.file_blob);
      }
    }
  }
  return mapped;
}

export async function savePresentation(record) {
  await fs.mkdir(LIBRARY, { recursive: true });
  const dest = libraryFilePath(record.id);
  const isUrl = record.kind === "url";
  if (!isUrl) {
    if (record.tempPath) {
      await fs.copyFile(record.tempPath, dest);
      await fs.unlink(record.tempPath).catch(() => {});
    } else if (record.buffer) {
      await fs.writeFile(dest, record.buffer);
    }
  }
  let blob = null;
  if (!isUrl && (record.sizeBytes || 0) <= MYSQL_BLOB_MAX) {
    blob = await fs.readFile(dest).catch(() => null);
  }
  if (pool) {
    try {
      await mysqlQuery(
        `INSERT INTO presentations (id, user_id, title, original_name, mime, kind, page_count, size_bytes, source_url, file_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.userId,
          record.title,
          record.originalName,
          record.mime,
          record.kind,
          record.pageCount,
          record.sizeBytes || 0,
          record.sourceUrl || null,
          blob,
        ]
      );
    } catch {
      await mysqlQuery(
        `INSERT INTO presentations (id, user_id, title, original_name, mime, kind, page_count, size_bytes, source_url, file_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          record.id,
          record.userId,
          record.title,
          record.originalName,
          record.mime,
          record.kind,
          record.pageCount,
          record.sizeBytes || 0,
          record.sourceUrl || null,
        ]
      );
    }
    return getPresentation(record.id);
  }
  json.presentations.unshift({
    id: record.id,
    userId: record.userId,
    title: record.title,
    originalName: record.originalName,
    mime: record.mime,
    kind: record.kind,
    sourceUrl: record.sourceUrl || null,
    pageCount: record.pageCount,
    sizeBytes: record.sizeBytes || 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await saveJson();
  return getPresentation(record.id);
}

export async function deletePresentation(id, userId) {
  const item = await getPresentation(id);
  if (!item || Number(item.userId) !== Number(userId)) {
    return false;
  }
  if (pool) {
    await mysqlQuery("DELETE FROM presentations WHERE id = ? AND user_id = ?", [id, userId]);
  } else {
    json.presentations = json.presentations.filter((row) => row.id !== id);
    await saveJson();
  }
  await fs.unlink(libraryFilePath(id)).catch(() => {});
  return true;
}

export async function insertProjectionSession(row) {
  if (pool) {
    await mysqlQuery(
      `INSERT INTO projection_sessions
        (token, user_id, presenter_key_hash, title, status, active_file_id, current_index, viewer_peak, viewer_joins, slide_changes, started_at, last_activity_at)
       VALUES (?, ?, ?, ?, 'live', ?, 0, 0, 0, 0, ?, ?)`,
      [row.token, row.userId, row.presenterKeyHash, row.title, row.activeFileId, new Date(), new Date()]
    );
    return;
  }
  json.sessions.push({
    token: row.token,
    userId: row.userId,
    presenterKeyHash: row.presenterKeyHash,
    title: row.title,
    status: "live",
    activeFileId: row.activeFileId,
    currentIndex: 0,
    viewerPeak: 0,
    viewerJoins: 0,
    slideChanges: 0,
    startedAt: new Date().toISOString(),
    endedAt: null,
    lastActivityAt: new Date().toISOString(),
  });
  await saveJson();
}

export async function upsertSessionFile(file) {
  if (pool) {
    await mysqlQuery(
      `INSERT INTO session_files (file_id, session_token, presentation_id, original_name, mime, kind, page_count, stored_rel_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE original_name = VALUES(original_name), page_count = VALUES(page_count)`,
      [
        file.fileId,
        file.sessionToken,
        file.presentationId,
        file.originalName,
        file.mime,
        file.kind,
        file.pageCount,
        file.storedRelPath,
      ]
    );
    return;
  }
  json.sessionFiles = json.sessionFiles.filter((item) => item.fileId !== file.fileId);
  json.sessionFiles.push(file);
  await saveJson();
}

export async function listSessionFiles(token) {
  if (pool) {
    return mysqlQuery("SELECT * FROM session_files WHERE session_token = ?", [token]);
  }
  return json.sessionFiles.filter((item) => item.sessionToken === token);
}

export async function findLiveSessionByUser(userId) {
  if (pool) {
    const rows = await mysqlQuery(
      "SELECT * FROM projection_sessions WHERE user_id = ? AND status = 'live' ORDER BY started_at DESC LIMIT 1",
      [userId]
    );
    return rows[0] || null;
  }
  return json.sessions.find((item) => item.userId === Number(userId) && item.status === "live") || null;
}

export async function listLiveDbSessions() {
  if (pool) {
    return mysqlQuery("SELECT * FROM projection_sessions WHERE status = 'live'");
  }
  return json.sessions.filter((item) => item.status === "live");
}

export async function updateSessionStats(token, patch) {
  const names = {
    active_file_id: "activeFileId",
    current_index: "currentIndex",
    last_activity_at: "lastActivityAt",
    viewer_peak: "viewerPeak",
    viewer_joins: "viewerJoins",
    slide_changes: "slideChanges",
    ended_at: "endedAt",
    status: "status",
  };
  if (pool) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(patch)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (!fields.length) {
      return;
    }
    values.push(token);
    await mysqlQuery(`UPDATE projection_sessions SET ${fields.join(", ")} WHERE token = ?`, values);
    return;
  }
  const row = json.sessions.find((item) => item.token === token);
  if (!row) {
    return;
  }
  for (const [key, value] of Object.entries(patch)) {
    row[names[key] || key] = value instanceof Date ? value.toISOString() : value;
  }
  await saveJson();
}

export async function recordEvent({ sessionToken, userId, type, payload }) {
  if (pool) {
    await mysqlQuery(
      "INSERT INTO metric_events (session_token, user_id, type, payload_json) VALUES (?, ?, ?, ?)",
      [sessionToken, userId || null, type, payload ? JSON.stringify(payload) : null]
    );
    return;
  }
  json.events.push({
    id: json.nextEventId++,
    sessionToken,
    userId: userId || null,
    type,
    payload: payload || null,
    createdAt: new Date().toISOString(),
  });
  await saveJson();
}

export async function adminOverview() {
  if (pool) {
    const [users] = await mysqlQuery("SELECT COUNT(*) AS n FROM users");
    const [decks] = await mysqlQuery("SELECT COUNT(*) AS n FROM presentations");
    const [sessions] = await mysqlQuery("SELECT COUNT(*) AS n FROM projection_sessions");
    const [live] = await mysqlQuery("SELECT COUNT(*) AS n FROM projection_sessions WHERE status = 'live'");
    const [hours] = await mysqlQuery(`
      SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, started_at, COALESCE(ended_at, last_activity_at))), 0) AS seconds
      FROM projection_sessions
    `);
    const [peak] = await mysqlQuery("SELECT COALESCE(MAX(viewer_peak), 0) AS n FROM projection_sessions");
    const [joins] = await mysqlQuery("SELECT COALESCE(SUM(viewer_joins), 0) AS n FROM projection_sessions");
    const [slides] = await mysqlQuery("SELECT COALESCE(SUM(slide_changes), 0) AS n FROM projection_sessions");
    const recent = await mysqlQuery(`
      SELECT s.token, s.title, s.status, s.viewer_peak, s.viewer_joins, s.slide_changes, s.started_at, s.ended_at,
             u.email, u.name,
             TIMESTAMPDIFF(SECOND, s.started_at, COALESCE(s.ended_at, s.last_activity_at)) AS duration_seconds
      FROM projection_sessions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.started_at DESC
      LIMIT 50
    `);
    const daily = await mysqlQuery(`
      SELECT DATE(started_at) AS day, COUNT(*) AS sessions, COALESCE(SUM(viewer_peak), 0) AS viewers
      FROM projection_sessions
      WHERE started_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY DATE(started_at)
      ORDER BY day ASC
    `);
    return {
      users: Number(users.n),
      presentations: Number(decks.n),
      sessions: Number(sessions.n),
      live: Number(live.n),
      seconds: Number(hours.seconds),
      peakViewers: Number(peak.n),
      viewerJoins: Number(joins.n),
      slideChanges: Number(slides.n),
      recent,
      daily,
    };
  }
  const duration = (row) => {
    const end = new Date(row.endedAt || row.lastActivityAt).getTime();
    return Math.max(0, Math.round((end - new Date(row.startedAt).getTime()) / 1000));
  };
  const usersById = new Map(json.users.map((item) => [item.id, item]));
  const recent = [...json.sessions]
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, 50)
    .map((row) => ({
      token: row.token,
      title: row.title,
      status: row.status,
      viewer_peak: row.viewerPeak,
      viewer_joins: row.viewerJoins,
      slide_changes: row.slideChanges,
      started_at: row.startedAt,
      ended_at: row.endedAt,
      email: usersById.get(row.userId)?.email,
      name: usersById.get(row.userId)?.name,
      duration_seconds: duration(row),
    }));
  const days = {};
  for (const row of json.sessions) {
    const day = String(row.startedAt).slice(0, 10);
    days[day] = days[day] || { day, sessions: 0, viewers: 0 };
    days[day].sessions += 1;
    days[day].viewers += row.viewerPeak || 0;
  }
  return {
    users: json.users.length,
    presentations: json.presentations.length,
    sessions: json.sessions.length,
    live: json.sessions.filter((item) => item.status === "live").length,
    seconds: json.sessions.reduce((sum, row) => sum + duration(row), 0),
    peakViewers: json.sessions.reduce((max, row) => Math.max(max, row.viewerPeak || 0), 0),
    viewerJoins: json.sessions.reduce((sum, row) => sum + (row.viewerJoins || 0), 0),
    slideChanges: json.sessions.reduce((sum, row) => sum + (row.slideChanges || 0), 0),
    recent,
    daily: Object.values(days).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export function userFromRow(row) {
  return publicUser(row);
}

function publicMailSettings(row) {
  if (!row) {
    return {
      imapHost: "imap.hostinger.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.hostinger.com",
      smtpPort: 465,
      smtpSecure: true,
      email: "",
      hasPassword: false,
      pollSeconds: 60,
      enabled: false,
      lastError: null,
      lastSyncAt: null,
    };
  }
  return {
    imapHost: row.imap_host || row.imapHost || "imap.hostinger.com",
    imapPort: Number(row.imap_port ?? row.imapPort ?? 993),
    imapSecure: Boolean(Number(row.imap_secure ?? row.imapSecure ?? 1)),
    smtpHost: row.smtp_host || row.smtpHost || "smtp.hostinger.com",
    smtpPort: Number(row.smtp_port ?? row.smtpPort ?? 465),
    smtpSecure: Boolean(Number(row.smtp_secure ?? row.smtpSecure ?? 1)),
    email: row.email || "",
    hasPassword: Boolean(row.password_enc || row.passwordEnc),
    pollSeconds: Number(row.poll_seconds ?? row.pollSeconds ?? 60),
    enabled: Boolean(Number(row.enabled ?? 0)),
    lastError: row.last_error ?? row.lastError ?? null,
    lastSyncAt: row.last_sync_at ?? row.lastSyncAt ?? null,
  };
}

export async function getMailSettingsRow() {
  if (pool) {
    const rows = await mysqlQuery("SELECT * FROM mail_settings WHERE id = 1 LIMIT 1");
    return rows[0] || null;
  }
  return json.mailSettings || null;
}

export async function getMailSettings() {
  return publicMailSettings(await getMailSettingsRow());
}

export async function saveMailSettings(input) {
  const current = await getMailSettingsRow();
  const next = {
    imap_host: String(input.imapHost || "imap.hostinger.com").slice(0, 190),
    imap_port: Number(input.imapPort) || 993,
    imap_secure: input.imapSecure === false ? 0 : 1,
    smtp_host: String(input.smtpHost || "smtp.hostinger.com").slice(0, 190),
    smtp_port: Number(input.smtpPort) || 465,
    smtp_secure: input.smtpSecure === false ? 0 : 1,
    email: String(input.email || "").trim().toLowerCase().slice(0, 190),
    password_enc: input.passwordEnc !== undefined ? input.passwordEnc : current?.password_enc || current?.passwordEnc || "",
    poll_seconds: Math.min(600, Math.max(30, Number(input.pollSeconds) || 60)),
    enabled: input.enabled ? 1 : 0,
    last_error: input.lastError === undefined ? current?.last_error || current?.lastError || null : input.lastError,
    last_sync_at: input.lastSyncAt === undefined ? current?.last_sync_at || current?.lastSyncAt || null : input.lastSyncAt,
  };
  if (pool) {
    await mysqlQuery(
      `INSERT INTO mail_settings
        (id, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, email, password_enc, poll_seconds, enabled, last_error, last_sync_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        imap_host = VALUES(imap_host),
        imap_port = VALUES(imap_port),
        imap_secure = VALUES(imap_secure),
        smtp_host = VALUES(smtp_host),
        smtp_port = VALUES(smtp_port),
        smtp_secure = VALUES(smtp_secure),
        email = VALUES(email),
        password_enc = VALUES(password_enc),
        poll_seconds = VALUES(poll_seconds),
        enabled = VALUES(enabled),
        last_error = VALUES(last_error),
        last_sync_at = VALUES(last_sync_at)`,
      [
        next.imap_host,
        next.imap_port,
        next.imap_secure,
        next.smtp_host,
        next.smtp_port,
        next.smtp_secure,
        next.email,
        next.password_enc,
        next.poll_seconds,
        next.enabled,
        next.last_error,
        next.last_sync_at,
      ]
    );
  } else {
    json.mailSettings = {
      ...next,
      imapHost: next.imap_host,
      imapPort: next.imap_port,
      imapSecure: next.imap_secure,
      smtpHost: next.smtp_host,
      smtpPort: next.smtp_port,
      smtpSecure: next.smtp_secure,
      passwordEnc: next.password_enc,
      pollSeconds: next.poll_seconds,
      lastError: next.last_error,
      lastSyncAt: next.last_sync_at,
    };
    await saveJson();
  }
  return getMailSettings();
}

export function publicInboxItem(row) {
  return {
    id: row.id,
    from: row.from_addr || row.fromAddr || row.from,
    subject: row.subject,
    receivedAt: row.received_at || row.receivedAt,
    filename: row.filename,
    mime: row.mime,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
    status: row.status,
    presentationId: row.presentation_id || row.presentationId || null,
  };
}

export async function listMailInbox(status = "pending") {
  if (pool) {
    const rows = status
      ? await mysqlQuery("SELECT * FROM mail_inbox WHERE status = ? ORDER BY received_at DESC LIMIT 80", [status])
      : await mysqlQuery("SELECT * FROM mail_inbox ORDER BY received_at DESC LIMIT 80");
    return rows.map(publicInboxItem);
  }
  return (json.mailInbox || [])
    .filter((item) => !status || item.status === status)
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
    .slice(0, 80)
    .map((item) => publicInboxItem({ ...item, from_addr: item.from, received_at: item.receivedAt, size_bytes: item.sizeBytes, presentation_id: item.presentationId }));
}

export async function getMailInboxItem(id) {
  if (pool) {
    const rows = await mysqlQuery("SELECT * FROM mail_inbox WHERE id = ? LIMIT 1", [id]);
    return rows[0] || null;
  }
  return (json.mailInbox || []).find((item) => item.id === id) || null;
}

export async function insertMailInbox(item) {
  if (pool) {
    try {
      await mysqlQuery(
        `INSERT INTO mail_inbox
          (id, message_uid, message_id, from_addr, subject, received_at, filename, mime, kind, size_bytes, stored_rel_path, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          item.id,
          item.messageUid,
          item.messageId,
          item.from,
          item.subject,
          item.receivedAt,
          item.filename,
          item.mime,
          item.kind,
          item.sizeBytes,
          item.storedRelPath,
        ]
      );
      return true;
    } catch (error) {
      if (String(error.code) === "ER_DUP_ENTRY") {
        return false;
      }
      throw error;
    }
  }
  json.mailInbox = json.mailInbox || [];
  if (json.mailInbox.some((row) => row.messageId === item.messageId && row.filename === item.filename)) {
    return false;
  }
  json.mailInbox.unshift({
    id: item.id,
    messageUid: item.messageUid,
    messageId: item.messageId,
    from: item.from,
    subject: item.subject,
    receivedAt: item.receivedAt instanceof Date ? item.receivedAt.toISOString() : item.receivedAt,
    filename: item.filename,
    mime: item.mime,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    storedRelPath: item.storedRelPath,
    status: "pending",
    presentationId: null,
  });
  await saveJson();
  return true;
}

export async function updateMailInbox(id, patch) {
  const current = await getMailInboxItem(id);
  if (!current) {
    return null;
  }
  if (pool) {
    await mysqlQuery("UPDATE mail_inbox SET status = ?, presentation_id = ? WHERE id = ?", [
      patch.status || current.status,
      patch.presentationId ?? current.presentation_id ?? null,
      id,
    ]);
    return getMailInboxItem(id);
  }
  current.status = patch.status || current.status;
  current.presentationId = patch.presentationId ?? current.presentationId ?? null;
  await saveJson();
  return current;
}
