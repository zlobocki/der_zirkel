import { NATION_ORDER, bondPrice, fullPiles, type NationId } from "./constants.js";

export type BondHolding = {
  nation: NationId;
  interest: number;
  price: number;
};

export type DraftCursor = {
  nationIndex: number;
  offerIndex: number;
};

export type DraftPlayer = {
  seat: number;
  kind: "human" | "ai";
  cash: number;
  bonds: BondHolding[];
  investor: boolean;
  swissBank: boolean;
};

export type DraftNation = {
  id: NationId;
  treasury: number;
  government: number | null;
};

export type DraftPosition = {
  players: DraftPlayer[];
  nations: DraftNation[];
  piles: Record<NationId, number[]>;
  draft: DraftCursor | null;
};

export function openingPiles(): Record<NationId, number[]> {
  return fullPiles();
}

export function actorSeat(playerCount: number, draft: DraftCursor): number {
  return (draft.nationIndex + draft.offerIndex) % playerCount;
}

export function availableBonds(position: DraftPosition): Array<{ interest: number; price: number }> {
  if (!position.draft) {
    return [];
  }
  const nation = NATION_ORDER[position.draft.nationIndex];
  if (!nation) {
    return [];
  }
  return position.piles[nation].map((interest) => ({ interest, price: bondPrice(interest) ?? 0 }));
}

export function chooseBond<T extends DraftPosition>(position: T, seat: number, interest: number | null): T | { error: string } {
  if (!position.draft) {
    return { error: "The bond draft is finished." };
  }
  const playerCount = position.players.length;
  if (actorSeat(playerCount, position.draft) !== seat) {
    return { error: "It is not your turn to buy a bond." };
  }
  const nation = NATION_ORDER[position.draft.nationIndex];
  if (!nation) {
    return { error: "The bond draft is finished." };
  }
  const players = position.players.map((player) => ({ ...player, bonds: [...player.bonds] }));
  const nations = position.nations.map((entry) => ({ ...entry }));
  const piles: Record<NationId, number[]> = {
    ah: [...position.piles.ah],
    ita: [...position.piles.ita],
    fra: [...position.piles.fra],
    uk: [...position.piles.uk],
    ger: [...position.piles.ger],
    rus: [...position.piles.rus],
  };
  const player = players.find((entry) => entry.seat === seat);
  const treasury = nations.find((entry) => entry.id === nation);
  if (!player || !treasury) {
    return { error: "It is not your turn to buy a bond." };
  }
  if (interest !== null) {
    const price = bondPrice(interest);
    if (price === null || !piles[nation].includes(interest)) {
      return { error: "That bond has already been taken." };
    }
    if (player.cash < price) {
      return { error: "You do not have enough money for that bond." };
    }
    piles[nation] = piles[nation].filter((available) => available !== interest);
    player.cash -= price;
    player.bonds.push({ nation, interest, price });
    treasury.treasury += price;
  }
  return advance({ ...position, players, nations, piles }) as T;
}

function advance(position: DraftPosition): DraftPosition {
  const draft = position.draft;
  if (!draft) {
    return position;
  }
  const playerCount = position.players.length;
  if (draft.offerIndex + 1 < playerCount) {
    return { ...position, draft: { nationIndex: draft.nationIndex, offerIndex: draft.offerIndex + 1 } };
  }
  if (draft.nationIndex + 1 < NATION_ORDER.length) {
    return { ...position, draft: { nationIndex: draft.nationIndex + 1, offerIndex: 0 } };
  }
  return closeDraft(position);
}

export function closeDraft(position: DraftPosition): DraftPosition {
  const playerCount = position.players.length;
  const nations = position.nations.map((nation) => {
    let best = 0;
    const credit = new Map<number, number>();
    for (const player of position.players) {
      const sum = player.bonds.filter((bond) => bond.nation === nation.id).reduce((total, bond) => total + bond.price, 0);
      if (sum > 0) {
        credit.set(player.seat, sum);
        best = Math.max(best, sum);
      }
    }
    let government: number | null = null;
    if (best > 0) {
      for (let seat = 0; seat < playerCount; seat += 1) {
        if (credit.get(seat) === best) {
          government = seat;
          break;
        }
      }
    }
    return { ...nation, government };
  });
  const governed = new Set(nations.map((nation) => nation.government).filter((seat): seat is number => seat !== null));
  let leader: number | null = null;
  for (const id of NATION_ORDER) {
    const government = nations.find((nation) => nation.id === id)?.government ?? null;
    if (government !== null) {
      leader = government;
      break;
    }
  }
  const investorSeat = leader === null ? 0 : (leader + 1) % playerCount;
  return {
    ...position,
    nations,
    draft: null,
    players: position.players.map((player) => ({
      ...player,
      investor: player.seat === investorSeat,
      swissBank: !governed.has(player.seat),
    })),
  };
}

export function playAutomaticDraft<T extends DraftPosition>(position: T): T {
  let current = position;
  while (current.draft) {
    const seat = actorSeat(current.players.length, current.draft);
    const player = current.players.find((entry) => entry.seat === seat);
    if (!player || player.kind !== "ai") {
      break;
    }
    const nation = NATION_ORDER[current.draft.nationIndex];
    const affordable = nation
      ? current.piles[nation].filter((interest) => (bondPrice(interest) ?? Number.POSITIVE_INFINITY) <= player.cash)
      : [];
    const interest = affordable.length === 0 ? null : Math.min(...affordable);
    const next = chooseBond(current, seat, interest);
    if ("error" in next) {
      break;
    }
    current = next;
  }
  return current;
}
