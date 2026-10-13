import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AppSidebar from "../components/AppSidebar.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { usePageTitle } from "../lib/pageTitle.js";

const EMPTY = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "",
  from: "",
  password: "",
};

export default function MailSettingsPage() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [fromEnv, setFromEnv] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  usePageTitle("E-mail — PROJET-ABA");

  useEffect(() => {
    if (!user) {
      return;
    }
    const controller = new AbortController();
    api("/api/account/smtp", { signal: controller.signal })
      .then((data) => {
        const settings = data.settings || {};
        setHasPassword(Boolean(settings.hasPassword));
        setFromEnv(Boolean(settings.fromEnv));
        setForm({
          host: settings.host || EMPTY.host,
          port: settings.port || EMPTY.port,
          secure: Boolean(settings.secure),
          user: settings.user || "",
          from: settings.from || "",
          password: "",
        });
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

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function payload() {
    return {
      host: form.host,
      port: Number(form.port),
      secure: form.secure,
      user: form.user,
      from: form.from || form.user,
      password: form.password,
    };
  }

  async function save(event) {
    event.preventDefault();
    setBusy("save");
    setNote("");
    setError("");
    try {
      const result = await api("/api/account/smtp", {
        method: "PUT",
        body: JSON.stringify(payload()),
      });
      const settings = result.settings || {};
      setHasPassword(Boolean(settings.hasPassword));
      setFromEnv(Boolean(settings.fromEnv));
      setForm({
        host: settings.host,
        port: settings.port,
        secure: Boolean(settings.secure),
        user: settings.user,
        from: settings.from,
        password: "",
      });
      setNote("Configuração de envio guardada. A ligação SMTP foi confirmada.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function testConnection() {
    setBusy("test");
    setNote("");
    setError("");
    try {
      const result = await api("/api/account/smtp/test", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      setNote(`Ligação SMTP ok para ${result.inbox}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="app-frame">
      <AppSidebar
        active="email"
        user={user}
        onLogout={() => logout().then(() => navigate("/"))}
      />
      <div className="shell app-main">
        <main id="conteudo" className="dash">
          <p className="eyebrow">Conta autenticada</p>
          <h1>E-mail de envio</h1>
          <p className="lede">
            Esta conta envia o link de “esqueci a senha”. No Gmail, use uma senha de aplicativo, não a senha da caixa.
          </p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          {form ? (
            <section className="mail-card" aria-labelledby="smtp-title">
              <h2 id="smtp-title">SMTP</h2>
              {fromEnv ? (
                <p className="url-note">O servidor já define este SMTP. Os campos abaixo só mostram a conta em uso.</p>
              ) : null}
              <form className="mail-form" onSubmit={save}>
                <label htmlFor="smtp-user">
                  E-mail
                  <input
                    id="smtp-user"
                    type="email"
                    value={form.user}
                    autoComplete="username"
                    required
                    disabled={fromEnv}
                    onChange={(event) => setField("user", event.target.value)}
                  />
                </label>
                <label htmlFor="smtp-password">
                  Senha de aplicativo {hasPassword ? "(deixe vazio para manter)" : ""}
                  <input
                    id="smtp-password"
                    type="password"
                    value={form.password}
                    autoComplete="new-password"
                    required={!hasPassword && !fromEnv}
                    disabled={fromEnv}
                    onChange={(event) => setField("password", event.target.value)}
                  />
                </label>
                <p className="url-note">Espaços na senha de aplicativo são ignorados.</p>
                <div className="mail-grid">
                  <label htmlFor="smtp-host">
                    Servidor SMTP
                    <input
                      id="smtp-host"
                      value={form.host}
                      required
                      disabled={fromEnv}
                      onChange={(event) => setField("host", event.target.value)}
                    />
                  </label>
                  <label htmlFor="smtp-port">
                    Porta
                    <input
                      id="smtp-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={form.port}
                      required
                      disabled={fromEnv}
                      onChange={(event) => setField("port", event.target.value)}
                    />
                  </label>
                </div>
                <label htmlFor="smtp-from">
                  Remetente
                  <input
                    id="smtp-from"
                    type="email"
                    value={form.from}
                    placeholder={form.user || "o mesmo e-mail"}
                    disabled={fromEnv}
                    onChange={(event) => setField("from", event.target.value)}
                  />
                </label>
                <label className="mail-check">
                  <input
                    type="checkbox"
                    checked={form.secure}
                    disabled={fromEnv}
                    onChange={(event) => setField("secure", event.target.checked)}
                  />
                  SSL na porta 465. No Gmail com porta 587, deixe desmarcado.
                </label>
                <div className="mail-actions">
                  <button className="cta" type="submit" disabled={Boolean(busy) || fromEnv}>
                    {busy === "save" ? "A guardar…" : "Guardar"}
                  </button>
                  <button className="ghost" type="button" disabled={Boolean(busy)} onClick={testConnection}>
                    {busy === "test" ? "A testar…" : "Testar ligação"}
                  </button>
                </div>
                {note ? (
                  <p className="copy-status" role="status">
                    {note}
                  </p>
                ) : null}
              </form>
            </section>
          ) : (
            <p className="wait">A carregar…</p>
          )}
        </main>
      </div>
    </div>
  );
}
