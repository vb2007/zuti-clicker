-- AddUpgraderColumns
-- Additive only: both columns are NOT NULL DEFAULT 0, so the currently
-- deployed API (which never selects or writes them) keeps working unchanged
-- and every pre-existing row is correct as-is (nobody has spun yet) — safe
-- for the unattended deploy.

-- Upgrader (PhD gamble) state. Written ONLY by POST /upgrader/spin, never by
-- PUT /save. `upgraderNet` is the signed sum of (payout - stake) across every
-- spin: the save plausibility envelope adds it to its PhD bound so a win is
-- not mistaken for forged PhDs. `upgraderSeq` is the spin counter and doubles
-- as PUT /save's stale-write guard, so a save that was already in flight (or
-- a second tab) cannot resurrect PhDs a later spin removed.
ALTER TABLE `GameSave`
    ADD COLUMN `upgraderNet` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `upgraderSeq` INTEGER NOT NULL DEFAULT 0;
