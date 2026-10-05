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
  } catch {
    json = {
      users: [],
      tokens: [],
      presentations: [],
      sessions: [],
      sessionFiles: [],
      events: [],
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
