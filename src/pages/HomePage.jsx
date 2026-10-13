import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { usePageTitle } from "../lib/pageTitle.js";

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 19.2c1.4-3 3.6-4.4 6.5-4.4s5.1 1.4 6.5 4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="6" y="10.5" width="12" height="8.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 10.5V8.2a3.5 3.5 0 0 1 7 0v2.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M3 12s3.2-5.5 9-5.5S21 12 21 12s-3.2 5.5-9 5.5S3 12 3 12z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {off ? <path d="M5 19 19 5" fill="none" stroke="currentColor" strokeWidth="1.6" /> : null}
    </svg>
  );
}

const HELLO = {
  login: {
    title: "OLÁ!",
    text: "Informe seus dados e comece por aqui.",
    action: "Criar conta",
    next: "register",
  },
  register: {
    title: "BEM-VINDO!",
    text: "Entre com a conta que já abre o painel e o telão.",
    action: "Entrar",
    next: "login",
  },
  forgot: {
    title: "ESQUECEU?",
    text: "Se a conta existir, o link chega no e-mail e vale 30 minutos.",
    action: "Entrar",
    next: "login",
  },
  reset: {
    title: "NOVA SENHA",
    text: "Escolha uma senha com pelo menos 8 caracteres.",
    action: "Entrar",
    next: "login",
  },
};

export default function HomePage() {
  const { user, ready, setUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const resetToken = params.get("redefinir") || "";
  const [mode, setMode] = useState(resetToken ? "reset" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  usePageTitle("Operador — PROJET-ABA");

  if (!ready) {
    return (
      <main id="conteudo" className="gate">
        <p className="wait" role="status">
          A carregar…
        </p>
      </main>
    );
  }

  if (user) {
    return <Navigate to="/app" replace />;
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setNotice("");
    setShowPassword(false);
    if (next !== "reset") {
      setParams({}, { replace: true });
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if ((mode === "register" || mode === "reset") && password !== confirm) {
      setError("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "forgot") {
        const data = await api("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
        setNotice(data.message || "Se existir uma conta com esse e-mail, enviaremos o link de redefinição.");
        return;
      }
      if (mode === "reset") {
        await api("/api/auth/reset", { method: "POST", body: JSON.stringify({ token: resetToken, password }) });
        setPassword("");
        setConfirm("");
        switchMode("login");
        setNotice("Senha atualizada. Entre com a nova senha.");
        return;
      }
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

  const hello = HELLO[mode] || HELLO.login;
  const heading = mode === "forgot" ? "Esqueci a senha" : mode === "reset" ? "Nova senha" : mode === "register" ? "Criar conta" : "Entrar";
  const passwordType = showPassword ? "text" : "password";

  return (
    <main id="conteudo" className="gate">
      <div className="gate-facets" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="gate-stack">
        <p className="gate-brand">
          <img src="/brand-mark.png?v=20261012" alt="" width="36" height="36" />
          <span>PROJET-ABA</span>
        </p>
        <section className="gate-card">
          <form className="gate-form" onSubmit={submit} aria-busy={busy}>
            <h1>{heading}</h1>
            {mode === "register" ? (
              <label className="gate-field">
                <span className="sr-only">Nome completo</span>
                <UserIcon />
                <input
                  id="auth-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="Nome completo"
                  required
                  aria-required="true"
                />
              </label>
            ) : null}
            {mode === "forgot" || mode === "login" || mode === "register" ? (
              <label className="gate-field">
                <span className="sr-only">E-mail</span>
                <UserIcon />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="E-mail"
                  required
                  aria-required="true"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "auth-error" : undefined}
                />
              </label>
            ) : null}
            {mode === "login" || mode === "register" || mode === "reset" ? (
              <label className="gate-field">
                <span className="sr-only">Senha</span>
                <LockIcon />
                <input
                  id="auth-password"
                  type={passwordType}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="Senha"
                  minLength={8}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "auth-error" : undefined}
                />
                <button
                  className="gate-eye"
                  type="button"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </label>
            ) : null}
            {mode === "register" || mode === "reset" ? (
              <label className="gate-field">
                <span className="sr-only">Confirmar senha</span>
                <LockIcon />
                <input
                  id="auth-confirm"
                  type={passwordType}
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Confirmar senha"
                  minLength={8}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "auth-error" : undefined}
                />
              </label>
            ) : null}
            {notice ? (
              <p className="copy-status" role="status">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="error" id="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <button className="cta gate-submit" type="submit" disabled={busy || (mode === "reset" && !resetToken)}>
              {busy ? "Aguarde…" : mode === "forgot" ? "Enviar link" : mode === "reset" ? "Salvar senha" : heading}
            </button>
            {mode === "login" ? (
              <>
                <p className="gate-links">
                  Não tem conta?{" "}
                  <button type="button" onClick={() => switchMode("register")}>
                    Criar conta
                  </button>
                </p>
                <p className="gate-links">
                  <button type="button" onClick={() => switchMode("forgot")}>
                    Esqueci a senha
                  </button>
                </p>
              </>
            ) : (
              <p className="gate-links">
                <button type="button" onClick={() => switchMode("login")}>
                  {mode === "register" ? "Já tem conta? Entrar" : "Voltar ao entrar"}
                </button>
              </p>
            )}
          </form>
          <aside className="gate-hello">
            <h2>{hello.title}</h2>
            <p>{hello.text}</p>
            <button className="cta" type="button" onClick={() => switchMode(hello.next)}>
              {hello.action} →
            </button>
          </aside>
        </section>
      </div>
    </main>
  );
}
