import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, loginAccount } from "../api";
import { useAuth } from "../auth-context";

export function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await loginAccount({ email, password });
      setUser(result.user);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not log in.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2>Log in</h2>
      <form className="card" onSubmit={onSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Logging in" : "Log in"}
        </button>
        <p>
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </form>
    </>
  );
}
