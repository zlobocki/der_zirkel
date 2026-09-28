import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, deleteAccount, logoutAccount } from "../api";
import { useAuth } from "../auth-context";

export function Account() {
  const { user, loading, setUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setError(null);
    try {
      await logoutAccount();
      setUser(null);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not log out.");
    }
  }

  async function onDelete(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm("Delete this account? This removes your username and email.")) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      await deleteAccount(password);
      setUser(null);
      navigate("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not delete the account.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <p>Checking your session.</p>;
  }

  if (!user) {
    return (
      <p>
        <Link to="/login">Log in</Link> to manage your account.
      </p>
    );
  }

  return (
    <>
      <section className="card">
        <h2>{user.username}</h2>
        <dl>
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.isAdmin ? "Administrator" : "Player"}</dd>
          </div>
        </dl>
        <p className="actions">
          {user.isAdmin ? <Link to="/admin">Accounts</Link> : null}
          <button type="button" onClick={() => void onLogout()}>
            Log out
          </button>
        </p>
      </section>
      <form className="card" onSubmit={onDelete}>
        <h2>Delete account</h2>
        <p className="notice">
          This removes your username and email. Deletion is refused while you are in a game that has not finished.
        </p>
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
        <button type="submit" className="danger" disabled={pending}>
          {pending ? "Deleting account" : "Delete account"}
        </button>
      </form>
    </>
  );
}
