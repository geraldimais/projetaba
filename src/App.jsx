import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import SkipLink from "./components/SkipLink.jsx";
import { AuthProvider } from "./lib/auth.jsx";

const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const AppPage = lazy(() => import("./pages/AppPage.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const PalestrantePage = lazy(() => import("./pages/PalestrantePage.jsx"));
const TelaoPage = lazy(() => import("./pages/TelaoPage.jsx"));

function RouteFallback() {
  return (
    <p className="wait" role="status">
      A carregar…
    </p>
  );
}

function RedirectSessao() {
  const { token } = useParams();
  return <Navigate to={`/palestrante/${token}`} replace />;
}

function RedirectProjetar() {
  const { token } = useParams();
  return <Navigate to={`/telao/${token}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <SkipLink />
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/app" element={<AppPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/palestrante/:token" element={<PalestrantePage />} />
            <Route path="/telao/:token" element={<TelaoPage />} />
            <Route path="/entrar" element={<Navigate to="/" replace />} />
            <Route path="/sessao/:token" element={<RedirectSessao />} />
            <Route path="/projetar/:token" element={<RedirectProjetar />} />
            <Route path="/ver/:token" element={<RedirectProjetar />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  );
}
