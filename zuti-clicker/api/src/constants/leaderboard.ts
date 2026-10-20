// Keep the metric key set in sync with frontend/src/lib/api.ts's
// LeaderboardMetric type — both list the same four keys. Every `field` here
// must be a plain scalar column on GameSave: database/models/leaderboard.ts
// threads it into Prisma's select/orderBy/where through untyped computed-key
// casts, so a non-scalar (relation) field would compile but misbehave at
// runtime.
export const LEADERBOARD_METRICS = {
  tokens: { field: "totalTokensEarned" },
  clicks: { field: "totalClicks" },
  // Held + invested PhDs (GameSave.phdTotal): investing in the Academic
  // Career tree must never cost a player their rank.
  phd: { field: "phdTotal" },
  playtime: { field: "elapsedSeconds" }
} as const;

export type LeaderboardMetric = keyof typeof LEADERBOARD_METRICS;
export type LeaderboardField = (typeof LEADERBOARD_METRICS)[LeaderboardMetric]["field"];

export const DEFAULT_LEADERBOARD_METRIC: LeaderboardMetric = "tokens";
export const DEFAULT_LEADERBOARD_LIMIT = 50;
export const MAX_LEADERBOARD_LIMIT = 100;

export function isLeaderboardMetric(value: unknown): value is LeaderboardMetric {
  // `value in LEADERBOARD_METRICS` would also match inherited
  // Object.prototype keys (e.g. ?metric=toString), letting a malformed value
  // slip past validation and crash later with a 500 instead of a 400 —
  // hasOwnProperty restricts the check to the four declared metrics.
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEADERBOARD_METRICS, value)
  );
}
