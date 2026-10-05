import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import { usePageTitle } from "../lib/pageTitle.js";

export default function JoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  usePageTitle("Código da sessão — PROJET-ABA");

  function formattedToken() {
    const token = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return token.length > 4 ? `${token.slice(0, 4)}-${token.slice(4)}` : token;
  }

  async function openSession(path) {
    const formatted = formattedToken();
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(formatted)}`);
      if (!response.ok) {
        setError("Código inválido ou sessão encerrada.");
        return;
      }
      navigate(`${path}/${formatted}`);
    } catch {
      setError("Não foi possível entrar na sessão.");
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark to="/" />
        <Link className="ghost" to="/">
          Conta
        </Link>
      </header>
      <main id="conteudo" className="join">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            openSession("/sessao");
          }}
        >
          <label htmlFor="token">Código da sessão</label>
          <input
            id="token"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            spellCheck="false"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "token-error" : undefined}
            required
          />
          {error ? (
            <p className="error" id="token-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="cta" type="submit">
            Abrir painel do apresentador
          </button>
          <button className="ghost" type="button" onClick={() => openSession("/projetar")}>
            Abrir tela de projeção
          </button>
          <p className="url-note">O painel controla páginas e arquivos. A projeção é só o slide ao vivo.</p>
        </form>
      </main>
    </div>
  );
}
