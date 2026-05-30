import { Navigate, Route, Routes } from "react-router-dom";
import { auth } from "./lib/api";
import Login from "./pages/Login";
import Grid from "./pages/Grid";

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
      {/* TODO Fase 4: /treinos (criar/treinar/testar modelos) ; Fase 5: /events */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
