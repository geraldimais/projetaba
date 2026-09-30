import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import { api, savePresenter } from "../lib/api.js";

const ACCEPT = ".pdf,.pptx,.png,.jpg,.jpeg,.webp";

export default function HomePage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [hot, setHot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function addFiles(list) {
    setFiles((current) => [...current, ...Array.from(list || [])].slice(0, 5));
    setError("");
  }

  async function start(event) {
    event.preventDefault();
    if (!files.length || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const session = await api("/api/sessions", { method: "POST", body: JSON.stringify({}) });
      savePresenter(session.token, session.presenterKey);
      const body = new FormData();
      files.forEach((file) => body.append("file", file));
      await api(`/api/sessions/${encodeURIComponent(session.token)}/files`, {
        method: "POST",
        headers: { "X-Presenter-Key": session.presenterKey },
        body,
      });
      navigate(`/sessao/${session.token}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark />
        <Link className="ghost" to="/entrar">
          Entrar com código
        </Link>
      </header>
      <main className="home">
        <form className="home-card" onSubmit={start}>
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
              addFiles(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept={ACCEPT}
              multiple
              aria-label="Área para enviar apresentação. PDF, PPTX, PNG ou JPG."
              onChange={(event) => addFiles(event.target.files)}
            />
            <div>
              <strong>Solte o deck aqui</strong>
              <p>PDF, PPTX, PNG ou JPG</p>
              <span className="ghost" style={{ pointerEvents: "none" }}>
                Escolher ficheiros
              </span>
            </div>
          </div>
          <ul className="file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span>{file.name}</span>
                <button
                  type="button"
                  className="ghost"
                  aria-label={`Remover ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="error">{error}</p> : null}
          <div className="home-actions">
            <button className="cta" type="submit" disabled={!files.length || busy}>
              {busy ? "A preparar sessão…" : "Iniciar projeção"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
