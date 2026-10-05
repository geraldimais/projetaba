import fs from "node:fs/promises";
import { SESSION_TTL_MS } from "../config.js";
import { sessionDir } from "../util/safePath.js";
import { tokenKey } from "../util/tokens.js";

const sessions = new Map();

export function getSession(token) {
  return sessions.get(tokenKey(token));
}

export function saveSession(session) {
  sessions.set(tokenKey(session.token), session);
  return session;
}

export function publicSnapshot(session) {
  return {
    token: session.token,
    title: session.title,
    status: session.status,
    currentIndex: session.currentIndex,
    activeFileId: session.activeFileId,
    currentUrl: session.currentUrl || null,
    scroll: session.scroll || { x: 0, y: 0, key: "document" },
    viewerCount: session.viewers.size,
    files: session.files.map((file) => ({
      fileId: file.fileId,
      presentationId: file.presentationId || file.fileId,
      originalName: file.originalName,
      kind: file.kind,
      sourceUrl: file.sourceUrl || null,
      history: file.kind === "url" ? file.history || [file.sourceUrl] : undefined,
      pageCount: file.pageCount,
      processingStatus: file.processingStatus,
      hasExtractedSlides: file.hasExtractedSlides,
      videos: file.videos || [],
      renderRelPath: file.renderRelPath || null,
    })),
  };
}

export function touch(session) {
  session.lastActivityAt = Date.now();
}

export function addViewer(session, socketId) {
  session.viewers.set(socketId, { joinedAt: Date.now() });
  touch(session);
}

export function removeViewer(session, socketId) {
  session.viewers.delete(socketId);
  if (session.presenterSocketId === socketId) {
    session.presenterSocketId = null;
  }
}

export async function destroySession(token) {
  const key = tokenKey(token);
  const session = sessions.get(key);
  if (!session) {
    return;
  }
  sessions.delete(key);
  try {
    await fs.rm(sessionDir(key), { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

export function startGc() {
  setInterval(() => {
    const now = Date.now();
    for (const session of sessions.values()) {
      if (session.status === "ended" || now - session.lastActivityAt > SESSION_TTL_MS) {
        destroySession(session.token);
      }
    }
  }, 5 * 60 * 1000).unref();
}
