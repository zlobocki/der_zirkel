import { useEffect, useState } from "react";

type Health = {
  ok: boolean;
  service: string;
  database: "up" | "down";
};

type HealthState =
  | { status: "loading" }
  | { status: "ready"; health: Health }
  | { status: "error"; message: string };

export function App() {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        const health = (await response.json()) as Health;
        setState({ status: "ready", health });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Request failed";
        setState({ status: "error", message });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">Imperial, 2010 edition</p>
      <h1>Der Zirkel</h1>
      <p className="lede">
        The table is not open yet. This page checks that the server and database are connected.
      </p>
      <HealthCard state={state} />
    </main>
  );
}

function HealthCard({ state }: { state: HealthState }) {
  if (state.status === "loading") {
    return (
      <section className="card" aria-live="polite">
        <h2>Checking the service</h2>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="card" aria-live="polite">
        <h2>Service unreachable</h2>
        <p>{state.message}</p>
      </section>
    );
  }

  const databaseUp = state.health.database === "up";
  return (
    <section className="card" aria-live="polite">
      <h2>{databaseUp ? "Service ready" : "Database not connected"}</h2>
      <dl>
        <div>
          <dt>Server</dt>
          <dd>Running</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>{databaseUp ? "Connected" : "Not connected"}</dd>
        </div>
      </dl>
    </section>
  );
}
