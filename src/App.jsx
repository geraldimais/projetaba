import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import SkipLink from "./components/SkipLink.jsx";
import { AuthProvider } from "./lib/auth.jsx";

const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const AppPage = lazy(() => import("./pages/AppPage.jsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.jsx"));
const JoinPage = lazy(() => import("./pages/JoinPage.jsx"));
const PresenterPage = lazy(() => import("./pages/PresenterPage.jsx"));
const ViewerPage = lazy(() => import("./pages/ViewerPage.jsx"));

function RouteFallback() {
  return (
    <p className="wait" role="status">
      A carregar…
    </p>
  );
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
            <Route path="/entrar" element={<JoinPage />} />
            <Route path="/sessao/:token" element={<PresenterPage />} />
            <Route path="/projetar/:token" element={<ViewerPage />} />
            <Route path="/ver/:token" element={<ViewerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </AuthProvider>
  );
}
