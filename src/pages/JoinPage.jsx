import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";

export default function JoinPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const token = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const formatted = token.length > 4 ? `${token.slice(0, 4)}-${token.slice(4)}` : token;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(formatted)}`);
      if (!response.ok) {
        setError("Código inválido ou sessão encerrada.");
        return;
      }
      navigate(`/ver/${formatted}`);
    } catch {
      setError("Não foi possível entrar na sessão.");
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark />
      </header>
      <main className="join">
        <form onSubmit={submit}>
          <label htmlFor="token">Código da sessão</label>
          <input
            id="token"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            spellCheck="false"
            required
          />
          {error ? <p className="error" id="token-error">{error}</p> : null}
          <button className="cta" type="submit">
            Entrar na projeção
          </button>
          <p>Não tem código? Peça o QR ao apresentador.</p>
        </form>
      </main>
    </div>
  );
}
