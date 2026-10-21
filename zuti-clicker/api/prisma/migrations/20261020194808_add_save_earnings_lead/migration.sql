-- AddSaveEarningsLead
-- Additive only: one NOT NULL column with a default, which the deployed API
-- neither reads nor writes.
--
-- The grace lead (graceLeadSecs) charges playtime and clicks; earnings are
-- only measured so far. This is the same lead with the earnings bound
-- drawing on it too, kept alongside but never enforced: a save that would
-- have put it past SAVE_LEAD_CAP_SECS is logged (lead_earnings_would_refuse),
-- which is what switching SAVE_LEAD_ENFORCE_EARNINGS on is decided from.
ALTER TABLE `GameSave`
    ADD COLUMN `earningsLeadSecs` DOUBLE NOT NULL DEFAULT 0;
