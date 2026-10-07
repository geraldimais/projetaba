import { useState } from "react";
import { Navigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { usePageTitle } from "../lib/pageTitle.js";

export default function HomePage() {
  const { user, ready, setUser } = useAuth();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  usePageTitle("Operador — PROJET-ABA");

  if (!ready) {
    return (
      <div className="shell">
        <header className="topbar">
          <BrandMark />
        </header>
        <main id="conteudo" className="home">
          <p className="wait" role="status">
            A carregar…
          </p>
        </main>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/app" replace />;
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = mode === "register" ? { name, email, password } : { email, password };
      const data = await api(path, { method: "POST", body: JSON.stringify(body) });
      setUser(data.user);
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
      </header>
      <main id="conteudo" className="home home-auth">
        <section className="home-copy">
          <img className="home-logo" src="/brand-logo.png" alt="PROJET-ABA" />
          <h1>Opere o telão. O palestrante só controla.</h1>
          <p>
            Crie a conta do operador, receba o conteúdo, abra o telão no projetor e envie ao palestrante o link dos
            controlos. Não há entrada de participantes.
          </p>
        </section>
        <form className="home-card auth-card" onSubmit={submit} aria-busy={busy}>
          <div className="tabs">
            <button
              type="button"
              aria-pressed={mode === "login"}
              className={mode === "login" ? "tab on" : "tab"}
              onClick={() => setMode("login")}
            >
              Entrar
            </button>
            <button
              type="button"
              aria-pressed={mode === "register"}
              className={mode === "register" ? "tab on" : "tab"}
              onClick={() => setMode("register")}
            >
              Criar conta
            </button>
          </div>
          {mode === "register" ? (
            <label htmlFor="auth-name">
              Nome <span aria-hidden="true">*</span>
              <input
                id="auth-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required={mode === "register"}
                aria-required="true"
              />
            </label>
          ) : null}
          <label htmlFor="auth-email">
            E-mail <span aria-hidden="true">*</span>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </label>
          <label htmlFor="auth-password">
            Senha <span aria-hidden="true">*</span>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={8}
              required
              aria-required="true"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "auth-error" : undefined}
            />
          </label>
          {error ? (
            <p className="error" id="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="cta" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : mode === "register" ? "Criar conta" : "Entrar"}
          </button>
        </form>
      </main>
    </div>
  );
}
