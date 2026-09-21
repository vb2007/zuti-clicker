/**
 * Resets AntiCheatState — clears every strike/restriction/suspicion/soft-
 * clamp accumulator on every account that has one — after a round of
 * anti-cheat false-positive fixes (see docs/developer/final.md's "Anti-cheat
 * modell" section for the incidents this follows). NEVER touches
 * AntiCheatEvent: that append-only audit log is the evidence trail these
 * fixes were derived from and the baseline for verifying they worked, and
 * this project's cleanup-test-users.ts precedent is exactly this — clear
 * derived/accumulated state, keep the log.
 *
 * SAFETY: this is designed to run against a database with real player data.
 * Unlike cleanup-test-users.ts, there is no username/email pattern to
 * distinguish "real" from "should be reset" rows here — a false-positive
 * fix is meant to clear EVERY account's accumulated state, not a filtered
 * subset — so the only guards are dry-run by default, a printed
 * before/after diff of every row touched, and a blast-radius fuse.
 *
 * Usage (run from zuti-clicker/api):
 *   pnpm reset:anticheat-state                # dry run (default)
 *   pnpm reset:anticheat-state --apply         # actually reset
 */
import { prisma } from "../src/database/prisma";

const MAX_CHANGES = 500; // blast-radius fuse

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log(
    `Target: ${process.env.DATABASE_USER}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`
  );
  console.log(apply ? "MODE: APPLY (rows will be reset)" : "MODE: DRY RUN (nothing will be reset)");

  // Any row with SOME non-default accumulated state — a clean row (never
  // struck, never clamped) is already a no-op and skipped entirely.
  const candidates = await prisma.antiCheatState.findMany({
    where: {
      OR: [
        { strikeCount: { gt: 0 } },
        { restrictedUntil: { not: null } },
        { suspicionScore: { gt: 0 } },
        { softClampCount: { gt: 0 } },
        { highRateWindows: { gt: 0 } }
      ]
    }
  });

  console.log(`Rows with non-default state: ${candidates.length}`);
  for (const s of candidates) {
    console.log(
      `  userId=${s.userId} strikeCount=${s.strikeCount} restrictedUntil=${s.restrictedUntil?.toISOString() ?? "null"} ` +
        `suspicionScore=${s.suspicionScore} softClampCount=${s.softClampCount} highRateWindows=${s.highRateWindows}`
    );
  }

  if (candidates.length === 0) {
    console.log("Nothing to reset.");
    return;
  }
  if (candidates.length > MAX_CHANGES) {
    throw new Error(`Refusing to reset ${candidates.length} rows (fuse: ${MAX_CHANGES}).`);
  }

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to reset.");
    return;
  }

  const now = new Date();
  const ids = candidates.map((s) => s.id);
  await prisma.antiCheatState.updateMany({
    where: { id: { in: ids } },
    data: {
      strikeCount: 0,
      restrictedUntil: null,
      lastStrikeAt: null,
      lastStrikeReason: null,
      lastCleanAt: now,
      suspicionScore: 0,
      softClampCount: 0,
      softClampWindowStartedAt: null,
      highRateWindows: 0
    }
  });
  console.log(`Reset ${ids.length} AntiCheatState row(s). AntiCheatEvent was not touched.`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
