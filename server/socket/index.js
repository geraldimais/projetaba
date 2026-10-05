import { AUTH_COOKIE, COOKIE_NAME } from "../config.js";
import { findUserByToken, getPresentation, listLiveDbSessions, listSessionFiles, recordEvent, updateSessionStats } from "../db.js";
import { cookieFromHeader } from "../middleware/presenterAuth.js";
import { attachPresentation } from "../services/fileProcessor.js";
import { addViewer, getSession, publicSnapshot, removeViewer, saveSession, touch } from "../services/sessionStore.js";
import { assertPublicHttpUrl, normalizeHttpUrl } from "../util/publicUrl.js";
import { keysMatch, tokenKey } from "../util/tokens.js";

function clampIndex(session, fileId, index) {
  const file = session.files.find((item) => item.fileId === fileId) || session.files[0];
  if (!file) {
    return { fileId: null, index: 0 };
  }
  const max = Math.max(0, (file.pageCount || 1) - 1);
  return { fileId: file.fileId, index: Math.min(Math.max(0, Number(index) || 0), max) };
}

function step(session, delta) {
  const files = session.files.filter((item) => item.processingStatus === "ready");
  if (!files.length) {
    return { fileId: null, index: 0 };
  }
  let fileIndex = Math.max(0, files.findIndex((item) => item.fileId === session.activeFileId));
  let index = (session.currentIndex || 0) + delta;
  while (files[fileIndex] && index >= files[fileIndex].pageCount && fileIndex < files.length - 1) {
    fileIndex += 1;
    index = 0;
  }
  while (index < 0 && fileIndex > 0) {
    fileIndex -= 1;
    index = Math.max(0, (files[fileIndex].pageCount || 1) - 1);
  }
  return clampIndex(session, files[fileIndex].fileId, index);
}

function syncUrlFromIndex(session, next) {
  const file = session.files.find((item) => item.fileId === next.fileId);
  if (file?.kind === "url") {
    const history = file.history || [file.sourceUrl];
    session.currentUrl = history[next.index] || file.sourceUrl;
  } else {
    session.currentUrl = null;
  }
}

function applyBrowse(session, rawUrl) {
  const file = session.files.find((item) => item.fileId === session.activeFileId) || session.files[0];
  if (!file || file.kind !== "url") {
    return clampIndex(session, session.activeFileId, session.currentIndex);
  }
  const nextUrl = String(rawUrl || "").trim();
  if (!nextUrl) {
    return { fileId: file.fileId, index: session.currentIndex || 0 };
  }
  const history = file.history || (file.history = [file.sourceUrl]);
  const index = session.currentIndex || 0;
  if (history[index] === nextUrl) {
    session.currentUrl = nextUrl;
    return { fileId: file.fileId, index };
  }
  file.history = history.slice(0, index + 1);
  file.history.push(nextUrl);
  file.pageCount = file.history.length;
  session.currentUrl = nextUrl;
  return { fileId: file.fileId, index: file.history.length - 1 };
}

function broadcastSlide(io, room, session, next) {
  session.activeFileId = next.fileId;
  session.currentIndex = next.index;
  syncUrlFromIndex(session, next);
  const active = session.files.find((item) => item.fileId === next.fileId);
  if (active?.kind !== "url" && session.mirroring) {
    session.mirroring = false;
    io.to(room).emit("view:mirror", { active: false });
  }
  session.slideChanges = (session.slideChanges || 0) + 1;
  session.media = { playing: true, time: 0, at: Date.now() };
  touch(session);
  updateSessionStats(session.token, {
    active_file_id: next.fileId,
    current_index: next.index,
    slide_changes: session.slideChanges,
    last_activity_at: new Date(),
  }).catch(() => {});
  recordEvent({
    sessionToken: session.token,
    userId: session.userId,
    type: "slide_change",
    payload: next,
  }).catch(() => {});
  io.to(room).emit("slide:changed", { ...next, currentUrl: session.currentUrl });
  io.to(room).emit("session:state", publicSnapshot(session));
  io.to(room).emit("view:media", session.media);
}

export async function restoreLiveSessions() {
  const rows = await listLiveDbSessions();
  for (const row of rows) {
    const token = row.token;
    const session = {
      token,
      userId: Number(row.user_id ?? row.userId),
      presenterKeyHash: row.presenter_key_hash || row.presenterKeyHash,
      title: row.title,
      status: "live",
      createdAt: new Date(row.started_at || row.startedAt).getTime(),
      lastActivityAt: Date.now(),
      currentIndex: Number(row.current_index ?? row.currentIndex ?? 0),
      activeFileId: row.active_file_id || row.activeFileId || null,
      files: [],
      presenterSocketId: null,
      viewers: new Map(),
      viewerPeak: Number(row.viewer_peak ?? row.viewerPeak ?? 0),
      viewerJoins: Number(row.viewer_joins ?? row.viewerJoins ?? 0),
      slideChanges: Number(row.slide_changes ?? row.slideChanges ?? 0),
    };
    const files = await listSessionFiles(token);
    for (const file of files) {
      const presentationId = file.presentation_id || file.presentationId;
      if (!presentationId) {
        continue;
      }
      const presentation = await getPresentation(presentationId, { blob: true });
      if (!presentation) {
        continue;
      }
      try {
        await attachPresentation(session, presentation);
      } catch (error) {
        console.error(`Sessão ${token}: não foi possível anexar ${presentationId}`, error.message);
      }
    }
    if (!session.files.length) {
      await updateSessionStats(token, { status: "ended", ended_at: new Date() });
      continue;
    }
    if (!session.files.some((item) => item.fileId === session.activeFileId)) {
      const fallback = session.files.find((item) => item.kind !== "url") || session.files[0];
      session.activeFileId = fallback.fileId;
      session.currentIndex = 0;
    }
    const active = session.files.find((item) => item.fileId === session.activeFileId) || session.files[0];
    if (active?.kind === "url") {
      session.currentUrl = active.history?.[session.currentIndex] || active.sourceUrl;
    }
    saveSession(session);
  }
}

export function bindSocket(io) {
  io.on("connection", async (socket) => {
    const { token, role, presenterKey } = socket.handshake.auth || {};
    const session = getSession(token);
    if (!session || session.status !== "live") {
      socket.emit("error", { code: "NOT_FOUND", message: "Sessão não encontrada." });
      socket.disconnect(true);
      return;
    }

    const cookieHeader = socket.handshake.headers?.cookie || "";
    const key = String(presenterKey || cookieFromHeader(cookieHeader, COOKIE_NAME) || "");
    const keyOk = Boolean(key && keysMatch(session.presenterKeyHash, key));
    let ownerOk = false;
    if (!keyOk && role === "presenter") {
      const user = await findUserByToken(cookieFromHeader(cookieHeader, AUTH_COOKIE));
      ownerOk = Boolean(user && Number(user.id) === Number(session.userId));
    }
    const isPresenter = role === "presenter" && (keyOk || ownerOk);
    if (role === "presenter" && !isPresenter) {
      socket.emit("error", { code: "FORBIDDEN", message: "Sem permissão para controlar esta sessão." });
      socket.disconnect(true);
      return;
    }

    const room = `session:${tokenKey(session.token)}`;
    socket.join(room);
    if (isPresenter) {
      session.presenterSocketId = socket.id;
      socket.join(`${room}:presenter`);
    } else {
      addViewer(session, socket.id);
      session.viewerJoins = (session.viewerJoins || 0) + 1;
      session.viewerPeak = Math.max(session.viewerPeak || 0, session.viewers.size);
      updateSessionStats(session.token, {
        viewer_joins: session.viewerJoins,
        viewer_peak: session.viewerPeak,
        last_activity_at: new Date(),
      }).catch(() => {});
      recordEvent({
        sessionToken: session.token,
        userId: session.userId,
        type: "viewer_join",
        payload: { count: session.viewers.size },
      }).catch(() => {});
      io.to(room).emit("viewers:count", { count: session.viewers.size });
    }

    socket.emit("session:state", publicSnapshot(session));
    if (!isPresenter && session.scroll) {
      socket.emit("view:scroll", session.scroll);
    }
    if (!isPresenter && session.media) {
      socket.emit("view:media", session.media);
    }

    if (!isPresenter && session.yt) {
      socket.emit("view:yt", session.yt);
    }

    if (!isPresenter && session.mirroring) {
      socket.emit("view:mirror", { active: true });
      io.to(`${room}:presenter`).emit("webrtc:signal", { from: socket.id, type: "hello" });
    }

    socket.on("webrtc:signal", (payload = {}) => {
      const type = String(payload.type || "").slice(0, 16);
      if (!type) {
        return;
      }
      const msg = {
        from: socket.id,
        type,
        sdp: typeof payload.sdp === "string" ? payload.sdp.slice(0, 16_000) : payload.sdp || null,
        candidate: payload.candidate || null,
      };
      const peerId = String(payload.to || "");
      const inRoom = peerId && (peerId === session.presenterSocketId || session.viewers?.has(peerId));
      if (peerId) {
        if (inRoom) {
          io.to(peerId).emit("webrtc:signal", msg);
        }
        return;
      }
      if (isPresenter) {
        socket.broadcast.to(room).emit("webrtc:signal", msg);
        return;
      }
      io.to(`${room}:presenter`).emit("webrtc:signal", msg);
    });

    socket.on("presenter:goto", (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      broadcastSlide(io, room, session, clampIndex(session, payload.fileId || session.activeFileId, payload.index));
    });

    socket.on("presenter:next", () => {
      if (!isPresenter) {
        return;
      }
      broadcastSlide(io, room, session, step(session, 1));
    });

    socket.on("presenter:prev", () => {
      if (!isPresenter) {
        return;
      }
      broadcastSlide(io, room, session, step(session, -1));
    });

    socket.on("presenter:browse", async (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      try {
        const url = await assertPublicHttpUrl(normalizeHttpUrl(payload.url));
        const previous = session.currentUrl;
        const next = applyBrowse(session, url.href);
        if (previous === url.href) {
          return;
        }
        session.scroll = { x: 0, y: 0, key: "document" };
        broadcastSlide(io, room, session, next);
      } catch (error) {
        socket.emit("error", { message: error.message || "URL inválida." });
      }
    });

    socket.on("presenter:media", (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      session.media = {
        playing: Boolean(payload.playing),
        time: Number(payload.time) || 0,
        at: Date.now(),
      };
      touch(session);
      socket.broadcast.to(room).emit("view:media", session.media);
    });

    socket.on("presenter:scroll", (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      session.scroll = {
        x: Math.min(1, Math.max(0, Number(payload.x) || 0)),
        y: Math.min(1, Math.max(0, Number(payload.y) || 0)),
        key: String(payload.key || "document").slice(0, 500),
      };
      touch(session);
      socket.broadcast.to(room).emit("view:scroll", session.scroll);
    });

    socket.on("presenter:yt", (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      const videoId = String(payload.videoId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
      if (videoId.length < 11) {
        return;
      }
      session.yt = {
        videoId,
        time: Math.max(0, Number(payload.time) || 0),
        playing: Boolean(payload.playing),
        rate: Number(payload.rate) || 1,
        at: Date.now(),
      };
      touch(session);
      socket.broadcast.to(room).emit("view:yt", session.yt);
    });

    socket.on("presenter:mirror", (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      session.mirroring = Boolean(payload.active);
      touch(session);
      socket.broadcast.to(room).emit("view:mirror", { active: session.mirroring });
    });

    socket.on("presenter:frame", (data) => {
      if (!isPresenter || data == null) {
        return;
      }
      const active = session.files.find((item) => item.fileId === session.activeFileId);
      if (!active || active.kind !== "url") {
        return;
      }
      const size = data.byteLength || data.length || 0;
      if (size < 32 || size > 400_000) {
        return;
      }
      socket.volatile.broadcast.to(room).emit("view:frame", data);
    });

    socket.on("disconnect", () => {
      if (!isPresenter) {
        removeViewer(session, socket.id);
        io.to(room).emit("viewers:count", { count: session.viewers.size });
      }
    });
  });
}
