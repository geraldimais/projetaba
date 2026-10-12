import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import SlideStage from "../components/SlideStage.jsx";
import { api, loadPresenter } from "../lib/api.js";
import { activeDeck, isUrlDeck } from "../lib/deck.js";
import { isPublicHttpUrl } from "../lib/httpUrl.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { connectSession } from "../lib/socket.js";
import { clampZoom, nudgeZoom } from "../lib/zoom.js";

export default function PalestrantePage() {
  const { token } = useParams();
  const presenterKey = loadPresenter(token);
  const socketRef = useRef(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [barUrl, setBarUrl] = useState("");
  const [panelSound, setPanelSound] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const zoomRef = useRef({ scale: 1, x: 0, y: 0 });
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
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
          applyZoom({ scale: 1, x: 0, y: 0 }, false);
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
        socket.on("view:zoom", (payload) => applyZoom(payload, false));
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
      if (zoomRef.current.scale > 1 && ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const dx = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        const dy = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        applyZoom(nudgeZoom(zoomRef.current, dx, dy));
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        goPrev();
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
  const pageIndex = session?.currentIndex || 0;
  const pageCount = file?.pageCount || 0;
  const atStart = pageIndex <= 0;
  const atEnd = pageCount > 0 && pageIndex >= pageCount - 1;

  function applyZoom(next, emit = true) {
    const value = clampZoom(next);
    zoomRef.current = value;
    setZoom(value);
    if (emit) {
      socketRef.current?.emit("presenter:zoom", value);
    }
  }

  function goPrev() {
    applyZoom({ scale: 1, x: 0, y: 0 });
    socketRef.current?.emit("presenter:prev");
  }

  function goNext() {
    applyZoom({ scale: 1, x: 0, y: 0 });
    socketRef.current?.emit("presenter:next");
  }

  function onStagePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    if (event.target.closest("button, a, input, textarea, select, video, [data-no-swipe]")) {
      return;
    }
    const stage = event.currentTarget;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchRef.current = { dist, scale: zoomRef.current.scale };
      return;
    }
    stage.setPointerCapture?.(event.pointerId);
    stage.dataset.swipeX = String(event.clientX);
    stage.dataset.swipeY = String(event.clientY);
    stage.dataset.swipeT = String(Date.now());
    stage.dataset.panX = String(zoomRef.current.x);
    stage.dataset.panY = String(zoomRef.current.y);
  }

  function onStagePointerMove(event) {
    const stage = event.currentTarget;
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size === 2 && pinchRef.current?.dist) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      applyZoom({ ...zoomRef.current, scale: pinchRef.current.scale * (dist / pinchRef.current.dist) });
      return;
    }
    if (!stage.dataset.swipeX || zoomRef.current.scale <= 1) {
      return;
    }
    const startX = Number(stage.dataset.swipeX);
    const startY = Number(stage.dataset.swipeY);
    const width = stage.clientWidth || 1;
    const height = stage.clientHeight || 1;
    applyZoom({
      scale: zoomRef.current.scale,
      x: Number(stage.dataset.panX || 0) + (event.clientX - startX) / width,
      y: Number(stage.dataset.panY || 0) + (event.clientY - startY) / height,
    });
  }

  function onStagePointerUp(event) {
    const stage = event.currentTarget;
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    const startX = Number(stage.dataset.swipeX || "");
    const startY = Number(stage.dataset.swipeY || "");
    const startT = Number(stage.dataset.swipeT || "");
    const zoomed = zoomRef.current.scale > 1;
    delete stage.dataset.swipeX;
    delete stage.dataset.swipeY;
    delete stage.dataset.swipeT;
    delete stage.dataset.panX;
    delete stage.dataset.panY;
    if (zoomed || !Number.isFinite(startX) || !Number.isFinite(startT)) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const dt = Date.now() - startT;
    if (dt > 900 || Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.15) {
      return;
    }
    if (dx < 0) {
      goNext();
    } else {
      goPrev();
    }
  }

  function onStageWheel(event) {
    event.preventDefault();
    const prev = zoomRef.current;
    const nextScale = prev.scale + (event.deltaY > 0 ? -0.2 : 0.2);
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = (event.clientX - rect.left) / (rect.width || 1) - 0.5;
    const cy = (event.clientY - rect.top) / (rect.height || 1) - 0.5;
    applyZoom({
      scale: nextScale,
      x: prev.x + cx * (prev.scale - nextScale),
      y: prev.y + cy * (prev.scale - nextScale),
    });
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
    <div className="shell shell-palestrante">
      <header className="topbar">
        <BrandMark to="/app" />
        <span className="live" role="status" aria-live="polite" aria-atomic="true">
          AO VIVO · {session?.token}
        </span>
      </header>
      <main id="conteudo" className="console console-palestrante">
        <h1 className="sr-only">Painel do palestrante {session?.token || token}</h1>
        <section className="stage-wrap">
          {isUrl ? (
            <form className="url-bar" onSubmit={goUrl}>
              <button className="ghost mini" type="button" onClick={goPrev}>
                Voltar
              </button>
              <button className="ghost mini" type="button" onClick={goNext}>
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
          <div
            className={`dual-stage ${isUrl ? "url-mode" : ""} ${zoom.scale > 1 ? "is-zoomed" : ""}`}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onWheel={onStageWheel}
            onPointerCancel={(event) => {
              delete event.currentTarget.dataset.swipeX;
              delete event.currentTarget.dataset.swipeY;
              delete event.currentTarget.dataset.swipeT;
              delete event.currentTarget.dataset.panX;
              delete event.currentTarget.dataset.panY;
            }}
          >
            {isUrl ? (
              <div className="stage stage-live url-launch">
                <p>YouTube abre no player. Outros sites: abrir e espelhar no telão, marcando o áudio da aba.</p>
                <a className="cta" href={`/navegar/${encodeURIComponent(token)}?role=presenter`}>
                  Abrir site
                </a>
              </div>
            ) : (
              <SlideStage
                session={session}
                className="stage stage-live"
                label="Telão"
                isPresenter
                audible={panelSound}
                zoom={zoom}
                emitMedia={(payload) => socketRef.current?.emit("presenter:media", payload)}
              />
            )}
            <button
              className="stage-arrow stage-arrow-prev"
              type="button"
              aria-label="Slide anterior"
              disabled={atStart}
              onClick={goPrev}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              className="stage-arrow stage-arrow-next"
              type="button"
              aria-label="Próximo slide"
              disabled={atEnd}
              onClick={goNext}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </section>
        <footer className="presenter-strip">
          <div className="thumbs" aria-label="Slides">
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
            <div className="library-list" aria-label="Conteúdo no telão">
              {decks.map((deck) => (
                <button
                  key={deck.fileId}
                  type="button"
                  className={`thumb ${session?.activeFileId === deck.fileId ? "active" : ""}`}
                  aria-current={session?.activeFileId === deck.fileId ? "true" : undefined}
                  onClick={() => socketRef.current?.emit("presenter:goto", { fileId: deck.fileId, index: 0 })}
                >
                  <span>{(deck.kind || "").toUpperCase()}</span>
                </button>
              ))}
            </div>
          ) : null}
          <span className="transport-count">
            {pageCount ? `${pageIndex + 1} / ${pageCount}` : "—"}
          </span>
          <div className="zoom-controls" role="group" aria-label="Zoom do slide">
            <button className="ghost mini" type="button" aria-label="Reduzir zoom" onClick={() => applyZoom({ ...zoom, scale: zoom.scale - 0.25 })}>
              −
            </button>
            <button className="ghost mini" type="button" onClick={() => applyZoom({ scale: 1, x: 0, y: 0 })}>
              {Math.round(zoom.scale * 100)}%
            </button>
            <button className="ghost mini" type="button" aria-label="Aumentar zoom" onClick={() => applyZoom({ ...zoom, scale: zoom.scale + 0.25 })}>
              +
            </button>
            <button className="ghost mini" type="button" aria-label="Mover para a esquerda" disabled={zoom.scale <= 1} onClick={() => applyZoom(nudgeZoom(zoom, -1, 0))}>
              ←
            </button>
            <button className="ghost mini" type="button" aria-label="Mover para cima" disabled={zoom.scale <= 1} onClick={() => applyZoom(nudgeZoom(zoom, 0, -1))}>
              ↑
            </button>
            <button className="ghost mini" type="button" aria-label="Mover para baixo" disabled={zoom.scale <= 1} onClick={() => applyZoom(nudgeZoom(zoom, 0, 1))}>
              ↓
            </button>
            <button className="ghost mini" type="button" aria-label="Mover para a direita" disabled={zoom.scale <= 1} onClick={() => applyZoom(nudgeZoom(zoom, 1, 0))}>
              →
            </button>
          </div>
          <button
            className={`ghost mini ${panelSound ? "active" : ""}`}
            type="button"
            aria-pressed={panelSound}
            title="O som sai no telão. Ligue só se precisar ouvir neste painel."
            onClick={() => setPanelSound((value) => !value)}
          >
            {panelSound ? "Som" : "Mudo"}
          </button>
        </footer>
        {error ? (
          <p className="error presenter-error" role="alert">
            {error}
          </p>
        ) : null}
      </main>
    </div>
  );
}
