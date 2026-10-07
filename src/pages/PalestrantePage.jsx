import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import SlideStage from "../components/SlideStage.jsx";
import { api, loadPresenter } from "../lib/api.js";
import { activeDeck, isUrlDeck } from "../lib/deck.js";
import { isPublicHttpUrl } from "../lib/httpUrl.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { connectSession } from "../lib/socket.js";

export default function PalestrantePage() {
  const { token } = useParams();
  const presenterKey = loadPresenter(token);
  const socketRef = useRef(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [barUrl, setBarUrl] = useState("");
  const [panelSound, setPanelSound] = useState(false);
  usePageTitle(session?.token ? `Palestrante ${session.token} — PROJET-ABA` : "Palestrante — PROJET-ABA");

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

  const decks = session?.files || [];

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
          AO VIVO · {session?.token}
        </span>
      </header>
      <main id="conteudo" className="console">
        <h1 className="sr-only">Painel do palestrante {session?.token || token}</h1>
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
          {decks.length > 1 ? (
            <>
              <p className="url-kicker">Conteúdo no telão</p>
              <div className="library-list">
                {decks.map((deck) => (
                  <button
                    key={deck.fileId}
                    type="button"
                    className={`thumb ${session?.activeFileId === deck.fileId ? "active" : ""}`}
                    aria-current={session?.activeFileId === deck.fileId ? "true" : undefined}
                    onClick={() => socketRef.current?.emit("presenter:goto", { fileId: deck.fileId, index: 0 })}
                  >
                    <span>{(deck.kind || "").toUpperCase()}</span>
                    <span>{deck.originalName || deck.title || deck.fileId}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
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
                <p>YouTube abre no player. Outros sites: abrir e espelhar no telão, marcando o áudio da aba.</p>
                <a className="cta" href={`/navegar/${encodeURIComponent(token)}?role=presenter`}>
                  Abrir site
                </a>
              </div>
            ) : (
              <>
                <SlideStage
                  session={session}
                  className="stage stage-live"
                  label="Telão"
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
              title="O som sai no telão. Ligue só se precisar ouvir neste painel."
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
