import type { LeaderboardMetric } from "@/types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    // Full parsed response body, so a caller can read a field the generic
    // {error} shape doesn't cover — e.g. boosters.claim()'s 409 response
    // carries nextAvailableInMs alongside the error message.
    public readonly body: unknown = undefined
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Dev: Vite proxy rewrites /api → http://localhost:2710 (vite.config.ts).
// Production: VITE_API_BASE_URL is baked in at build time by the Dockerfile.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const data = (await res.json()) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  }
  return data;
}

export interface RegisterResponse {
  message: string;
  userId: number;
}
export interface LoginResponse {
  message: string;
}
export interface LogoutResponse {
  message: string;
}
export interface MeResponse {
  user: { id: number; username: string; email: string };
}

export interface UnitEntry {
  unitId: string;
  owned: number;
}

export interface SavePayload {
  tokens: number;
  totalTokensEarned: number;
  totalClicks: number;
  elapsedSeconds: number;
  // Optional on the wire so an older client (predating prestige) still
  // round-trips: the API preserves whatever is already stored when these are
  // omitted, rather than resetting them to 0.
  runTokensEarned?: number;
  runClicks?: number;
  runSeconds?: number;
  phdCount?: number;
  prestigeCount?: number;
  units: UnitEntry[];
  // Optional on the wire for the same reason (predates the upgrades system);
  // every entry must be a known upgrade id or the whole request 400s.
  upgrades?: string[];
}

export interface ActiveBoosterEntry {
  boosterId: string;
  // Server-computed remaining time, never an absolute expiry — see
  // gameStore's LoadedGameSave for why.
  remainingMs: number;
}

export interface SaveData extends SavePayload {
  savedAt: string;
  // Read-only: never accepted by PUT /save. Optional in the type for the
  // same reason units/phdCount etc. are on SavePayload — defensive against
  // any response shape that predates this field; gameStore's loadFromSave
  // treats an absent list the same as an empty one.
  activeBoosters?: ActiveBoosterEntry[];
}
export interface LoadSaveResponse {
  save: SaveData | null;
}
export interface StoreSaveResponse {
  message: string;
  savedAt: string;
}
export interface ResetSaveResponse {
  message: string;
}

export interface ClaimBoosterResponse {
  message: string;
  boosterId: string;
  remainingMs: number;
  // How long until the next claim could succeed — used to precisely
  // re-seed the client's local spawn schedule (see composables/useBoosters.ts).
  nextAvailableInMs: number;
}

export interface SettingsPayload {
  theme?: string;
  language?: string;
  autosaveEnabled?: boolean;
  autosaveIntervalSecs?: number;
  prestigeCeremony?: string;
  hideFromLeaderboards?: boolean;
}
export interface SettingsData {
  theme: string;
  language: string;
  autosaveEnabled: boolean;
  autosaveIntervalSecs: number;
  prestigeCeremony: string;
  hideFromLeaderboards: boolean;
  updatedAt: string | null;
}
export interface LoadSettingsResponse {
  settings: SettingsData;
}
export interface StoreSettingsResponse {
  message: string;
  settings: SettingsData;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  value: number;
}
export interface LeaderboardViewer {
  rank: number;
  value: number;
  hidden: boolean;
}
export interface LeaderboardResponse {
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
  viewer: LeaderboardViewer | null;
}

export const api = {
  auth: {
    register: (username: string, email: string, password: string) =>
      request<RegisterResponse>("POST", "/auth/register", { username, email, password }),
    login: (email: string, password: string) =>
      request<LoginResponse>("POST", "/auth/login", { email, password }),
    logout: () => request<LogoutResponse>("POST", "/auth/logout"),
    me: () => request<MeResponse>("GET", "/auth/me")
  },
  save: {
    load: () => request<LoadSaveResponse>("GET", "/save"),
    store: (payload: SavePayload) => request<StoreSaveResponse>("PUT", "/save", payload),
    reset: () => request<ResetSaveResponse>("DELETE", "/save")
  },
  settings: {
    load: () => request<LoadSettingsResponse>("GET", "/settings"),
    store: (payload: SettingsPayload) => request<StoreSettingsResponse>("PUT", "/settings", payload)
  },
  leaderboard: {
    get: (metric: LeaderboardMetric, limit?: number) => {
      const params = new URLSearchParams({ metric });
      if (limit !== undefined) params.set("limit", String(limit));
      return request<LeaderboardResponse>("GET", `/leaderboard?${params.toString()}`);
    }
  },
  boosters: {
    // No request body: the server alone picks the booster and its timing —
    // see the anti-cheat model in the plan this implements. A 409 (cooldown
    // not yet elapsed) still carries nextAvailableInMs on the thrown
    // ApiError's `body`.
    claim: () => request<ClaimBoosterResponse>("POST", "/boosters/claim")
  }
};
