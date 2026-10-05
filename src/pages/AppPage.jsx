import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import UploadBar from "../components/UploadBar.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
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
  usePageTitle("Biblioteca — PROJET-ABA");

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
    if (!window.confirm("Remover esta apresentação da biblioteca?")) {
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
      setError("Selecione ao menos uma apresentação.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ presentationIds }),
      });
      navigate(`/sessao/${session.token}`);
    } catch (err) {
      if (err.message.includes("ao vivo") && live?.token) {
        navigate(`/sessao/${live.token}`);
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
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
          <Link className="ghost" to="/entrar">
            Código
          </Link>
          <span className="who">{user?.name}</span>
          <button className="ghost" type="button" onClick={() => logout().then(() => navigate("/"))}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="dash">
        <div className="dash-head">
          <div>
            <p className="eyebrow">Biblioteca</p>
            <h1>Suas apresentações</h1>
            <p className="lede">Prepare os decks, carregue um site por URL e escolha o que vai para a projeção.</p>
          </div>
          <div className="dash-actions">
            {live ? (
              <Link className="ghost" to={`/sessao/${live.token}`}>
                Continuar ao vivo
              </Link>
            ) : null}
            <button className="cta" type="button" disabled={busy || !selected.length} onClick={() => project(selected)}>
              {busy && progress == null ? "A preparar…" : "Projetar selecionadas"}
            </button>
          </div>
        </div>

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
                  Projetar
                </button>
                <button className="ghost mini" type="button" onClick={() => removeDeck(deck.id)}>
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!decks.length ? (
          <p className="wait">Ainda não há apresentações nesta conta. Solte um ficheiro acima ou carregue uma URL.</p>
        ) : null}
      </main>
    </div>
  );
}
