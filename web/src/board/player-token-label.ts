type NamedPlayer = { seat: number; username: string | null };

function initial(player: NamedPlayer): string {
  const letter = [...(player.username ?? "")].find((character) => /\p{L}/u.test(character));
  return [...(letter?.toUpperCase() ?? "?")][0];
}

export function playerTokenLabel(players: NamedPlayer[], seat: number): { initial: string; number: number | null } {
  const player = players.find((entry) => entry.seat === seat);
  if (!player) return { initial: "?", number: null };
  const letter = initial(player);
  const matches = players.filter((entry) => initial(entry) === letter).sort((left, right) => left.seat - right.seat);
  return { initial: letter, number: matches.length > 1 ? matches.findIndex((entry) => entry.seat === seat) + 1 : null };
}
