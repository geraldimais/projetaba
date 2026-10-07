import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import UploadBar from "../components/UploadBar.jsx";
import { api, loadPresenter, presenterShareUrl, savePresenter, telaoUrl } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { openCinemaWindow } from "../lib/fullscreen.js";
import { MAX_FILE_MB } from "../lib/limits.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { uploadPresentations } from "../lib/upload.js";

const ACCEPT = ".pdf,.pptx,.png,.jpg,.jpeg,.webp,.mp4,.webm,.mov,.m4v";

function kindLabel(kind) {
  if (kind === "pptx") {
    return "PPTX";
  }
  if (kind === "pdf") {
    return "PDF";
  }
  if (kind === "url") {
    return "URL";
  }
  if (kind === "video") {
    return "Vídeo";
  }
  return "Imagem";
}

export default function AppPage() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const [decks, setDecks] = useState([]);
  const [selected, setSelected] = useState([]);
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [urlValue, setUrlValue] = useState("");
  const [error, setError] = useState("");
  const [hot, setHot] = useState(false);
  const [copied, setCopied] = useState("");
  usePageTitle("Operador — PROJET-ABA");

  useEffect(() => {
    if (!user) {
      return;
    }
    const controller = new AbortController();
    Promise.all([
      api("/api/presentations", { signal: controller.signal }),
      api("/api/sessions/live", { signal: controller.signal }),
    ])
      .then(([library, current]) => {
        setDecks(library.presentations || []);
        setLive(current.session);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setError(err.message);
        }
      });
    return () => controller.abort();
  }, [user]);

  if (ready && !user) {
    return <Navigate to="/" replace />;
  }

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function upload(list) {
    const files = Array.from(list || []);
    if (!files.length) {
      return;
    }
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const result = await uploadPresentations(files, { onProgress: setProgress });
      const created = result.presentations || [];
      setDecks((current) => [...created, ...current]);
      setSelected((current) => [...current, ...created.map((item) => item.id)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function addUrl(event) {
    event.preventDefault();
    const url = urlValue.trim();
    if (!url) {
      setError("Indique a URL do site a projetar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/presentations/url", { method: "POST", body: JSON.stringify({ url }) });
      const created = result.presentations || [];
      setDecks((current) => [...created, ...current]);
      setSelected((current) => [...current, ...created.map((item) => item.id)]);
      setUrlValue("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeDeck(id) {
    if (!window.confirm("Remover este conteúdo da biblioteca?")) {
      return;
    }
    try {
      await api(`/api/presentations/${id}`, { method: "DELETE" });
      setDecks((current) => current.filter((item) => item.id !== id));
      setSelected((current) => current.filter((item) => item !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  async function project(ids) {
    const presentationIds = ids.length ? ids : selected;
    if (!presentationIds.length) {
      setError("Selecione ao menos um item para projetar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (live?.token) {
        for (const presentationId of presentationIds) {
          const result = await api(`/api/sessions/${encodeURIComponent(live.token)}/select`, {
            method: "POST",
            body: JSON.stringify({ presentationId }),
          });
          setLive(result.session || live);
        }
        return;
      }
      const session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ presentationIds }),
      });
      savePresenter(session.token, session.presenterKey);
      setLive({ ...session.session, token: session.token, telaoUrl: session.telaoUrl, presenterUrl: session.presenterUrl });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function endLive() {
    if (!live?.token) {
      return;
    }
    if (!window.confirm("Encerrar esta projeção? O telão e o palestrante param.")) {
      return;
    }
    await api(`/api/sessions/${encodeURIComponent(live.token)}/end`, { method: "POST" });
    setLive(null);
  }

  async function copySpeakerLink() {
    if (!live?.token) {
      return;
    }
    try {
      await navigator.clipboard.writeText(presenterShareUrl(live.token, loadPresenter(live.token)));
      setCopied("speaker");
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      window.prompt("Link do palestrante", presenterShareUrl(live.token, loadPresenter(live.token)));
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark to="/app" />
        <div className="topbar-actions">
          {user?.role === "admin" ? (
            <Link className="ghost" to="/admin">
              Métricas
            </Link>
          ) : null}
          <span className="who">{user?.name}</span>
          <button className="ghost" type="button" onClick={() => logout().then(() => navigate("/"))}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="dash">
        <div className="dash-head">
          <div>
            <p className="eyebrow">Painel do operador</p>
            <h1>Conteúdo para o telão</h1>
            <p className="lede">
              Receba o material do palestrante, carregue PDF, PPTX, imagem, vídeo ou um site e abra o telão no
              computador do projetor.
            </p>
          </div>
          <div className="dash-actions">
            <button className="cta" type="button" disabled={busy || !selected.length} onClick={() => project(selected)}>
              {busy && progress == null ? "A preparar…" : live ? "Enviar ao telão" : "Projetar no telão"}
            </button>
          </div>
        </div>

        {live?.token ? (
          <section className="session-link" aria-label="Projeção ao vivo">
            <p className="url-kicker">Projeção ao vivo · {live.token}</p>
            <code>{telaoUrl(live.token)}</code>
            <div className="session-link-actions">
              <button className="cta mini" type="button" onClick={() => openCinemaWindow(telaoUrl(live.token))}>
                Abrir telão
              </button>
              <button className="ghost mini" type="button" onClick={copySpeakerLink}>
                Copiar link do palestrante
              </button>
              <button className="ghost mini" type="button" onClick={endLive}>
                Encerrar
              </button>
            </div>
            {copied === "speaker" ? (
              <p className="copy-status" role="status">
                Link do palestrante copiado
              </p>
            ) : null}
          </section>
        ) : null}

        <div
          className={`dropzone ${hot ? "hot" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setHot(true);
          }}
          onDragLeave={() => setHot(false)}
          onDrop={(event) => {
            event.preventDefault();
            setHot(false);
            upload(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            aria-label="Enviar apresentações"
            onChange={(event) => {
              upload(event.target.files);
              event.target.value = "";
            }}
          />
          <div>
            <strong>Solte PDF, PPTX, imagens ou vídeo</strong>
            <p>Até {MAX_FILE_MB} MB por ficheiro. Arquivos grandes são enviados em partes, com barra de progresso.</p>
          </div>
        </div>
        <UploadBar value={progress} label={progress != null ? `A enviar ${progress}%` : null} />

        <form className="url-add" onSubmit={addUrl}>
          <label>
            Projetar um site
            <input
              type="url"
              inputMode="url"
              placeholder="https://exemplo.com"
              value={urlValue}
              disabled={busy}
              onChange={(event) => setUrlValue(event.target.value)}
            />
          </label>
          <button className="cta" type="submit" disabled={busy}>
            Carregar URL
          </button>
        </form>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="deck-grid">
          {decks.map((deck) => (
            <li key={deck.id} className={`deck-card ${selected.includes(deck.id) ? "on" : ""}`}>
              <label className="deck-check">
                <input
                  type="checkbox"
                  checked={selected.includes(deck.id)}
                  onChange={() => toggle(deck.id)}
                />
                <span>
                  <strong>{deck.title}</strong>
                  <em>
                    {kindLabel(deck.kind)}
                    {deck.kind === "url"
                      ? ` · ${deck.sourceUrl || deck.originalName}`
                      : ` · ${deck.pageCount} ${deck.pageCount === 1 ? "página" : "páginas"}`}
                  </em>
                </span>
              </label>
              <div className="deck-actions">
                <button className="cta mini" type="button" onClick={() => project([deck.id])}>
                  Enviar ao telão
                </button>
                <button className="ghost mini" type="button" onClick={() => removeDeck(deck.id)}>
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!decks.length ? (
          <p className="wait">Ainda não há conteúdo nesta conta. Solte um ficheiro ou carregue uma URL.</p>
        ) : null}
      </main>
    </div>
  );
}
