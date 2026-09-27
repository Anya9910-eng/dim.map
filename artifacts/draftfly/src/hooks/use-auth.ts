import { useQuery } from "@tanstack/react-query";

export interface AuthUser {
  /** The signed-in email address, lowercased — the stable identifier. */
  id: string;
  name: string;
  email: string;
  /** Decided server-side at login; the client cannot influence it. */
  role: "operator" | "client";
  /** The client this person belongs to. null for an operator. */
  clientId: number | null;
}

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to fetch auth state");
  return res.json() as Promise<AuthUser>;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Hiding operator surfaces is a courtesy to the client user, not the
  // control: every one of those routes refuses them server-side regardless of
  // what the sidebar happens to render.
  return {
    user: user ?? null,
    loading: isLoading,
    isOperator: user?.role === "operator",
    clientId: user?.clientId ?? null,
  };
}
