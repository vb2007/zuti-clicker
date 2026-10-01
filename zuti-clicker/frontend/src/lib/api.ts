import type { LeaderboardMetric } from "@/types";
import type { AntiCheatDigest } from "@/utils/clickTelemetry";
import { useAntiCheatStore } from "@/stores/antiCheatStore";

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

// How long a save or a spin may take before the request is abandoned. After an
// abandoned spin the server MAY have settled it, which useUpgrader handles by
// reloading the save rather than assuming either outcome.
const SAVE_TIMEOUT_MS = 20_000;
const SPIN_TIMEOUT_MS = 15_000;

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // A ceiling for the calls a spin waits on, so a stalled connection can't hold
    // purchases and prestige refused (gameStore.spinPending) for the browser's own
    // multi-minute timeout. Absent where AbortSignal.timeout isn't supported.
    ...(timeoutMs !== undefined && typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {})
  });

  const data = (await res.json()) as { error?: string } & T;
  if (!res.ok) {
    // 403 is exclusively ANTICHEAT.RESTRICTED (see api/src/constants/
    // responses.ts — the only 403 this API ever returns) from ANY gated
    // write endpoint, not just POST /anticheat/report and GET /anticheat/
    // status. Applying it here, centrally, means a restricted PUT /save or
    // POST /boosters/claim pops the warning modal immediately instead of
    // surfacing as a generic sync/claim error and waiting up to a minute
    // for the next heartbeat to notice.
    if (res.status === 403) {
      const restricted = data as unknown as { restrictedUntil: string | null; strikeCount: number };
      useAntiCheatStore().applyServerResult({ ...restricted, isRestricted: true });
    }
    throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  }
  return data;
}

// PUT /save's 409 for a save made before a later wheel spin. Distinguished from
// the plausibility envelope's 409 (a real rejection and strike) by a
// machine-readable `code`, not by matching the English error text.
// Keep the value in sync with api/src/constants/responses.ts's SAVE.STALE.
export const SAVE_STALE_CODE = "save_stale";

export function isStaleSaveError(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    (e.body as { code?: string } | undefined)?.code === SAVE_STALE_CODE
  );
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
  // The spin counter last received from GET /save or POST /upgrader/spin.
  // Never stored by the server — a value behind the account's current one
  // marks this save as made before a later wheel spin and it is refused with a
  // 409 STALE (see isStaleSaveError). Absent means 0.
  upgraderSeq?: number;
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

export interface SpinResponse {
  message: string;
  won: boolean;
  // The server's roll and this spin's win chance, in parts per million: the
  // spin won exactly when rollPpm < winPpm, and the wheel lands on rollPpm.
  rollPpm: number;
  winPpm: number;
  payout: number;
  // The PhD balance and spin counter AFTER this spin — applied to the store
  // as-is, never recomputed locally.
  phdCount: number;
  upgraderSeq: number;
  // Present on a loss only.
  consolation?: { boosterId: string; remainingMs: number };
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

export interface AntiCheatReportResponse {
  message: string;
  status: "clean" | "restricted";
  restrictedUntil: string | null;
  strikeCount: number;
}
export interface AntiCheatStatusResponse {
  isRestricted: boolean;
  restrictedUntil: string | null;
  strikeCount: number;
}

export interface VersionResponse {
  version: string;
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
    store: (payload: SavePayload) =>
      request<StoreSaveResponse>("PUT", "/save", payload, SAVE_TIMEOUT_MS),
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
  },
  upgrader: {
    // The server alone rolls and settles the spin — the client only says how
    // much to stake and at what multiplier. A 409 means not enough PhDs (its
    // body carries the real balance) or an overflow; both leave the state untouched.
    spin: (stake: number, multiplier: number) =>
      request<SpinResponse>("POST", "/upgrader/spin", { stake, multiplier }, SPIN_TIMEOUT_MS)
  },
  anticheat: {
    // Fixed heartbeat + immediate-on-local-detection — see
    // stores/antiCheatStore.ts. Never touches game save data.
    report: (digest: AntiCheatDigest) =>
      request<AntiCheatReportResponse>("POST", "/anticheat/report", digest),
    status: () => request<AntiCheatStatusResponse>("GET", "/anticheat/status")
  },
  meta: {
    version: () => request<VersionResponse>("GET", "/version")
  }
};
