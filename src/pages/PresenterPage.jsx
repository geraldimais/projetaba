import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import SlideStage from "../components/SlideStage.jsx";
import { api, loadPresenter } from "../lib/api.js";
import { connectSession } from "../lib/socket.js";

export default function PresenterPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const presenterKey = loadPresenter(token);
  const socketRef = useRef(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let socket;
    async function boot() {
      try {
        if (presenterKey) {
          await api(`/api/sessions/${encodeURIComponent(token)}/auth`, {
            method: "POST",
            headers: { "X-Presenter-Key": presenterKey },
            body: JSON.stringify({ presenterKey }),
          });
        }
        const snapshot = await api(`/api/sessions/${encodeURIComponent(token)}`);
        if (cancelled) {
          return;
        }
        setSession(snapshot);
        socket = connectSession({ token, role: "presenter", presenterKey });
        socketRef.current = socket;
        socket.on("session:state", setSession);
        socket.on("slide:changed", (payload) => {
          setSession((current) =>
            current ? { ...current, currentIndex: payload.index, activeFileId: payload.fileId } : current
          );
        });
        socket.on("viewers:count", ({ count }) => {
          setSession((current) => (current ? { ...current, viewerCount: count } : current));
        });
        socket.on("error", (payload) => setError(payload.message));
      } catch (err) {
        setError(err.message);
      }
    }
    boot();
    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [token, presenterKey]);

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest("input, textarea")) {
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        socketRef.current?.emit("presenter:next");
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        socketRef.current?.emit("presenter:prev");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const file = session?.files?.find((item) => item.fileId === session.activeFileId) || session?.files?.[0];
  const thumbs = useMemo(() => {
    if (!file) {
      return [];
    }
    return Array.from({ length: file.pageCount || 0 }, (_, index) => index);
  }, [file]);

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt(label, text);
    }
  }

  async function endSession() {
    if (!window.confirm("Encerrar esta sessão? A plateia deixa de ver o deck.")) {
      return;
    }
    await api(`/api/sessions/${encodeURIComponent(token)}/end`, {
      method: "POST",
      headers: { "X-Presenter-Key": presenterKey },
    });
    navigate("/");
  }

  if (error && !session) {
    return (
      <div className="shell">
        <header className="topbar">
          <BrandMark />
        </header>
        <p className="wait">{error}</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark />
        <span className="live">AO VIVO · {session?.viewerCount || 0} espectadores</span>
        <button className="ghost" type="button" onClick={endSession}>
          Encerrar sessão
        </button>
      </header>
      <div className="console">
        <aside className="rail" aria-label="Slides">
          <div className="thumbs">
            {thumbs.map((index) => (
              <button
                key={index}
                className={`thumb ${session?.currentIndex === index ? "active" : ""}`}
                type="button"
                aria-current={session?.currentIndex === index ? "true" : undefined}
                aria-label={`Slide ${index + 1} de ${file.pageCount}`}
                onClick={() => socketRef.current?.emit("presenter:goto", { fileId: file.fileId, index })}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {file.kind === "pdf" ? (
                  <span />
                ) : (
                  <img
                    src={`/api/sessions/${encodeURIComponent(token)}/slides/${file.fileId}/${index}`}
                    alt=""
                  />
                )}
              </button>
            ))}
          </div>
        </aside>
        <section className="stage-wrap">
          <SlideStage session={session} />
          <div className="transport">
            <button className="ghost" type="button" onClick={() => socketRef.current?.emit("presenter:prev")}>
              Anterior
            </button>
            <span>
              {(session?.currentIndex || 0) + 1} / {file?.pageCount || 0}
            </span>
            <button className="ghost" type="button" onClick={() => socketRef.current?.emit("presenter:next")}>
              Próximo
            </button>
          </div>
        </section>
        <aside className="side">
          <p>Código da sessão</p>
          <p className="token">{session?.token}</p>
          <button className="ghost" type="button" onClick={() => copy(session?.token, "Código")}>
            Copiar código
          </button>
          {session?.qrDataUrl ? (
            <p>
              <img className="qr" src={session.qrDataUrl} alt={`QR para entrar na sessão ${session.token}`} />
            </p>
          ) : null}
          <button className="ghost" type="button" onClick={() => copy(session?.joinUrl, "Link")}>
            Copiar link da plateia
          </button>
        </aside>
      </div>
    </div>
  );
}
