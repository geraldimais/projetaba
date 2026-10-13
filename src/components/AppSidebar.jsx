import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

function Icon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    width: "20",
    height: "20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (name === "cast") {
    return (
      <svg {...common}>
        <path d="M4 8V6h16v12h-6" />
        <path d="M4 18a8 8 0 0 1 8-8" />
        <path d="M4 14a4 4 0 0 1 4-4" />
        <circle cx="4" cy="18" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }
  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-3z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M7 10.5V20h10v-9.5" />
    </svg>
  );
}

export default function AppSidebar({ active, user, inboxCount = 0, onLogout }) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);

  const items = useMemo(() => {
    const list = [];
    list.push({
      id: "operador",
      label: "Operador",
      to: "/app",
      icon: "cast",
      badge: inboxCount > 0 ? inboxCount : null,
    });
    if (user) {
      list.push({ id: "email", label: "E-mail", to: "/app/email", icon: "mail" });
    }
    if (user?.role === "admin") {
      list.push({ id: "admin", label: "Administração", to: "/admin", icon: "shield" });
    }
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return list;
    }
    return list.filter((item) => item.label.toLowerCase().includes(needle));
  }, [inboxCount, query, user]);

  function closeMobile() {
    setOpen(false);
  }

  return (
    <>
      <button
        className="side-burger"
        type="button"
        aria-expanded={open}
        aria-controls="menu-app"
        onClick={() => setOpen((value) => !value)}
      >
        Menu
      </button>
      {open ? (
        <button className="side-backdrop" type="button" aria-label="Fechar menu" onClick={closeMobile} />
      ) : null}
      <aside
        id="menu-app"
        className={`app-side${collapsed ? " is-collapsed" : ""}${open ? " is-open" : ""}`}
      >
        <div className="side-head">
          <img src="/brand-mark.png?v=20261012" alt="" width="36" height="36" />
          <span className="side-title">PROJET-ABA</span>
          <button
            className="side-collapse"
            type="button"
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M14 6 8 12l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <label className="side-search">
          <span className="sr-only">Buscar no menu</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar"
            type="search"
          />
        </label>
        <p className="side-kicker">Menu</p>
        <nav aria-label="Menu principal">
          {items.length ? (
            items.map((item) => {
              const className = item.id === active ? "side-link is-active" : "side-link";
              const inner = (
                <>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.badge ? <em className="side-badge">{item.badge}</em> : null}
                </>
              );
              return (
                <NavLink key={item.id} className={className} to={item.to} end onClick={closeMobile}>
                  {inner}
                </NavLink>
              );
            })
          ) : (
            <p className="side-empty">Nada encontrado</p>
          )}
        </nav>
        <div className="side-cards">
          <div className="side-card">
            <strong>Telão no projetor</strong>
            <span>O operador abre o ecrã. O palestrante só controla.</span>
          </div>
        </div>
        {user && onLogout ? (
          <button className="side-logout" type="button" onClick={onLogout}>
            Sair
            <span>{user.name}</span>
          </button>
        ) : null}
      </aside>
    </>
  );
}
