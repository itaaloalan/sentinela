import { Navigate, Route, Routes } from "react-router-dom";
import { auth } from "./lib/api";
import Login from "./pages/Login";
import Grid from "./pages/Grid";
import Training from "./pages/Training";
import Events from "./pages/Events";
import Notifications from "./pages/Notifications";

function Protected({ children }: { children: React.ReactNode }) {
  return auth.isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Grid />
          </Protected>
        }
      />
      <Route
        path="/treinos"
        element={
          <Protected>
            <Training />
          </Protected>
        }
      />
      <Route
        path="/eventos"
        element={
          <Protected>
            <Events />
          </Protected>
        }
      />
      <Route
        path="/notificacoes"
        element={
          <Protected>
            <Notifications />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
