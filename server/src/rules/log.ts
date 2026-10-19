export type GameLogEntry = { id: number; text: string; battle?: "land" | "sea"; actorSeat?: number };

export function appendLog(position: { log?: GameLogEntry[] }, text: string, actorSeat?: number): void {
  const log = position.log ?? [];
  position.log = [...log, { id: (log.at(-1)?.id ?? 0) + 1, text, ...(actorSeat === undefined ? {} : { actorSeat }) }];
}
