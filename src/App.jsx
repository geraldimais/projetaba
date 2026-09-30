import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage.jsx";
import JoinPage from "./pages/JoinPage.jsx";
import PresenterPage from "./pages/PresenterPage.jsx";
import ViewerPage from "./pages/ViewerPage.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/entrar" element={<JoinPage />} />
      <Route path="/sessao/:token" element={<PresenterPage />} />
      <Route path="/ver/:token" element={<ViewerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
