import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchGame, joinGame, type SeatedGame } from "../api";
import { Board, PlayerPanel } from "../board/Board";
import { useAuth } from "../auth-context";
import { gameRemembered, rememberGame } from "../open-games";

export function Play() {
  const { gameId = "" } = useParams();
  const { user, loading } = useAuth();
  const [game, setGame] = useState<SeatedGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [unlocked, setUnlocked] = useState(() => gameRemembered(gameId));

  useEffect(() => {
    if (!user || !unlocked || !gameId) {
      return;
    }
    let active = true;
    fetchGame(gameId)
      .then((body) => {
        if (active) {
          setGame(body.game);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof ApiError ? caught.message : "Could not open this game.");
        }
      });
    return () => {
      active = false;
    };
  }, [user, unlocked, gameId]);

  async function onUnlock(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await joinGame(gameId, password);
      rememberGame(gameId);
      setUnlocked(true);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not enter this game.");
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
        <Link to="/login">Log in</Link> to open this game.
      </p>
    );
  }

  if (!unlocked) {
    return (
      <form className="card" onSubmit={onUnlock}>
        <h2>Enter the game</h2>
        <p className="notice">The password is required each time you come back to a game.</p>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            minLength={4}
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Checking password" : "Enter"}
        </button>
      </form>
    );
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!game) {
    return <p>Opening the game.</p>;
  }

  if (!game.board) {
    return (
      <section className="card">
        <h2>{game.name}</h2>
        <p className="notice">The board opens when every person has joined.</p>
        <p>
          <Link to="/lobby">Back to the lobby</Link>
        </p>
      </section>
    );
  }

  return (
    <>
      <p className="actions">
        <Link to="/lobby">Lobby</Link>
      </p>
      <h2>{game.name}</h2>
      <div className="play-layout">
        <Board board={game.board} />
        <PlayerPanel board={game.board} />
      </div>
    </>
  );
}