import { Navigate, Route, Routes } from "react-router-dom";
import { auth } from "./lib/api";
import Login from "./pages/Login";
import Grid from "./pages/Grid";
import Training from "./pages/Training";
import Events from "./pages/Events";
import Notifications from "./pages/Notifications";
import Health from "./pages/Health";
import Summary from "./pages/Summary";
import Vigilante from "./pages/Vigilante";
import Family from "./pages/Family";
import Overview from "./pages/Overview";
import { SystemStatus } from "./components/SystemStatus";
import { AccessShare } from "./components/AccessShare";

function Protected({ children }: { children: React.ReactNode }) {
  return auth.isLoggedIn ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <>
      {auth.isLoggedIn && (
        <div className="topbar">
          <SystemStatus />
          <AccessShare />
        </div>
      )}
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Overview />
          </Protected>
        }
      />
      <Route
        path="/cameras"
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
      <Route
        path="/saude"
        element={
          <Protected>
            <Health />
          </Protected>
        }
      />
      <Route
        path="/resumo"
        element={
          <Protected>
            <Summary />
          </Protected>
        }
      />
      <Route
        path="/vigilante"
        element={
          <Protected>
            <Vigilante />
          </Protected>
        }
      />
      <Route
        path="/familia"
        element={
          <Protected>
            <Family />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
