import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchGame, grantBond, joinGame, takeTurn, type BoardView, type SeatedGame } from "../api";
import { Board, NATIONS, PlayerPanel } from "../board/Board";
import { bondSrc } from "../board/bonds";
import { useAuth } from "../auth-context";
import { gameRemembered, rememberGame } from "../open-games";

function DraftTurn({
  gameId,
  board,
  onBoard,
}: {
  gameId: string;
  board: BoardView;
  onBoard: (board: BoardView) => void;
}) {
  const draft = board.draft;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!draft) {
    return null;
  }
  const nation = NATIONS.find((item) => item.id === draft.nationId)?.name ?? draft.nationId;
  const actor = board.players.find((player) => player.seat === draft.seat);
  const cash = board.players.find((player) => player.you)?.cash;

  async function choose(interest: number | null) {
    setError(null);
    setPending(true);
    try {
      const result = await grantBond(gameId, interest);
      if (result.game.board) {
        onBoard(result.game.board);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not grant that bond.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card">
      <h2>Grant a bond</h2>
      <p className="notice">
        {draft.yours
          ? `Choose one ${nation} bond, or pass. The price goes into the ${nation} treasury.`
          : `${actor?.username ?? "The next player"} is choosing a ${nation} bond.`}
      </p>
      {draft.yours ? (
        <div className="row-actions">
          {draft.choices.map((choice) => (
            <button
              key={choice.interest}
              type="button"
              disabled={pending || (cash !== null && cash !== undefined && choice.price > cash)}
              onClick={() => void choose(choice.interest)}
            >
              {choice.price} million
            </button>
          ))}
          <button type="button" className="quiet" disabled={pending} onClick={() => void choose(null)}>
            Pass
          </button>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function shownChoices(turn: NonNullable<BoardView["turn"]>) {
  if (!turn.yours || turn.phase === "rondel") {
    return [];
  }
  if (turn.phase === "fleets" || turn.phase === "armies") {
    return turn.choices.filter((choice) => choice.command.action === "moves-done");
  }
  if (turn.phase === "invest") {
    return turn.choices.filter((choice) => choice.command.action === "invest" && choice.command.interest == null);
  }
  return turn.choices;
}

type BondIntent = "buy" | "raise";

function bondOffer(
  choices: NonNullable<BoardView["turn"]>["choices"],
  nationId: string,
  interest: number,
  intent: BondIntent,
) {
  return choices.find((choice) => {
    const command = choice.command;
    if (command.action !== "invest" || command.nationId !== nationId || command.interest !== interest) {
      return false;
    }
    const raising = command.replaceInterest != null;
    return intent === "raise" ? raising : !raising;
  });
}

function BondMarket({
  board,
  pending,
  onAct,
}: {
  board: BoardView;
  pending: boolean;
  onAct: (command: Record<string, unknown>) => void;
}) {
  const turn = board.turn;
  const [intent, setIntent] = useState<BondIntent | null>(null);
  const investing = turn?.phase === "invest";
  const actor = turn?.actorSeat ?? null;
  useEffect(() => {
    setIntent(null);
  }, [actor, investing]);
  if (!turn || !investing) {
    return null;
  }
  const canBuy = turn.yours && turn.choices.some((choice) => choice.command.action === "invest" && choice.command.interest != null && choice.command.replaceInterest == null);
  const canRaise = turn.yours && turn.choices.some((choice) => choice.command.action === "invest" && choice.command.replaceInterest != null);
  return (
    <>
      {turn.yours ? (
        <div className="row-actions bond-intent">
          <button
            type="button"
            className={intent === "buy" ? "intent-buy" : ""}
            aria-pressed={intent === "buy"}
            disabled={pending || !canBuy}
            onClick={() => setIntent("buy")}
          >
            Buy a bond
          </button>
          <button
            type="button"
            className={intent === "raise" ? "intent-raise" : ""}
            aria-pressed={intent === "raise"}
            disabled={pending || !canRaise}
            onClick={() => setIntent("raise")}
          >
            Upgrade a bond
          </button>
        </div>
      ) : null}
      <div className="bond-market" aria-label="Bonds for sale">
        {NATIONS.map((nation) => {
          const sale = board.nations.find((entry) => entry.id === nation.id)?.bondsForSale ?? [];
          return (
            <div className="bond-row" key={nation.id}>
              <span className="bond-row-name">{nation.name}</span>
              <div className="bond-row-cards">
                {sale.map((bond) => {
                  const offer = turn.yours && intent ? bondOffer(turn.choices, nation.id, bond.interest, intent) : undefined;
                  const buying = intent === "buy" && Boolean(offer);
                  const raising = intent === "raise" && Boolean(offer);
                  return (
                    <button
                      key={bond.interest}
                      type="button"
                      className={`bond-offer${buying ? " bond-buy" : ""}${raising ? " bond-raise" : ""}`}
                      disabled={pending || !offer}
                      title={offer?.label ?? `${nation.name} ${bond.price} million`}
                      data-nation={nation.id}
                      data-interest={bond.interest}
                      onClick={() => {
                        if (offer) {
                          onAct(offer.command);
                        }
                      }}
                    >
                      <img src={bondSrc(nation.id, bond.interest)} alt={`${nation.name} ${bond.price} million`} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function turnHint(board: BoardView, turn: NonNullable<BoardView["turn"]>): string {
  if (!turn.yours) {
    return "";
  }
  if (turn.phase === "rondel" && turn.choices.some((choice) => choice.command.action === "rondel")) {
    return " Click a highlighted space on the rondel.";
  }
  if (turn.phase === "fleets" || turn.phase === "armies") {
    const canMove = turn.choices.some((choice) => {
      const command = choice.command;
      if (command.action !== "move" || typeof command.unitId !== "string" || typeof command.region !== "string") {
        return false;
      }
      const unit = board.units.find((entry) => entry.id === command.unitId);
      return Boolean(unit && command.region !== unit.region);
    });
    if (canMove) {
      return " Click a highlighted unit, then a green dot.";
    }
  }
  return "";
}

function NationTurn({
  board,
  pending,
  error,
  onAct,
}: {
  board: BoardView;
  pending: boolean;
  error: string | null;
  onAct: (command: Record<string, unknown>) => void;
}) {
  const turn = board.turn;
  if (board.finished) {
    return (
      <section className="card">
        <h2>The game is over</h2>
        <ul className="account-list">
          {(board.scores ?? []).map((score) => {
            const player = board.players.find((entry) => entry.seat === score.seat);
            return (
              <li key={score.seat}>
                {player?.username ?? "Player"}: {score.points} points{score.winner ? " — wins" : ""}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
  if (!turn) {
    return null;
  }

  const nationName = NATIONS.find((nation) => nation.id === turn.nationId)?.name ?? "the nation";
  const buyer = board.players.find((player) => player.seat === turn.actorSeat);
  const heading = turn.phase === "invest" ? `${nationName} - ${buyer?.username ?? "A player"} currently buying bonds` : nationName;
  const you = board.players.find((player) => player.you);
  const nation = board.nations.find((entry) => entry.id === turn.nationId);
  const canPay = Boolean(you && nation && nation.government === you.seat && (you.cash ?? 0) >= 1);
  const choices = shownChoices(turn);

  return (
    <section className="card">
      <h2>{heading}</h2>
      <p className="notice">
        {turn.prompt}
        {turnHint(board, turn)}
      </p>
      <BondMarket board={board} pending={pending} onAct={onAct} />
      {canPay ? (
        <p className="row-actions">
          <button type="button" disabled={pending} onClick={() => onAct({ action: "treasury", nationId: turn.nationId })}>
            Transfer 1 million of your money to {nationName}
          </button>
        </p>
      ) : null}
      {choices.length > 0 ? (
        <div className="row-actions">
          {choices.map((choice, index) => (
            <button key={`${choice.label}-${index}`} type="button" disabled={pending} onClick={() => onAct(choice.command)}>
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
      {turn.canUndo ? (
        <p className="row-actions">
          <button type="button" className="quiet" disabled={pending} onClick={() => onAct({ action: "undo" })}>
            Undo
          </button>
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function GameTable({
  gameId,
  board,
  onBoard,
}: {
  gameId: string;
  board: BoardView;
  onBoard: (board: BoardView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function act(command: Record<string, unknown>) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setError(null);
    setPending(true);
    try {
      const result = await takeTurn(gameId, command);
      if (result.game.board) {
        onBoard(result.game.board);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not take that action.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      {board.draft ? (
        <DraftTurn gameId={gameId} board={board} onBoard={onBoard} />
      ) : (
        <NationTurn board={board} pending={pending} error={error} onAct={(command) => void act(command)} />
      )}
      <div className="play-layout">
        <Board board={board} onCommand={(command) => void act(command)} />
        <PlayerPanel board={board} />
      </div>
    </>
  );
}

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
      <GameTable gameId={game.id} board={game.board} onBoard={(board) => setGame({ ...game, board })} />
    </>
  );
}