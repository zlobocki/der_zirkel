import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, PRIVACY_NOTICE, registerAccount } from "../api";
import { useAuth } from "../auth-context";

export function Register() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gdprAccepted, setGdprAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await registerAccount({ username, email, password, gdprAccepted });
      setUser(result.user);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not create the account.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2>Create account</h2>
      <form className="card" onSubmit={onSubmit}>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <p className="notice">{PRIVACY_NOTICE}</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={gdprAccepted}
            onChange={(event) => setGdprAccepted(event.target.checked)}
            required
          />
          <span>I understand and agree.</span>
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Creating account" : "Create account"}
        </button>
        <p>
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </>
  );
}
