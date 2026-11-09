// Browser requests stay on the frontend origin. Next.js proxies /api/* to the
// server-configured backend, keeping backend deployment details out of the
// client bundle and allowing the HttpOnly session cookie to remain first-party.
export const API_ROOT = "/api";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
};

export type AuthResponse = { user: AuthUser };

export async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? String(payload.detail)
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }

  return payload as T;
}
