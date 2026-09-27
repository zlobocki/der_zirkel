import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchMe, type Account } from "./api";

type AuthState = {
  user: Account | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: Account | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const body = await fetchMe();
    setUser(body.user);
  }

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((body) => {
        if (active) {
          setUser(body.user);
        }
      })
      .catch(() => {
        if (active) {
          setUser(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return <AuthContext.Provider value={{ user, loading, refresh, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
