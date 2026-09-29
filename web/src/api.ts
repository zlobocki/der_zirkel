export type Account = {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
};

export const PRIVACY_NOTICE =
  "Zbigniew Łobocki (zbigniew.lobocki@gmail.com) stores your username and email only to run accounts and games.";

type ErrorBody = {
  error?: string;
  field?: string;
};

export class ApiError extends Error {
  field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) {
    throw new ApiError(body.error ?? "Request failed.", body.field);
  }
  return body;
}

export function fetchMe(): Promise<{ user: Account | null }> {
  return request("/api/auth/me");
}

export function registerAccount(input: {
  username: string;
  email: string;
  password: string;
  gdprAccepted: boolean;
}): Promise<{ user: Account }> {
  return request("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function loginAccount(input: { email: string; password: string }): Promise<{ user: Account }> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function logoutAccount(): Promise<{ ok: boolean }> {
  return request("/api/auth/logout", { method: "POST" });
}

export function deleteAccount(password: string): Promise<{ ok: boolean }> {
  return request("/api/auth/account", { method: "DELETE", body: JSON.stringify({ password }) });
}

export type ManagedAccount = {
  id: string;
  username: string;
  email: string;
  isAdmin: boolean;
  disabled: boolean;
  createdAt: string;
};

export function fetchAccounts(): Promise<{ users: ManagedAccount[] }> {
  return request("/api/admin/users");
}

export function createManagedAccount(input: {
  username: string;
  email: string;
  password: string;
  gdprAccepted: boolean;
}): Promise<{ user: ManagedAccount }> {
  return request("/api/admin/users", { method: "POST", body: JSON.stringify(input) });
}

export function setAccountDisabled(id: string, disabled: boolean): Promise<{ user: ManagedAccount }> {
  return request(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ disabled }) });
}

export function resetAccountPassword(id: string, password: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/users/${id}/password`, { method: "POST", body: JSON.stringify({ password }) });
}

export function deleteManagedAccount(id: string): Promise<{ ok: boolean }> {
  return request(`/api/admin/users/${id}`, { method: "DELETE" });
}

export type GameSeat = {
  seat: number;
  kind: "human" | "ai";
  username: string | null;
  you: boolean;
};

export type LobbyGame = {
  id: string;
  name: string;
  status: "waiting" | "playing" | "finished";
  humanSeats: number;
  aiSeats: number;
  seatedHumans: number;
  yourSeat: number | null;
  creator: string | null;
  createdByYou: boolean;
  seats: GameSeat[];
};

export function fetchGames(): Promise<{ yours: LobbyGame[]; open: LobbyGame[] }> {
  return request("/api/games");
}

export function createGame(input: {
  name: string;
  password: string;
  humanSeats: number;
  aiSeats: number;
}): Promise<{ game: LobbyGame }> {
  return request("/api/games", { method: "POST", body: JSON.stringify(input) });
}

export function joinGame(id: string, password: string): Promise<{ game: LobbyGame }> {
  return request(`/api/games/${id}/join`, { method: "POST", body: JSON.stringify({ password }) });
}

export function leaveGame(id: string): Promise<{ ok: boolean }> {
  return request(`/api/games/${id}/leave`, { method: "POST" });
}

export function cancelGame(id: string): Promise<{ ok: boolean }> {
  return request(`/api/games/${id}/cancel`, { method: "POST" });
}

export type BoardView = {
  nations: Array<{
    id: string;
    score: number;
    tax: string;
    rondel: string;
    treasury: number;
    government: number | null;
    factories: Array<{ region: string; kind: "land" | "sea" }>;
    rondelIndex: number | null;
  }>;
  units: Array<{
    id: string;
    nation: string;
    kind: "army" | "fleet";
    region: string;
    harbor: boolean;
    posture: "standing" | "hostile" | "friendly";
  }>;
  flags: Array<{ region: string; nation: string }>;
  players: Array<{
    seat: number;
    kind: "human" | "ai";
    username: string | null;
    you: boolean;
    bonds: Array<{ nation: string; interest: number; price: number }>;
    investor: boolean;
    swissBank: boolean;
    cash: number | null;
  }>;
  draft: {
    nationId: string;
    seat: number;
    yours: boolean;
    choices: Array<{ interest: number; price: number }>;
  } | null;
  turn: {
    nationId: string;
    phase: string;
    yours: boolean;
    prompt: string;
    choices: Array<{ label: string; command: Record<string, unknown> }>;
    canUndo: boolean;
    canConfirm: boolean;
  } | null;
  finished: boolean;
  scores: Array<{ seat: number; points: number; winner: boolean }> | null;
};

export type SeatedGame = LobbyGame & { board: BoardView | null };

export function grantBond(id: string, interest: number | null): Promise<{ game: SeatedGame }> {
  return request(`/api/games/${id}/draft`, { method: "POST", body: JSON.stringify({ interest }) });
}

export function takeTurn(id: string, command: Record<string, unknown>): Promise<{ game: SeatedGame }> {
  return request(`/api/games/${id}/turn`, { method: "POST", body: JSON.stringify(command) });
}

export function fetchGame(id: string): Promise<{ game: SeatedGame }> {
  return request(`/api/games/${id}`);
}
