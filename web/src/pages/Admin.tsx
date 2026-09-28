import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  PRIVACY_NOTICE,
  createManagedAccount,
  deleteManagedAccount,
  fetchAccounts,
  resetAccountPassword,
  setAccountDisabled,
  type ManagedAccount,
} from "../api";
import { useAuth } from "../auth-context";

export function Admin() {
  const { user, loading } = useAuth();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gdprAccepted, setGdprAccepted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nextPassword, setNextPassword] = useState<Record<string, string>>({});

  async function load() {
    const body = await fetchAccounts();
    setAccounts(body.users);
  }

  useEffect(() => {
    if (!user?.isAdmin) {
      return;
    }
    let active = true;
    fetchAccounts()
      .then((body) => {
        if (active) {
          setAccounts(body.users);
        }
      })
      .catch((caught) => {
        if (active) {
          setLoadError(caught instanceof ApiError ? caught.message : "Could not load accounts.");
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      await createManagedAccount({ username, email, password, gdprAccepted });
      setUsername("");
      setEmail("");
      setPassword("");
      setGdprAccepted(false);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "Could not create the account.");
    } finally {
      setCreating(false);
    }
  }

  async function onDisable(account: ManagedAccount) {
    setRowError(null);
    setBusyId(account.id);
    try {
      const result = await setAccountDisabled(account.id, !account.disabled);
      setAccounts((current) => current.map((item) => (item.id === result.user.id ? result.user : item)));
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : "Could not update that account.");
    } finally {
      setBusyId(null);
    }
  }

  async function onPassword(event: FormEvent, account: ManagedAccount) {
    event.preventDefault();
    const passwordValue = nextPassword[account.id] ?? "";
    setRowError(null);
    setBusyId(account.id);
    try {
      await resetAccountPassword(account.id, passwordValue);
      setNextPassword((current) => ({ ...current, [account.id]: "" }));
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : "Could not set that password.");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(account: ManagedAccount) {
    if (!window.confirm(`Delete ${account.username}? This removes their username and email.`)) {
      return;
    }
    setRowError(null);
    setBusyId(account.id);
    try {
      await deleteManagedAccount(account.id);
      setAccounts((current) => current.filter((item) => item.id !== account.id));
    } catch (caught) {
      setRowError(caught instanceof ApiError ? caught.message : "Could not delete that account.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p>Checking your session.</p>;
  }

  if (!user) {
    return (
      <p>
        <Link to="/login">Log in</Link> to open the administrator page.
      </p>
    );
  }

  if (!user.isAdmin) {
    return <p>This page is for administrators.</p>;
  }

  return (
    <>
      <h2>Accounts</h2>
      {loadError ? <p className="error">{loadError}</p> : null}
      {rowError ? <p className="error">{rowError}</p> : null}
      <ul className="account-list">
        {accounts.map((account) => {
          const self = account.id === user.id;
          const busy = busyId === account.id;
          return (
            <li key={account.id} className="card">
              <h2>
                {account.username}
                {self ? " (you)" : ""}
              </h2>
              <dl>
                <div>
                  <dt>Email</dt>
                  <dd>{account.email}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{account.isAdmin ? "Administrator" : "Player"}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{account.disabled ? "Disabled" : "Active"}</dd>
                </div>
              </dl>
              <form className="inline-form" onSubmit={(event) => void onPassword(event, account)}>
                <input
                  type="password"
                  value={nextPassword[account.id] ?? ""}
                  onChange={(event) =>
                    setNextPassword((current) => ({ ...current, [account.id]: event.target.value }))
                  }
                  autoComplete="new-password"
                  minLength={8}
                  aria-label={`New password for ${account.username}`}
                  required
                />
                <button type="submit" disabled={busy}>
                  Set password
                </button>
              </form>
              {self ? null : (
                <p className="row-actions">
                  <button type="button" className="quiet" disabled={busy} onClick={() => void onDisable(account)}>
                    {account.disabled ? "Enable" : "Disable"}
                  </button>
                  <button type="button" className="danger" disabled={busy} onClick={() => void onDelete(account)}>
                    Delete
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <form className="card" onSubmit={onCreate}>
        <h2>Create account</h2>
        <p className="notice">New accounts are players. {PRIVACY_NOTICE}</p>
        <label>
          Username
          <input type="text" value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
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
        <label className="checkbox">
          <input
            type="checkbox"
            checked={gdprAccepted}
            onChange={(event) => setGdprAccepted(event.target.checked)}
            required
          />
          <span>I understand and agree on behalf of this account.</span>
        </label>
        {formError ? <p className="error">{formError}</p> : null}
        <button type="submit" disabled={creating}>
          {creating ? "Creating account" : "Create account"}
        </button>
      </form>
    </>
  );
}
