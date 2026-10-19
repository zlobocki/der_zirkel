import { randomInt } from "node:crypto";

/** Draw once when the table starts, including humans and computer opponents. */
export function shuffleSeats<T extends { seat: number }>(seats: T[], below: (limit: number) => number = randomInt): T[] {
  const shuffled = seats.map((seat) => ({ ...seat }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = below(index + 1);
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  return shuffled.map((seat, index) => ({ ...seat, seat: index }));
}
