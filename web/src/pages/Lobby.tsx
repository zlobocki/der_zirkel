import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { rememberGame } from "../open-games";
import {
  ApiError,
  cancelGame,
  createGame,
  deleteGame,
  fetchGames,
  joinGame,
  leaveGame,
  type LobbyGame,
} from "../api";
import { useAuth } from "../auth-context";

export function Lobby() {
  const { user, loading } = useAuth();
  const [yours, setYours] = useState<LobbyGame[]>([]);
  const [open, setOpen] = useState<LobbyGame[]>([]);
  const [entered, setEntered] = useState<LobbyGame | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [humanSeats, setHumanSeats] = useState(2);
  const [aiSeats, setAiSeats] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    const body = await fetchGames();
    setYours(body.yours);
    setOpen(body.open);
  }

  useEffect(() => {
    if (!user) {
      return;
    }
    let active = true;
    fetchGames()
      .then((body) => {
        if (active) {
          setYours(body.yours);
          setOpen(body.open);
        }
      })
      .catch((caught) => {
        if (active) {
          setLoadError(caught instanceof ApiError ? caught.message : "Could not load the lobby.");
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
      const result = await createGame({ name, password, humanSeats, aiSeats });
      rememberGame(result.game.id);
      setName("");
      setPassword("");
      setEntered(result.game);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "Could not create the game.");
    } finally {
      setCreating(false);
    }
  }

  async function onCancel(game: LobbyGame) {
    if (!window.confirm(`Cancel ${game.name}? People who joined will need a new game.`)) {
      return;
    }
    setLoadError(null);
    try {
      await cancelGame(game.id);
      setEntered(null);
      await load();
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : "Could not cancel the game.");
    }
  }

  async function onDelete(game: LobbyGame) {
    if (!window.confirm(`Delete ${game.name}? This removes the game for everyone at the table.`)) {
      return;
    }
    setLoadError(null);
    try {
      await deleteGame(game.id);
      setEntered(null);
      await load();
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : "Could not delete the game.");
    }
  }

  async function onLeave(game: LobbyGame) {
    setLoadError(null);
    try {
      await leaveGame(game.id);
      setEntered(null);
      await load();
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : "Could not leave the game.");
    }
  }

  if (loading) {
    return <p>Checking your session.</p>;
  }

  if (!user) {
    return (
      <p>
        <Link to="/login">Log in</Link> to enter the lobby.
      </p>
    );
  }

  return (
    <>
      <h2>Lobby</h2>
      {loadError ? <p className="error">{loadError}</p> : null}
      {entered ? (
        <GameRoom
          game={entered}
          onBack={() => setEntered(null)}
          onCancel={() => void onCancel(entered)}
          onDelete={() => void onDelete(entered)}
          onLeave={() => void onLeave(entered)}
        />
      ) : null}
      <form className="card" onSubmit={onCreate}>
        <h2>Create a game</h2>
        <p className="notice">
          You take the first seat. Further people sit in the order they join, and AI seats are filled now. The game
          starts when every person has joined. The password is required every time someone enters.
        </p>
        <label>
          Name
          <input type="text" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={4}
            required
          />
        </label>
        <label>
          People
          <input
            type="number"
            min={1}
            max={6}
            value={humanSeats}
            onChange={(event) => setHumanSeats(Number(event.target.value))}
            required
          />
        </label>
        <label>
          AI
          <input
            type="number"
            min={0}
            max={5}
            value={aiSeats}
            onChange={(event) => setAiSeats(Number(event.target.value))}
            required
          />
        </label>
        {formError ? <p className="error">{formError}</p> : null}
        <button type="submit" disabled={creating}>
          {creating ? "Creating game" : "Create game"}
        </button>
      </form>
      <section>
        <h2>Your games</h2>
        {yours.length === 0 ? <p className="notice">You have no game to enter.</p> : null}
        <ul className="account-list">
          {yours.map((game) => (
            <GameEntry key={game.id} game={game} action="Enter" onEntered={setEntered} onDelete={() => void onDelete(game)} />
          ))}
        </ul>
      </section>
      <section>
        <h2>Open games</h2>
        {open.length === 0 ? <p className="notice">No game is waiting for players.</p> : null}
        <ul className="account-list">
          {open.map((game) => (
            <GameEntry key={game.id} game={game} action="Join" onEntered={setEntered} />
          ))}
        </ul>
      </section>
    </>
  );
}

function GameRoom({
  game,
  onBack,
  onCancel,
  onDelete,
  onLeave,
}: {
  game: LobbyGame;
  onBack: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onLeave: () => void;
}) {
  const waiting = game.status === "waiting";
  return (
    <section className="card">
      <h2>{game.name}</h2>
      <p className="notice">
        {waiting
          ? `Waiting for players. ${game.seatedHumans} of ${game.humanSeats} people are seated.`
          : "This game has started. The seats stay as they are."}
      </p>
      <ol className="seat-list">
        {game.seats.map((seat) => (
          <li key={seat.seat}>
            {seat.kind === "ai" ? seat.username : (seat.username ?? "Open seat")}
            {seat.you ? " (you)" : ""}
          </li>
        ))}
      </ol>
      <p className="row-actions">
        <button type="button" className="quiet" onClick={onBack}>
          Back to the lobby
        </button>
        {waiting ? null : <Link to={`/play/${game.id}`}>Open the board</Link>}
        {waiting && game.createdByYou ? (
          <button type="button" className="danger" onClick={onCancel}>
            Cancel game
          </button>
        ) : null}
        {game.createdByYou ? (
          <button type="button" className="danger" onClick={onDelete}>
            Delete game
          </button>
        ) : null}
        {waiting && !game.createdByYou && game.yourSeat !== null ? (
          <button type="button" className="quiet" onClick={onLeave}>
            Leave game
          </button>
        ) : null}
      </p>
    </section>
  );
}

function GameEntry({
  game,
  action,
  onEntered,
  onDelete,
}: {
  game: LobbyGame;
  action: "Enter" | "Join";
  onEntered: (game: LobbyGame) => void;
  onDelete?: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await joinGame(game.id, password);
      rememberGame(result.game.id);
      setPassword("");
      onEntered(result.game);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not enter the game.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="card">
      <h2>{game.name}</h2>
      <dl>
        <div>
          <dt>People</dt>
          <dd>
            {game.seatedHumans} of {game.humanSeats}
          </dd>
        </div>
        <div>
          <dt>AI</dt>
          <dd>{game.aiSeats}</dd>
        </div>
        <div>
          <dt>Host</dt>
          <dd>{game.creator ?? "Former player"}</dd>
        </div>
      </dl>
      <form className="inline-form" onSubmit={onSubmit}>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          minLength={4}
          aria-label={`Password for ${game.name}`}
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "Checking password" : action}
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {onDelete ? (
        <p className="row-actions">
          <button type="button" className="danger" onClick={onDelete}>
            Delete game
          </button>
        </p>
      ) : null}
    </li>
  );
}
