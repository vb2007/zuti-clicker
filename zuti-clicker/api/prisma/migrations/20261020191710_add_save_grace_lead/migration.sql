-- AddSaveGraceLead
-- Additive only: one NOT NULL column with a default and one nullable column.
-- The currently deployed API neither reads nor writes either, so it keeps
-- working unchanged in the window before the image swap.
--
-- Why: every save got its own 5 s clock grace (CLOCK_GRACE_SECS), so a script
-- saving ten times a second could claim ~51x real playtime and clicks. The
-- grace now comes out of one budget per save chain: graceLeadSecs is how far
-- the chain's claims run ahead of the server's clock, and a save that would
-- take it past SAVE_LEAD_CAP_SECS is refused (429, never a strike). 0 is
-- exactly right for every existing row: an honest chain never runs ahead.
ALTER TABLE `GameSave`
    ADD COLUMN `graceLeadSecs` DOUBLE NOT NULL DEFAULT 0;

-- When the account's save was last deleted (DELETE /save, or the strike
-- ladder's wipe at strike 5). The next save is a first save again; without
-- this its envelope was anchored at the account's creation, so an old
-- account could wipe its save and claim its whole age as playtime. NULL means
-- "never reset", which is what every existing account's history supports.
ALTER TABLE `User`
    ADD COLUMN `saveResetAt` DATETIME(3) NULL;
