export type GameLogEntry = { id: number; text: string };

export function appendLog(position: { log?: GameLogEntry[] }, text: string): void {
  const log = position.log ?? [];
  position.log = [...log, { id: (log.at(-1)?.id ?? 0) + 1, text }];
}
