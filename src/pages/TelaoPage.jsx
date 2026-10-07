import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SlideStage from "../components/SlideStage.jsx";
import { api } from "../lib/api.js";
import { activeDeck, isUrlDeck } from "../lib/deck.js";
import { expandToScreen, requestCinemaFullscreen } from "../lib/fullscreen.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { connectSession } from "../lib/socket.js";

export default function TelaoPage() {
  const { token } = useParams();
  const rootRef = useRef(null);
  const armedRef = useRef(true);
  const [session, setSession] = useState(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");
  const [media, setMedia] = useState(null);
  const [hint, setHint] = useState(true);
  usePageTitle(token ? `Telão ${token} — PROJET-ABA` : "Telão — PROJET-ABA");

  useEffect(() => {
    let socket;
    let cancelled = false;
    async function boot() {
      try {
        const snapshot = await api(`/api/sessions/${encodeURIComponent(token)}`);
        if (cancelled) {
          return;
        }
        setSession(snapshot);
        const active = activeDeck(snapshot);
        if (isUrlDeck(active)) {
          window.location.replace(`/navegar/${encodeURIComponent(token)}`);
          return;
        }
        socket = connectSession({ token, role: "viewer" });
        socket.on("session:state", (next) => {
          const file = activeDeck(next);
          if (isUrlDeck(file)) {
            window.location.replace(`/navegar/${encodeURIComponent(token)}`);
            return;
          }
          setSession(next);
        });
        socket.on("slide:changed", (payload) => {
          setSession((current) => {
            const next = current
              ? {
                  ...current,
                  currentIndex: payload.index,
                  activeFileId: payload.fileId,
                  currentUrl: payload.currentUrl ?? current.currentUrl,
                }
              : current;
            if (isUrlDeck(activeDeck(next))) {
              window.location.replace(`/navegar/${encodeURIComponent(token)}`);
            }
            return next;
          });
        });
        socket.on("session:ended", () => setEnded(true));
        socket.on("view:media", setMedia);
        socket.on("error", (payload) => setError(payload.message));
      } catch (err) {
        setError(err.message);
      }
    }
    boot();
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [token]);

  useEffect(() => {
    const id = window.setTimeout(() => setHint(false), 3200);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    expandToScreen();
    requestCinemaFullscreen();

    function onActivate() {
      if (!armedRef.current) {
        return;
      }
      requestCinemaFullscreen();
    }

    function onFullscreenChange() {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        armedRef.current = false;
      }
    }

    const events = ["pointerup", "keydown", "touchend", "click"];
    for (const name of events) {
      window.addEventListener(name, onActivate, { capture: true });
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    window.addEventListener("focus", onActivate);
    const retry = window.setTimeout(() => requestCinemaFullscreen(), 250);
    return () => {
      window.clearTimeout(retry);
      for (const name of events) {
        window.removeEventListener(name, onActivate, { capture: true });
      }
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      window.removeEventListener("focus", onActivate);
    };
  }, []);

  if (ended) {
    return (
      <div className="cinema">
        <div className="wait">
          <p>Projeção encerrada</p>
          <Link to="/app">Voltar ao painel do operador</Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="cinema">
        <p className="wait">{error}</p>
      </div>
    );
  }

  return (
    <div className="cinema" id="conteudo" ref={rootRef}>
      <SlideStage session={session} className="stage cinema-stage" fillViewport follow={media} audible />
      {hint ? <p className="cinema-hint">Telão — ecrã inteiro. Clique ou toque.</p> : null}
    </div>
  );
}
