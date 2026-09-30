import { getSession, publicSnapshot, addViewer, removeViewer, touch } from "../services/sessionStore.js";
import { keysMatch, tokenKey } from "../util/tokens.js";

function clampIndex(session, fileId, index) {
  const file = session.files.find((item) => item.fileId === fileId) || session.files[0];
  if (!file) {
    return { fileId: null, index: 0 };
  }
  const max = Math.max(0, (file.pageCount || 1) - 1);
  return { fileId: file.fileId, index: Math.min(Math.max(0, index), max) };
}

export function bindSocket(io) {
  io.on("connection", (socket) => {
    const { token, role, presenterKey } = socket.handshake.auth || {};
    const session = getSession(token);
    if (!session || session.status !== "live") {
      socket.emit("error", { code: "NOT_FOUND", message: "Sessão não encontrada." });
      socket.disconnect(true);
      return;
    }

    const isPresenter = role === "presenter" && keysMatch(session.presenterKeyHash, presenterKey);
    if (role === "presenter" && !isPresenter) {
      socket.emit("error", { code: "UNAUTHORIZED", message: "Chave do apresentador inválida." });
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
      io.to(room).emit("viewers:count", { count: session.viewers.size });
    }

    socket.emit("session:state", publicSnapshot(session));

    socket.on("presenter:goto", (payload = {}) => {
      if (!isPresenter) {
        return;
      }
      const next = clampIndex(session, payload.fileId || session.activeFileId, Number(payload.index) || 0);
      session.activeFileId = next.fileId;
      session.currentIndex = next.index;
      touch(session);
      io.to(room).emit("slide:changed", next);
      io.to(room).emit("session:state", publicSnapshot(session));
    });

    socket.on("presenter:next", () => {
      if (!isPresenter) {
        return;
      }
      const next = clampIndex(session, session.activeFileId, session.currentIndex + 1);
      session.activeFileId = next.fileId;
      session.currentIndex = next.index;
      touch(session);
      io.to(room).emit("slide:changed", next);
      io.to(room).emit("session:state", publicSnapshot(session));
    });

    socket.on("presenter:prev", () => {
      if (!isPresenter) {
        return;
      }
      const next = clampIndex(session, session.activeFileId, session.currentIndex - 1);
      session.activeFileId = next.fileId;
      session.currentIndex = next.index;
      touch(session);
      io.to(room).emit("slide:changed", next);
      io.to(room).emit("session:state", publicSnapshot(session));
    });

    socket.on("disconnect", () => {
      removeViewer(session, socket.id);
      io.to(room).emit("viewers:count", { count: session.viewers.size });
    });
  });
}
