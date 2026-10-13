import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AppSidebar from "../components/AppSidebar.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "../lib/auth.jsx";
import { usePageTitle } from "../lib/pageTitle.js";

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes} min`;
}

function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }
  return date.toLocaleDateString("pt-BR");
}

export default function AdminPage() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [mail, setMail] = useState(null);
  const [mailForm, setMailForm] = useState(null);
  const [mailBusy, setMailBusy] = useState("");
  const [mailNote, setMailNote] = useState("");
  const [error, setError] = useState("");
  usePageTitle("Administração — PROJET-ABA");

  useEffect(() => {
    if (!user || user.role !== "admin") {
      return;
    }
    const controller = new AbortController();
    Promise.all([
      api("/api/admin/metrics", { signal: controller.signal }),
      api("/api/admin/mail", { signal: controller.signal }),
    ])
      .then(([metrics, mailbox]) => {
        setData(metrics);
        setMail(mailbox.settings);
        setMailForm({
          ...mailbox.settings,
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
  if (ready && user?.role !== "admin") {
    return <Navigate to="/app" replace />;
  }

  const maxSessions = Math.max(1, ...(data?.daily || []).map((row) => Number(row.sessions) || 0));

  function setField(name, value) {
    setMailForm((current) => ({ ...current, [name]: value }));
  }

  async function saveMail(event) {
    event.preventDefault();
    setMailBusy("save");
    setMailNote("");
    setError("");
    try {
      const result = await api("/api/admin/mail", {
        method: "PUT",
        body: JSON.stringify({
          ...mailForm,
          imapPort: Number(mailForm.imapPort),
          smtpPort: Number(mailForm.smtpPort),
          pollSeconds: Number(mailForm.pollSeconds),
        }),
      });
      setMail(result.settings);
      setMailForm({ ...result.settings, password: "" });
      setMailNote("Configuração da caixa de e-mail guardada.");
    } catch (err) {
      setError(err.message);
    } finally {
      setMailBusy("");
    }
  }

  async function testMail() {
    setMailBusy("test");
    setMailNote("");
    setError("");
    try {
      const result = await api("/api/admin/mail/test", { method: "POST" });
      setMailNote(
        result.smtpError
          ? `IMAP ok em ${result.inbox}. SMTP: ${result.smtpError}`
          : `Ligação ok. A caixa ${result.inbox} responde em IMAP e SMTP.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setMailBusy("");
    }
  }

  async function syncMail() {
    setMailBusy("sync");
    setMailNote("");
    setError("");
    try {
      const result = await api("/api/admin/mail/sync", { method: "POST" });
      setMailNote(`${result.imported || 0} ficheiro(s) novo(s) na caixa de entrada.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setMailBusy("");
    }
  }

  return (
    <div className="app-frame">
      <AppSidebar active="admin" user={user} onLogout={() => logout().then(() => navigate("/"))} />
      <div className="shell app-main">
      <main id="conteudo" className="dash">
        <p className="eyebrow">Admin master</p>
        <h1>Administração</h1>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {mailForm ? (
          <section className="mail-card" aria-labelledby="mail-title">
            <h2 id="mail-title">Caixa de e-mail (SMTP / IMAP)</h2>
            <p className="lede">
              Crie a conta de recepção e indique aqui o SMTP e o IMAP. Os anexos PDF, PPTX, imagem ou vídeo
              aparecem no painel do operador para adicionar à apresentação.
            </p>
            <form className="mail-form" onSubmit={saveMail}>
              <label htmlFor="mail-email">
                E-mail da caixa
                <input
                  id="mail-email"
                  type="email"
                  value={mailForm.email}
                  autoComplete="username"
                  onChange={(event) => setField("email", event.target.value)}
                  required
                />
              </label>
              <label htmlFor="mail-password">
                Senha {mail?.hasPassword ? "(deixe vazio para manter)" : ""}
                <input
                  id="mail-password"
                  type="password"
                  value={mailForm.password}
                  autoComplete="new-password"
                  onChange={(event) => setField("password", event.target.value)}
                  required={!mail?.hasPassword}
                />
              </label>
              <div className="mail-grid">
                <label htmlFor="mail-smtp-host">
                  Servidor SMTP
                  <input
                    id="mail-smtp-host"
                    value={mailForm.smtpHost}
                    onChange={(event) => setField("smtpHost", event.target.value)}
                  />
                </label>
                <label htmlFor="mail-smtp-port">
                  Porta SMTP
                  <input
                    id="mail-smtp-port"
                    type="number"
                    value={mailForm.smtpPort}
                    onChange={(event) => setField("smtpPort", event.target.value)}
                  />
                </label>
                <label htmlFor="mail-imap-host">
                  Servidor IMAP (recepção)
                  <input
                    id="mail-imap-host"
                    value={mailForm.imapHost}
                    onChange={(event) => setField("imapHost", event.target.value)}
                  />
                </label>
                <label htmlFor="mail-imap-port">
                  Porta IMAP
                  <input
                    id="mail-imap-port"
                    type="number"
                    value={mailForm.imapPort}
                    onChange={(event) => setField("imapPort", event.target.value)}
                  />
                </label>
              </div>
              <label className="mail-check">
                <input
                  type="checkbox"
                  checked={mailForm.smtpSecure}
                  onChange={(event) => setField("smtpSecure", event.target.checked)}
                />
                SMTP seguro (SSL/TLS)
              </label>
              <label className="mail-check">
                <input
                  type="checkbox"
                  checked={mailForm.imapSecure}
                  onChange={(event) => setField("imapSecure", event.target.checked)}
                />
                IMAP seguro (SSL/TLS)
              </label>
              <label className="mail-check">
                <input
                  type="checkbox"
                  checked={mailForm.enabled}
                  onChange={(event) => setField("enabled", event.target.checked)}
                />
                Ler a caixa automaticamente
              </label>
              <div className="mail-actions">
                <button className="cta" type="submit" disabled={Boolean(mailBusy)}>
                  {mailBusy === "save" ? "A guardar…" : "Guardar SMTP"}
                </button>
                <button className="ghost" type="button" disabled={Boolean(mailBusy)} onClick={testMail}>
                  {mailBusy === "test" ? "A testar…" : "Testar ligação"}
                </button>
                <button className="ghost" type="button" disabled={Boolean(mailBusy)} onClick={syncMail}>
                  {mailBusy === "sync" ? "A ler…" : "Ler agora"}
                </button>
              </div>
              {mailNote ? (
                <p className="copy-status" role="status">
                  {mailNote}
                </p>
              ) : null}
              {mail?.lastError ? (
                <p className="error" role="alert">
                  Último erro: {mail.lastError}
                </p>
              ) : null}
              {mail?.lastSyncAt ? (
                <p className="url-note">Última leitura: {formatDay(mail.lastSyncAt)}</p>
              ) : null}
            </form>
          </section>
        ) : null}
        <h2>Métricas de projeção</h2>
        {data ? (
          <>
            <section className="stat-grid">
              <article className="stat">
                <p>Contas</p>
                <strong>{data.users}</strong>
              </article>
              <article className="stat">
                <p>Conteúdos</p>
                <strong>{data.presentations}</strong>
              </article>
              <article className="stat">
                <p>Sessões</p>
                <strong>{data.sessions}</strong>
              </article>
              <article className="stat">
                <p>Ao vivo agora</p>
                <strong>{data.live}</strong>
              </article>
              <article className="stat">
                <p>Horas projetadas</p>
                <strong>{data.hours}</strong>
              </article>
              <article className="stat">
                <p>Pico no telão</p>
                <strong>{data.peakViewers}</strong>
              </article>
              <article className="stat">
                <p>Ligações ao telão</p>
                <strong>{data.viewerJoins}</strong>
              </article>
              <article className="stat">
                <p>Trocas de slide</p>
                <strong>{data.slideChanges}</strong>
              </article>
            </section>

            <section className="chart-card">
              <h2>Sessões nos últimos 14 dias</h2>
              <ul className="sr-only">
                {(data.daily || []).map((row) => (
                  <li key={`text-${row.day}`}>
                    {formatDay(row.day)}: {row.sessions} sessões
                  </li>
                ))}
              </ul>
              <div className="bars" aria-hidden="true">
                {(data.daily || []).map((row) => (
                  <div key={row.day} className="bar">
                    <span style={{ height: `${(Number(row.sessions) / maxSessions) * 100}%` }} />
                    <small>{String(row.day).slice(5)}</small>
                  </div>
                ))}
              </div>
              {!(data.daily || []).length ? <p className="wait">Ainda sem histórico diário.</p> : null}
            </section>

            <section className="table-wrap">
              <h2>Sessões recentes</h2>
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Conta</th>
                    <th>Código</th>
                    <th>Duração</th>
                    <th>Pico</th>
                    <th>Slides</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent || []).map((row) => (
                    <tr key={row.token}>
                      <td>{formatDay(row.started_at)}</td>
                      <td>
                        {row.name}
                        <br />
                        <small>{row.email}</small>
                      </td>
                      <td className="mono">{row.token}</td>
                      <td>{formatDuration(row.duration_seconds)}</td>
                      <td>{row.viewer_peak}</td>
                      <td>{row.slide_changes}</td>
                      <td>{row.status === "live" ? "Ao vivo" : "Encerrada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : (
          <p className="wait">A carregar métricas…</p>
        )}
      </main>
      </div>
    </div>
  );
}
