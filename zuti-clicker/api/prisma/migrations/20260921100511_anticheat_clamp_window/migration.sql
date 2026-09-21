-- AddAntiCheatClampWindow
-- Additive only: one new nullable column on an already-deployed table, read
-- by no currently-running API build — safe for the unattended deploy.

-- Anchors the rolling 24h window recordSoftClamp() counts materially-over-
-- bound clamps within. NULL until a player's first material clamp, same as
-- restrictedUntil's "NULL means never happened" convention. Deliberately
-- separate from lastCleanAt: a soft clamp already neutralizes the gain (the
-- server writes the bounded value, nothing is ever lost to the attacker), so
-- it must no longer reset the 30-day strike-decay anchor the way it used to.
ALTER TABLE `AntiCheatState`
  ADD COLUMN `softClampWindowStartedAt` DATETIME(3) NULL;
