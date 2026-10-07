import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import BrandMark from "../components/BrandMark.jsx";
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
  const [error, setError] = useState("");
  usePageTitle("Métricas — PROJET-ABA");

  useEffect(() => {
    if (!user || user.role !== "admin") {
      return;
    }
    const controller = new AbortController();
    api("/api/admin/metrics", { signal: controller.signal })
      .then(setData)
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

  return (
    <div className="shell">
      <header className="topbar">
        <BrandMark to="/app" />
        <div className="topbar-actions">
          <Link className="ghost" to="/app">
            Operador
          </Link>
          <button className="ghost" type="button" onClick={() => logout().then(() => navigate("/"))}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="dash">
        <p className="eyebrow">Admin master</p>
        <h1>Métricas de projeção</h1>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
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
  );
}
