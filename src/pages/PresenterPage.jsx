import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import SlideStage from "../components/SlideStage.jsx";
import UploadBar from "../components/UploadBar.jsx";
import { api, loadPresenter } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { activeDeck, isUrlDeck } from "../lib/deck.js";
import { openCinemaWindow } from "../lib/fullscreen.js";
import { isPublicHttpUrl } from "../lib/httpUrl.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { connectSession } from "../lib/socket.js";
import { uploadPresentations } from "../lib/upload.js";

const ACCEPT = ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov,.m4v";

export default function PresenterPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const presenterKey = loadPresenter(token);
  const socketRef = useRef(null);
  const [session, setSession] = useState(null);
  const [library, setLibrary] = useState([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [urlValue, setUrlValue] = useState("");
  const [barUrl, setBarUrl] = useState("");
  const [panelSound, setPanelSound] = useState(false);
  const [copied, setCopied] = useState(false);
  usePageTitle(session?.token ? `Ao vivo ${session.token} — PROJET-ABA` : "Sessão — PROJET-ABA");

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
        } else {
          await api(`/api/sessions/${encodeURIComponent(token)}/auth`, {
            method: "POST",
            body: JSON.stringify({}),
          }).catch(() => {});
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
            current
              ? {
                  ...current,
                  currentIndex: payload.index,
                  activeFileId: payload.fileId,
                  currentUrl: payload.currentUrl ?? current.currentUrl,
                }
              : current
          );
        });
        socket.on("viewers:count", ({ count }) => {
          setSession((current) => (current ? { ...current, viewerCount: count } : current));
        });
        socket.on("error", (payload) => {
          if (payload?.code === "FORBIDDEN") {
            setSession(null);
          }
          setError(payload.message);
        });
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
    if (!user) {
      return;
    }
    api("/api/presentations")
      .then((data) => setLibrary(data.presentations || []))
      .catch(() => {});
  }, [user]);

  const file = activeDeck(session);
  const isUrl = isUrlDeck(file);
  const liveUrl = isUrl ? file.history?.[session?.currentIndex || 0] || session?.currentUrl || file.sourceUrl : "";

  useEffect(() => {
    setBarUrl(liveUrl || "");
  }, [liveUrl]);

  useEffect(() => {
    function onKey(event) {
      if (event.target.closest("input, textarea, button, a, select, [contenteditable]")) {
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

  const thumbs = useMemo(() => {
    if (!file) {
      return [];
    }
    return Array.from({ length: file.pageCount || 0 }, (_, index) => index);
  }, [file]);

  const projectionUrl = session?.projectionUrl || `${window.location.origin}/projetar/${token}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(projectionUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Link da apresentação", projectionUrl);
    }
  }

  async function addFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) {
      return;
    }
    setUploading(true);
    setError("");
    setProgress(0);
    try {
      const headers = presenterKey ? { "X-Presenter-Key": presenterKey } : {};
      const result = await uploadPresentations(files, { headers, onProgress: setProgress });
      const created = result.presentations || [];
      for (const deck of created) {
        const next = await api(`/api/sessions/${encodeURIComponent(token)}/select`, {
          method: "POST",
          headers,
          body: JSON.stringify({ presentationId: deck.id }),
        });
        setSession((current) => ({ ...(current || {}), ...next.session }));
      }
      const libraryData = await api("/api/presentations").catch(() => null);
      if (libraryData) {
        setLibrary(libraryData.presentations || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function addUrl(event) {
    event.preventDefault();
    const url = urlValue.trim();
    if (!isPublicHttpUrl(url)) {
      setError("Use uma URL http ou https.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const headers = presenterKey ? { "X-Presenter-Key": presenterKey } : {};
      const result = await api(`/api/sessions/${encodeURIComponent(token)}/url`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      });
      setSession((current) => ({ ...current, ...result.session }));
      setUrlValue("");
      const libraryData = await api("/api/presentations").catch(() => null);
      if (libraryData) {
        setLibrary(libraryData.presentations || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function goUrl(event) {
    event.preventDefault();
    const url = barUrl.trim();
    if (!isPublicHttpUrl(url)) {
      setError("Use uma URL http ou https.");
      return;
    }
    socketRef.current?.emit("presenter:browse", { url });
    window.location.assign(`/navegar/${encodeURIComponent(token)}?role=presenter&u=${encodeURIComponent(url)}`);
  }

  async function selectDeck(presentationId) {
    try {
      const result = await api(`/api/sessions/${encodeURIComponent(token)}/select`, {
        method: "POST",
        headers: presenterKey ? { "X-Presenter-Key": presenterKey } : {},
        body: JSON.stringify({ presentationId }),
      });
      setSession((current) => ({ ...current, ...result.session }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function endSession() {
    if (!window.confirm("Encerrar esta sessão? A plateia deixa de ver o deck.")) {
      return;
    }
    await api(`/api/sessions/${encodeURIComponent(token)}/end`, {
      method: "POST",
      headers: presenterKey ? { "X-Presenter-Key": presenterKey } : {},
    });
    navigate("/app");
  }

  if (error && !session) {
    return (
      <div className="shell">
        <header className="topbar">
          <BrandMark />
        </header>
        <p className="wait" role="alert">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark to="/app" />
        <span className="live" role="status" aria-live="polite" aria-atomic="true">
          AO VIVO · {session?.token} · {session?.viewerCount || 0} na plateia
        </span>
        <div className="topbar-actions">
          <Link className="ghost" to="/app">
            Biblioteca
          </Link>
          <button className="ghost" type="button" onClick={endSession}>
            Encerrar
          </button>
        </div>
      </header>
      <div className="session-link">
        <p className="url-kicker">Link da apresentação</p>
        <code>{projectionUrl}</code>
        <div className="session-link-actions">
          <button className="cta mini" type="button" onClick={copyLink}>
            Copiar
          </button>
          <button className="ghost mini" type="button" onClick={() => openCinemaWindow(projectionUrl)}>
            Abrir
          </button>
          {copied ? (
            <p className="copy-status" role="status">
              Link copiado
            </p>
          ) : null}
        </div>
        {session?.qrDataUrl ? (
          <img className="qr session-qr" src={session.qrDataUrl} alt={`QR da apresentação ${session.token}`} />
        ) : null}
      </div>
      <main id="conteudo" className="console">
        <h1 className="sr-only">Sessão {session?.token || token}</h1>
        <aside className="rail" aria-label="Slides">
          <div className="thumbs">
            {thumbs.map((index) => (
              <button
                key={index}
                className={`thumb ${session?.currentIndex === index ? "active" : ""}`}
                type="button"
                aria-current={session?.currentIndex === index ? "true" : undefined}
                aria-label={isUrl ? `Página visitada ${index + 1}` : `Slide ${index + 1} de ${file.pageCount}`}
                onClick={() => socketRef.current?.emit("presenter:goto", { fileId: file.fileId, index })}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
              </button>
            ))}
          </div>
          <p className="url-kicker">Biblioteca</p>
          <div className="library-list">
            {library.map((deck) => (
              <button
                key={deck.id}
                type="button"
                className={`thumb ${session?.activeFileId === deck.id ? "active" : ""}`}
                aria-current={session?.activeFileId === deck.id ? "true" : undefined}
                onClick={() => selectDeck(deck.id)}
              >
                <span>{deck.kind.toUpperCase()}</span>
                <span>{deck.title}</span>
              </button>
            ))}
          </div>
          <label className="add-files">
            {uploading ? "A enviar…" : "Acrescentar arquivos"}
            <input
              type="file"
              accept={ACCEPT}
              multiple
              disabled={uploading}
              aria-label="Acrescentar PDF, PPTX, imagens ou vídeos à sessão"
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <form className="url-add compact" onSubmit={addUrl}>
            <input
              type="url"
              inputMode="url"
              placeholder="https://site.com"
              value={urlValue}
              disabled={uploading}
              onChange={(event) => setUrlValue(event.target.value)}
              aria-label="URL para projetar"
            />
            <button className="ghost mini" type="submit" disabled={uploading}>
              URL
            </button>
          </form>
          <UploadBar value={progress} />
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </aside>
        <section className="stage-wrap">
          {isUrl ? (
            <form className="url-bar" onSubmit={goUrl}>
              <button className="ghost mini" type="button" onClick={() => socketRef.current?.emit("presenter:prev")}>
                Voltar
              </button>
              <button className="ghost mini" type="button" onClick={() => socketRef.current?.emit("presenter:next")}>
                Avançar
              </button>
              <input
                type="url"
                value={barUrl}
                onChange={(event) => setBarUrl(event.target.value)}
                aria-label="Endereço do site projetado"
              />
              <button className="cta mini" type="submit">
                Ir
              </button>
            </form>
          ) : null}
          <div className={`dual-stage ${isUrl ? "url-mode" : ""}`}>
            {isUrl ? (
              <div className="stage stage-live url-launch">
                <p>YouTube abre no player (imagem e som na projeção). Outros sites: Abrir site e Espelhar na projeção, marcando o áudio da aba.</p>
                <a className="cta" href={`/navegar/${encodeURIComponent(token)}?role=presenter`}>
                  Abrir site
                </a>
              </div>
            ) : (
              <>
                <SlideStage
                  session={session}
                  className="stage stage-live"
                  label="Projeção"
                  isPresenter
                  audible={panelSound}
                  emitMedia={(payload) => socketRef.current?.emit("presenter:media", payload)}
                />
                <SlideStage
                  session={session}
                  className="stage stage-next"
                  slideIndex={(session?.currentIndex || 0) + 1}
                  label="Próxima"
                  showMedia={false}
                />
              </>
            )}
          </div>
          <div className="transport">
            <button className="cta" type="button" onClick={() => socketRef.current?.emit("presenter:prev")}>
              Anterior
            </button>
            <span className="transport-count">
              {(session?.currentIndex || 0) + 1} / {file?.pageCount || 0}
            </span>
            <button className="cta" type="button" onClick={() => socketRef.current?.emit("presenter:next")}>
              Próximo
            </button>
            <button
              className={`ghost mini ${panelSound ? "active" : ""}`}
              type="button"
              aria-pressed={panelSound}
              title="O som da apresentação sai na tela de projeção. Ligue só se precisar ouvir no painel."
              onClick={() => setPanelSound((value) => !value)}
            >
              {panelSound ? "Som no painel" : "Painel mudo"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
