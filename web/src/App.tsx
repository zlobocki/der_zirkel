import { Link, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth-context";
import { Account } from "./pages/Account";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";

export function App() {
  return (
    <AuthProvider>
      <main>
        <p className="eyebrow">Imperial, 2010 edition</p>
        <h1>
          <Link to="/">Der Zirkel</Link>
        </h1>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/register" element={<Register />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account" element={<Account />} />
        </Routes>
      </main>
    </AuthProvider>
  );
}
