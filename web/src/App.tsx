import { Link, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth-context";
import { Account } from "./pages/Account";
import { Admin } from "./pages/Admin";
import { Home } from "./pages/Home";
import { Lobby } from "./pages/Lobby";
import { Login } from "./pages/Login";
import { Play } from "./pages/Play";
import { Register } from "./pages/Register";

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const location = useLocation();
  return (
    <main className={location.pathname.startsWith("/play/") ? "board-page" : undefined}>
      <h1>
        <Link to="/">Der Zirkel</Link>
      </h1>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/account" element={<Account />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/play/:gameId" element={<Play />} />
      </Routes>
    </main>
  );
}
