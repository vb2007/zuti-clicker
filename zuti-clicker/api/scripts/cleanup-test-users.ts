/**
 * Deletes users created by the Jest test suite (see src/constants/test-data.ts:
 * generateUser()), which runs against a live server and leaves permanent rows.
 *
 * SAFETY: this is designed to run against a database with real player data. SQL
 * (`LIKE` / `startsWith`) is used only as a coarse prefilter to keep the query
 * cheap — it is NEVER the authority on who gets deleted. The final victim list
 * is decided by a strict JavaScript regex matching generateUser()'s output
 * exactly, re-asserted immediately before any write.
 *
 * Usage (run from zuti-clicker/api):
 *   pnpm cleanup:test-users                       # dry run (default)
 *   pnpm cleanup:test-users --apply                # actually delete
 *   pnpm cleanup:test-users --apply --older-than-hours=1
 */
import { prisma } from "../src/database/prisma";

// Must match TestData.generateUser(): `test_${Math.random().toString(36).slice(2, 10)}`
const TEST_EMAIL = /^test_[a-z0-9]{8}@example\.com$/;
const MAX_DELETIONS = 500; // blast-radius fuse

const apply = process.argv.includes("--apply");
const olderThanHoursArg = process.argv.find((a) => a.startsWith("--older-than-hours="));
const olderThanHours = Number(olderThanHoursArg?.split("=")[1] ?? "0");

async function main(): Promise<void> {
  console.log(
    `Target: ${process.env.DATABASE_USER}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`
  );
  console.log(apply ? "MODE: APPLY (rows will be deleted)" : "MODE: DRY RUN (nothing will be deleted)");

  // Coarse SQL prefilter only — `_` is a LIKE wildcard in MySQL/MariaDB, and
  // Prisma's `startsWith`/`endsWith` do not escape it, so this alone could
  // over-match. The regex below is what actually decides.
  const candidates = await prisma.user.findMany({
    where: { email: { endsWith: "@example.com" }, username: { startsWith: "test_" } },
    select: { id: true, email: true, username: true, createdAt: true }
  });

  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const victims = candidates.filter((u) => TEST_EMAIL.test(u.email) && u.createdAt <= cutoff);

  // Belt and braces: refuse to proceed if anything slipped through the regex.
  if (!victims.every((u) => TEST_EMAIL.test(u.email))) {
    throw new Error("Refusing to delete: a candidate failed the strict email pattern.");
  }

  console.log(`Candidates from SQL prefilter: ${candidates.length}`);
  console.log(`Matching /${TEST_EMAIL.source}/ and age filter: ${victims.length}`);
  for (const u of victims) {
    console.log(`  #${u.id} ${u.email} (created ${u.createdAt.toISOString()})`);
  }

  if (victims.length === 0) {
    console.log("Nothing to delete.");
    return;
  }
  if (victims.length > MAX_DELETIONS) {
    throw new Error(`Refusing to delete ${victims.length} users (fuse: ${MAX_DELETIONS}).`);
  }

  const ids = victims.map((u) => u.id);

  // Count-first so the dry run reports exactly what --apply would remove.
  const [saves, careerNodes, settingsRows, auths] = await Promise.all([
    prisma.gameSave.count({ where: { userId: { in: ids } } }),
    // Reported only — CareerNodeSave cascades from GameSave like UnitSave.
    prisma.careerNodeSave.count({ where: { gameSave: { userId: { in: ids } } } }),
    prisma.userSettings.count({ where: { userId: { in: ids } } }),
    prisma.authentication.count({ where: { userId: { in: ids } } })
  ]);
  console.log(
    `Would delete: ${auths} auth row(s), ${saves} save(s) (+cascaded units, ` +
      `${careerNodes} career node(s)), ` +
      `${settingsRows} settings row(s), ${ids.length} user(s)`
  );

  if (!apply) {
    console.log("Dry run complete. Re-run with --apply to delete.");
    return;
  }

  // Authentication and GameSave have ON DELETE RESTRICT on User (see the init
  // migration), so their rows must be removed before User itself. UnitSave
  // and CareerNodeSave cascade from GameSave. UserSettings cascades from User, but is deleted
  // explicitly first so this script stays correct even if that FK ever changes.
  await prisma.$transaction([
    prisma.gameSave.deleteMany({ where: { userId: { in: ids } } }),
    prisma.userSettings.deleteMany({ where: { userId: { in: ids } } }),
    prisma.authentication.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } })
  ]);
  console.log(`Deleted ${ids.length} test user(s).`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
