const KEY = "dz-open-games";

function read(): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberGame(id: string): void {
  const ids = new Set(read());
  ids.add(id);
  sessionStorage.setItem(KEY, JSON.stringify([...ids]));
}

export function gameRemembered(id: string): boolean {
  return read().includes(id);
}