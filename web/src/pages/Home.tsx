import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth-context";

type Health = {
  ok: boolean;
  database: "up" | "down";
};

export function Home() {
  const { user, loading } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => (await response.json()) as Health)
      .then(setHealth)
      .catch(() => {
        if (!controller.signal.aborted) {
          setHealth({ ok: false, database: "down" });
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <p className="lede">
        Create an account to play. The lobby is not open yet.
      </p>
      <section className="card">
        <h2>{loading ? "Checking your session" : user ? `Signed in as ${user.username}` : "Not signed in"}</h2>
        {user ? (
          <p className="actions">
            <Link to="/account">Account settings</Link>
            {user.isAdmin ? <Link to="/admin">Accounts</Link> : null}
          </p>
        ) : (
          <p className="actions">
            <Link to="/register">Create account</Link>
            <Link to="/login">Log in</Link>
          </p>
        )}
      </section>
      <section className="card">
        <h2>{health?.database === "up" ? "Service ready" : "Checking the service"}</h2>
        <dl>
          <div>
            <dt>Server</dt>
            <dd>Running</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>{health?.database === "up" ? "Connected" : health ? "Not connected" : "Checking"}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
