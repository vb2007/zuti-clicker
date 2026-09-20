import { Prisma } from "../../generated/prisma/client";

// Prisma codes worth retrying: P2034 is a transaction write conflict/deadlock
// (MariaDB's InnoDB reporting "Deadlock found" or a lock-wait timeout back
// through the driver adapter), and P2002 is a unique-constraint violation —
// both can happen legitimately when two upsertSave() calls for the SAME user
// race each other (two tabs autosaving, or a manual "Sync" click landing
// mid-autosave). Neither indicates bad input; retrying the whole transaction
// is correct because upsertSave is idempotent for a given payload.
const RETRYABLE_CODES = new Set(["P2034", "P2002"]);
const MAX_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jittered backoff: exact delays don't matter (the transaction itself is
// only a few milliseconds), just spreading the two racing callers apart so
// the second one doesn't immediately re-collide with the first retry.
function backoffMs(attempt: number): number {
  const base = attempt === 1 ? 25 : 50;
  return base + Math.random() * base;
}

// Retries `fn` up to MAX_ATTEMPTS times when it fails with a retryable
// Prisma write-conflict error. A non-retryable error, or the last attempt's
// error, propagates unchanged — callers keep their existing catch/500
// handling exactly as before this wrapper existed.
export async function withWriteConflictRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
      await sleep(backoffMs(attempt));
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TypeScript's
  // control-flow analysis happy without an assertion.
  throw lastError;
}
