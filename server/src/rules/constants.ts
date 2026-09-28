export const NATION_ORDER = ["ah", "ita", "fra", "uk", "ger", "rus"] as const;

export type NationId = (typeof NATION_ORDER)[number];

export const NATION_NAME: Record<NationId, string> = {
  ah: "Austria-Hungary",
  ita: "Italy",
  fra: "France",
  uk: "Great Britain",
  ger: "Germany",
  rus: "Russia",
};

export const BOND_PRICE: Record<number, number> = {
  1: 2,
  2: 4,
  3: 6,
  4: 9,
  5: 12,
  6: 16,
  7: 20,
  8: 25,
  9: 30,
};

export const RONDEL = [
  "taxation",
  "factory",
  "production",
  "maneuver",
  "investor",
  "import",
  "production",
  "maneuver",
] as const;

export type RondelSpace = (typeof RONDEL)[number];

export const ARMY_CAP: Record<NationId, number> = {
  ah: 10,
  uk: 6,
  ita: 8,
  fra: 8,
  ger: 8,
  rus: 8,
};

export const FLEET_CAP: Record<NationId, number> = {
  ah: 6,
  uk: 10,
  ita: 8,
  fra: 8,
  ger: 8,
  rus: 8,
};

export function bondPrice(interest: number): number | null {
  return BOND_PRICE[interest] ?? null;
}

export function fullPiles(): Record<NationId, number[]> {
  const interests = Object.keys(BOND_PRICE).map(Number);
  return {
    ah: [...interests],
    ita: [...interests],
    fra: [...interests],
    uk: [...interests],
    ger: [...interests],
    rus: [...interests],
  };
}

/** Power points printed beside the tax chart. 2–5 is +0, 6 is +1, and 15+ is +10. */
export function powerPointsForTax(million: number): number {
  if (million <= 5) {
    return 0;
  }
  return Math.min(10, million - 5);
}

export function taxTrack(million: number): string {
  if (million <= 5) {
    return "tax_2-5";
  }
  if (million >= 15) {
    return "tax_15+";
  }
  return `tax_${million}`;
}

/** End-score multiplier for a nation's power points. */
export function scoreFactor(score: number): number {
  if (score <= 5) {
    return 0;
  }
  if (score <= 10) {
    return 1;
  }
  if (score <= 15) {
    return 2;
  }
  if (score <= 20) {
    return 3;
  }
  if (score <= 24) {
    return 4;
  }
  return 5;
}

/**
 * Cost, in millions of personal cash, to move clockwise on the rondel.
 * A nation standing in the center may enter any space for free.
 * Later it must move 1–6 spaces and pays 2 million for each space past the third.
 */
export function rondelCost(from: number | null, to: number): number | null {
  if (to < 0 || to >= RONDEL.length) {
    return null;
  }
  if (from === null) {
    return 0;
  }
  if (from < 0 || from >= RONDEL.length) {
    return null;
  }
  const steps = (to - from + RONDEL.length) % RONDEL.length;
  if (steps < 1 || steps > 6) {
    return null;
  }
  return Math.max(0, steps - 3) * 2;
}
