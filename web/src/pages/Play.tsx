import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, fetchGame, grantBond, joinGame, takeTurn, type BoardView, type SeatedGame } from "../api";
import { Board, NATIONS, PlayerPanel, unitMarkers, type Explosion, type MoveTrail } from "../board/Board";
import { bondSrc } from "../board/bonds";
import { armCombatAudio, playCombatSound, stopCombatSound } from "../board/combat-audio";
import { GameMusic } from "../board/GameMusic";
import { playTurnDing } from "../board/turn-audio";
import { activePlayerKey } from "../board/turn-notification";
import { Victory } from "../board/Victory";
import { useAuth } from "../auth-context";
import { gameRemembered, rememberGame } from "../open-games";

function BondConfirmation({ label, pending, onApprove, onRestart }: {
  label: string;
  pending: boolean;
  onApprove: () => void;
  onRestart: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="bond-confirmation" onCancel={(event) => {
      event.preventDefault();
      if (!pending) onRestart();
    }} aria-labelledby="bond-confirmation-title">
      <h2 id="bond-confirmation-title">Confirm bond purchase</h2>
      <p>{label}</p>
      <p>Approve this move or start over and choose differently.</p>
      <div className="row-actions">
        <button type="button" disabled={pending} onClick={onApprove}>Approve</button>
        <button type="button" className="quiet" autoFocus disabled={pending} onClick={onRestart}>Start over</button>
      </div>
    </dialog>
  );
}

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
  const [selection, setSelection] = useState<{ interest: number; price: number } | null>(null);
  const busy = useRef(false);
  useEffect(() => setSelection(null), [board]);
  if (!draft) {
    return null;
  }
  const nation = NATIONS.find((item) => item.id === draft.nationId)?.name ?? draft.nationId;
  const actor = board.players.find((player) => player.seat === draft.seat);
  const cash = board.players.find((player) => player.you)?.cash;

  async function choose(interest: number | null) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setPending(true);
    try {
      const result = await grantBond(gameId, interest);
      if (result.game.board) {
        onBoard(result.game.board);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not buy that bond.");
    } finally {
      busy.current = false;
      setSelection(null);
      setPending(false);
    }
  }

  return (
    <section className="card">
      <h2>Buy a bond</h2>
      <p className="notice">
        {draft.yours
          ? `Choose one ${nation} bond, or pass. The price goes into the ${nation} treasury.`
          : `${actor?.username ?? "The next player"} is choosing a ${nation} bond.`}
      </p>
      {draft.yours ? (
        <>
          <div className="draft-bonds">
            {draft.choices.map((choice) => {
              const affordable = cash === null || cash === undefined || choice.price <= cash;
              return (
                <button
                  key={choice.interest}
                  type="button"
                  className={`bond-offer${affordable ? " bond-buy" : ""}`}
                  disabled={pending || !affordable}
                  title={`${nation} ${choice.price} million`}
                  onClick={() => setSelection(choice)}
                >
                  <img src={bondSrc(draft.nationId, choice.interest)} alt={`${nation} ${choice.price} million`} />
                </button>
              );
            })}
          </div>
          <div className="row-actions">
            <button type="button" className="quiet" disabled={pending} onClick={() => void choose(null)}>
              Pass
            </button>
          </div>
        </>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {selection ? <BondConfirmation
        label={`Buy the ${nation} bond for ${selection.price} million (${selection.interest} million interest).`}
        pending={pending}
        onApprove={() => void choose(selection.interest)}
        onRestart={() => setSelection(null)}
      /> : null}
    </section>
  );
}

function shownChoices(turn: NonNullable<BoardView["turn"]>) {
  if (!turn.yours || turn.phase === "rondel") {
    return [];
  }
  if (turn.phase === "factory") {
    return turn.choices.filter((choice) => choice.command.action === "factory" && choice.command.region == null);
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
  replaceInterest: number | null,
) {
  return choices.find((choice) => {
    const command = choice.command;
    if (command.action !== "invest" || command.nationId !== nationId || command.interest !== interest) {
      return false;
    }
    if (intent === "raise") {
      return command.replaceInterest === replaceInterest;
    }
    return command.replaceInterest == null;
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
  const [upgradeFrom, setUpgradeFrom] = useState<{ nationId: string; interest: number } | null>(null);
  const [selection, setSelection] = useState<NonNullable<BoardView["turn"]>["choices"][number] | null>(null);
  useEffect(() => setSelection(null), [board]);
  const investing = turn?.phase === "invest";
  const actor = turn?.actorSeat ?? null;
  useEffect(() => {
    setIntent(null);
    setUpgradeFrom(null);
  }, [actor, investing]);
  if (!turn || !investing) {
    return null;
  }
  const canBuy = turn.yours && turn.choices.some((choice) => choice.command.action === "invest" && choice.command.interest != null && choice.command.replaceInterest == null);
  const canRaise = turn.yours && turn.choices.some((choice) => choice.command.action === "invest" && choice.command.replaceInterest != null);
  const holder = board.players.find((player) => player.seat === actor);
  const upgradeSources = (holder?.bonds ?? [])
    .filter((bond) =>
      turn.choices.some(
        (choice) => choice.command.action === "invest" && choice.command.nationId === bond.nation && choice.command.replaceInterest === bond.interest,
      ),
    )
    .sort((left, right) => {
      const byNation = NATIONS.findIndex((nation) => nation.id === left.nation) - NATIONS.findIndex((nation) => nation.id === right.nation);
      return byNation || left.interest - right.interest;
    });
  const selectedSource =
    upgradeFrom && upgradeSources.some((bond) => bond.nation === upgradeFrom.nationId && bond.interest === upgradeFrom.interest) ? upgradeFrom : null;
  return (
    <>
      {turn.yours ? (
        <div className="row-actions bond-intent">
          <button
            type="button"
            className={intent === "buy" ? "intent-buy" : ""}
            aria-pressed={intent === "buy"}
            disabled={pending || !canBuy}
            onClick={() => {
              setUpgradeFrom(null);
              setIntent("buy");
            }}
          >
            Buy a bond
          </button>
          <button
            type="button"
            className={intent === "raise" ? "intent-raise" : ""}
            aria-pressed={intent === "raise"}
            disabled={pending || !canRaise}
            onClick={() => {
              setUpgradeFrom(null);
              setIntent("raise");
            }}
          >
            Upgrade a bond
          </button>
        </div>
      ) : null}
      {turn.yours && intent === "raise" ? (
        <div className="upgrade-source">
          <p className="notice">Which bond should be upgraded?</p>
          <div className="bond-row-cards">
            {upgradeSources.map((bond) => {
              const nation = NATIONS.find((entry) => entry.id === bond.nation);
              const selected = selectedSource?.nationId === bond.nation && selectedSource.interest === bond.interest;
              return (
                <button
                  key={`${bond.nation}-${bond.interest}`}
                  type="button"
                  className={`bond-offer${selected ? " bond-raise" : " bond-buy"}`}
                  disabled={pending}
                  aria-pressed={selected}
                  title={`${nation?.name ?? bond.nation} ${bond.price} million`}
                  data-upgrade-nation={bond.nation}
                  data-upgrade-interest={bond.interest}
                  onClick={() => setUpgradeFrom({ nationId: bond.nation, interest: bond.interest })}
                >
                  <img src={bondSrc(bond.nation, bond.interest)} alt={`${nation?.name ?? bond.nation} ${bond.price} million`} />
                </button>
              );
            })}
          </div>
          {selectedSource ? <p className="notice">Choose the bond to upgrade to. Pay the difference.</p> : null}
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
                  const offer =
                    turn.yours && intent === "buy"
                      ? bondOffer(turn.choices, nation.id, bond.interest, "buy", null)
                      : turn.yours && intent === "raise" && selectedSource?.nationId === nation.id
                        ? bondOffer(turn.choices, nation.id, bond.interest, "raise", selectedSource.interest)
                        : undefined;
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
                          setSelection(offer);
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
      {selection ? <BondConfirmation
        label={selection.label}
        pending={pending}
        onApprove={() => {
          onAct(selection.command);
          setSelection(null);
        }}
        onRestart={() => {
          setSelection(null);
          setIntent(null);
          setUpgradeFrom(null);
        }}
      /> : null}
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
  if (turn.phase === "factory" && turn.choices.some((choice) => choice.command.action === "factory" && typeof choice.command.region === "string")) {
    return " Click a green factory space.";
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
    return <Victory board={board} />;
  }
  if (!turn) {
    return null;
  }

  const nationName = NATIONS.find((nation) => nation.id === turn.nationId)?.name ?? "the nation";
  const buyer = board.players.find((player) => player.seat === turn.actorSeat);
  const heading = turn.phase === "invest" ? `${nationName} - ${buyer?.username ?? "A player"} currently buying bonds`
    : turn.phase === "army-battle" || turn.phase === "fleet-battle" ? `${nationName} — ${buyer?.username ?? "A government"} decides on battle` : nationName;
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
      {turn.payouts ? <section className="investor-payouts" aria-label="Investor payout preview">
        <h3>Investor payouts</h3>
        <p>{nationName}'s treasury pays {turn.payouts.treasuryPayment} million.
          {turn.payouts.governmentPayment > 0 ? ` Its controller must contribute ${turn.payouts.governmentPayment} million personally.` : ""}
          {turn.payouts.passedInvestor ? " No bond interest is paid when Investor is passed." : ""}
        </p>
        <ul>
          {turn.payouts.players.map((payout) => <li key={payout.seat}>
            <strong>{board.players.find((player) => player.seat === payout.seat)?.username ?? "Player"}</strong>: {payout.interest} million interest
            {payout.bonus ? ` + ${payout.bonus} million Investor bonus` : ""}
            {payout.contribution ? ` − ${payout.contribution} million contribution` : ""}
            {` = ${payout.net} million net`}
          </li>)}
        </ul>
        <p>{turn.yours ? "Confirm to make these payments and open bond buying." : "Waiting for the controller to confirm these payments."}</p>
      </section> : null}
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
  const [explosions, setExplosions] = useState<Explosion[]>([]);
  const [moves, setMoves] = useState<MoveTrail[]>([]);
  const previousBoard = useRef(board);
  const movementTimer = useRef<number | null>(null);
  const busy = useRef(false);
  const blastTimer = useRef<number | null>(null);
  const currentSeat = board.draft?.seat ?? board.turn?.actorSeat;
  const currentAI = board.players.find((player) => player.seat === currentSeat && player.kind === "ai");
  const latestAction = board.log ? [...board.log].reverse().find((entry) => entry.actorSeat !== undefined) : undefined;
  // Keep the useful action visible when a turn ends, including in existing logs.
  const latestActivity = board.log ? [...board.log].reverse().find((entry) => entry.actorSeat !== undefined && !/ ended .+'s turn\.$/.test(entry.text)) : undefined;
  const lastAIAction = latestActivity && board.players.some((player) => player.seat === latestActivity.actorSeat && player.kind === "ai") ? latestActivity : null;
  const lastSoundLog = useRef(board.log?.at(-1)?.id ?? 0);
  useEffect(() => {
    const fresh = (board.log ?? []).filter((entry) => entry.id > lastSoundLog.current);
    lastSoundLog.current = board.log?.at(-1)?.id ?? 0;
    const battle = [...fresh].reverse().find((entry) => entry.battle);
    if (battle?.battle) void playCombatSound(battle.battle);
  }, [board.log]);
  useEffect(() => {
    const before = previousBoard.current;
    previousBoard.current = board;
    const markers = new Map(unitMarkers(before).map((marker) => [marker.id, marker]));
    if (lastAIAction) {
      const trails = unitMarkers(board).flatMap((marker) => {
        const from = markers.get(marker.id);
        const oldUnit = before.units.find((unit) => unit.id === marker.id);
        const newUnit = board.units.find((unit) => unit.id === marker.id);
        return from && oldUnit?.region !== newUnit?.region ? [{ id: `${marker.id}-${lastAIAction.id}`, from, to: marker }] : [];
      });
      if (trails.length) {
        setMoves(trails);
        if (movementTimer.current !== null) window.clearTimeout(movementTimer.current);
        movementTimer.current = window.setTimeout(() => setMoves([]), 1100);
      }
    }
    if (latestAction?.battle) {
      const remaining = new Set(board.units.map((unit) => unit.id));
      const seen = new Set<string>();
      const blasts = [...markers.values()].filter((marker) => {
        const key = `${marker.x},${marker.y}`;
        if (remaining.has(marker.id) || seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map((marker) => ({ ...marker, id: `${marker.id}-${latestAction.id}` }));
      if (blasts.length) {
        setExplosions(blasts);
        if (blastTimer.current !== null) window.clearTimeout(blastTimer.current);
        blastTimer.current = window.setTimeout(() => setExplosions([]), 1100);
      }
    }
  }, [board]);
  useEffect(() => () => {
    stopCombatSound();
    if (blastTimer.current !== null) window.clearTimeout(blastTimer.current);
    if (movementTimer.current !== null) window.clearTimeout(movementTimer.current);
  }, []);

  async function act(command: Record<string, unknown>) {
    if (busy.current) {
      return;
    }
    if (command.action === "fight") {
      armCombatAudio();
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
        {currentAI || lastAIAction ? <aside className="ai-activity" aria-live="polite" aria-atomic="true">
          <strong>{currentAI ? `${currentAI.username ?? "The AI"} is taking a turn…` : "Latest AI action"}</strong>
          {lastAIAction ? <p key={lastAIAction.id}>{lastAIAction.text}</p> : <p>AI actions appear one at a time so you can follow the board.</p>}
        </aside> : null}
        <Board board={board} explosions={explosions} moveTrails={moves} onCommand={(command) => void act(command)} />
        <PlayerPanel board={board} />
        <section className="card game-log" aria-labelledby="game-log-title">
          <h2 id="game-log-title">Game log</h2>
          {board.log?.length ? (
            <ol reversed aria-label="Game actions">
              {[...board.log].reverse().map((entry) => <li key={entry.id} value={entry.id}>{entry.text}</li>)}
            </ol>
          ) : <p className="notice">Actions taken from now on will appear here.</p>}
        </section>
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
  const localRevision = useRef(0);
  const refreshGame = useRef<() => void>(() => {});
  const previousActive = useRef<string | null>(null);
  const activeKey = activePlayerKey(game?.board ?? null);

  useEffect(() => {
    const key = activeKey === null ? null : `${gameId}:${activeKey}`;
    if (key !== null && key !== previousActive.current) playTurnDing();
    previousActive.current = key;
  }, [activeKey, gameId]);

  useEffect(() => {
    if (!user || !unlocked || !gameId) {
      return;
    }
    let active = true;
    let fetching = false;
    let refreshAgain = false;
    let retry: number | undefined;
    async function refresh() {
      if (!active) return;
      if (fetching) {
        refreshAgain = true;
        return;
      }
      fetching = true;
      refreshAgain = false;
      window.clearTimeout(retry);
      const revision = localRevision.current;
      try {
        const body = await fetchGame(gameId);
        if (active && revision === localRevision.current) {
          setError(null);
          setGame((previous) => JSON.stringify(previous) === JSON.stringify(body.game) ? previous : body.game);
        } else if (active) {
          refreshAgain = true;
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof ApiError ? caught.message : "Could not open this game.");
          retry = window.setTimeout(() => void refresh(), 5000);
        }
      } finally {
        fetching = false;
        if (active && refreshAgain) void refresh();
      }
    }
    const events = new EventSource(`/api/games/${encodeURIComponent(gameId)}/events`);
    refreshGame.current = () => void refresh();
    events.addEventListener("changed", refresh);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    void refresh();
    return () => {
      active = false;
      events.close();
      window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
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
      <div className="actions game-toolbar">
        <Link to="/lobby">Lobby</Link>
        <GameMusic key={game.id} board={game.board} />
      </div>
      <h2>{game.name}</h2>
      <GameTable key={game.id} gameId={game.id} board={game.board} onBoard={(board) => {
        localRevision.current += 1;
        setGame((previous) => previous ? { ...previous, board } : previous);
        refreshGame.current();
      }} />
    </>
  );
}
