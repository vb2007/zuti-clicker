// Client-side mirror of the histogram/rate shape api/src/constants/
// antiCheat.ts and api/src/services/antiCheat.ts define — the server scores
// a digest built from exactly this bucketing, so drifting either side would
// silently corrupt every verdict. Keep these four in sync with that file's
// HISTOGRAM_BUCKET_COUNT, MIN_INTERVAL_MS/MAX_INTERVAL_MS, and
// HEARTBEAT_INTERVAL_MS.
export const HISTOGRAM_BUCKET_COUNT = 24;
export const MIN_INTERVAL_MS = 15;
export const MAX_INTERVAL_MS = 3000;
export const HEARTBEAT_INTERVAL_MS = 60_000;

// Client-side hard burst cap — a click beyond this rolling-1s rate is
// dropped silently (no token, no flag, no telemetry entry at all). Keep in
// sync with api/src/constants/antiCheat.ts's ENVELOPE_MAX_CPS; this is the
// generous envelope backstop, not the statistical detector's own flag
// threshold, which lives server-side only.
export const BURST_CPS_CAP = 45;
export const BURST_WINDOW_MS = 1000;

// The penalty ladder itself is not sensitive (durations, not thresholds —
// knowing "wait 1 minute" doesn't help evade detection), unlike the
// statistical thresholds, which never ship to the client. Keep in sync with
// api/src/constants/antiCheat.ts's RESTRICTION_MINUTES_BY_STRIKE/
// SAVE_RESET_STRIKE. Used ONLY for guest-mode's local-only detection (see
// stores/antiCheatStore.ts) — a logged-in account's restriction always comes
// from the server.
export const GUEST_RESTRICTION_MINUTES_BY_STRIKE = [1, 15, 120, 1440] as const;
export const GUEST_SAVE_RESET_STRIKE = 5;
