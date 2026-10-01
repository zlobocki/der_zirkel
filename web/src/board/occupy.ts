export type Point = [number, number];

const NEIGHBORS: Point[] = [
  [2.8, 0],
  [-2.8, 0],
  [0, 2.8],
  [0, -2.8],
  [2.8, 2.8],
  [-2.8, 2.8],
  [2.8, -2.8],
  [-2.8, -2.8],
];

/** One piece per slot. Further pieces sit beside an occupied slot. */
export function placeInSlots(points: Point[], count: number): Point[] {
  const bases = points.length > 0 ? points : [[0, 0] as Point];
  return Array.from({ length: count }, (_, index) => {
    if (index < bases.length) {
      return bases[index] as Point;
    }
    const extra = index - bases.length;
    const base = bases[extra % bases.length] as Point;
    const [dx, dy] = NEIGHBORS[extra % NEIGHBORS.length] as Point;
    const ring = 1 + Math.floor(extra / NEIGHBORS.length);
    return [base[0] + dx * ring, base[1] + dy * ring];
  });
}

export function positionFor(points: Point[], ids: string[], id: string): Point | null {
  const index = ids.indexOf(id);
  if (index < 0) {
    return null;
  }
  return placeInSlots(points, ids.length)[index] ?? null;
}

/** The first printed slot that no current occupant is standing on. */
export function firstEmptySlot(points: Point[], occupantIds: string[]): Point | null {
  const used = new Set<string>();
  for (const id of occupantIds) {
    const point = positionFor(points, occupantIds, id);
    if (point && points.some((slot) => slot[0] === point[0] && slot[1] === point[1])) {
      used.add(`${point[0]},${point[1]}`);
    }
  }
  return points.find((point) => !used.has(`${point[0]},${point[1]}`)) ?? null;
}
