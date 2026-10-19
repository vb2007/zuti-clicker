-- WidenPhdColumns
-- Widening only: INT -> DOUBLE, the type tokens/totalTokensEarned already
-- use. Every existing value (all within INT range) is preserved exactly, and
-- DOUBLE stores whole numbers exactly up to 2^53 — the same limit a JS number
-- (and so the frontend) has anyway. A BIGINT would surface in the API as a JS
-- bigint, which can't be JSON-serialised or mixed with the economy's numbers.
--
-- Why: phdCount is uncapped and grows roughly quadratically with play time.
-- The balance simulation (frontend/src/utils/__tests__/career-balance.sim.spec.ts)
-- puts an efficient player past 2147483647 PhDs after ~1000 h even without the
-- Academic Career, and after ~175 h with the whole tree — at which point every
-- PUT /save would fail validation and the INT column would refuse the value.
--
-- Safe for the unattended deploy: the still-running old API keeps reading and
-- writing these columns as before (MariaDB hands DOUBLE back as a JS number,
-- and the old code only ever writes whole numbers well inside INT range) —
-- verified by running main's full API suite against a database migrated to
-- this schema. The indexes on phdCount/phdTotal are kept by MODIFY.
ALTER TABLE `GameSave`
    MODIFY `phdCount`    DOUBLE NOT NULL DEFAULT 0,
    MODIFY `upgraderNet` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `phdInvested` DOUBLE NOT NULL DEFAULT 0,
    MODIFY `phdTotal`    DOUBLE NOT NULL DEFAULT 0;

-- The PhDs actually paid for a node — summed into phdInvested, so it widens too.
ALTER TABLE `CareerNodeSave`
    MODIFY `cost` DOUBLE NOT NULL;
