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
