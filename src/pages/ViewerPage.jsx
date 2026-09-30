import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SlideStage from "../components/SlideStage.jsx";
import { api } from "../lib/api.js";
import { connectSession } from "../lib/socket.js";

export default function ViewerPage() {
  const { token } = useParams();
  const [session, setSession] = useState(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState("");

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
        socket = connectSession({ token, role: "viewer" });
        socket.on("session:state", setSession);
        socket.on("slide:changed", (payload) => {
          setSession((current) =>
            current ? { ...current, currentIndex: payload.index, activeFileId: payload.fileId } : current
          );
        });
        socket.on("session:ended", () => setEnded(true));
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

  if (ended) {
    return (
      <div className="cinema">
        <div className="wait">
          <p>Sessão encerrada</p>
          <Link to="/">Voltar ao início</Link>
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
    <div className="cinema">
      <SlideStage session={session} className="stage" />
    </div>
  );
}
