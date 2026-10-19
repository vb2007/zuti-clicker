-- AddAcademicCareer
-- Additive only: every new GameSave column is NOT NULL DEFAULT, and
-- CareerNodeSave is an optional 1:N child of GameSave that the currently
-- deployed API neither reads nor writes — it keeps working unchanged, safe
-- for the unattended deploy.

-- Academic Career state on GameSave. Written by POST /career/* (phdInvested,
-- the window) and by every writer of phdCount (phdTotal). `phdTotal` is the
-- "phd" leaderboard metric: held + invested PhDs, so investing in the tree
-- never costs a player their rank. `careerWindowId` counts purchase windows
-- ever opened; a window is opened only by PUT /save on a detected prestige.
ALTER TABLE `GameSave`
    ADD COLUMN `careerWindowId`   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `careerWindowOpen` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `phdInvested`      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `phdTotal`         INTEGER NOT NULL DEFAULT 0;

-- Backfill: nobody has invested yet, so total == held. No purchase window
-- is backfilled — a player who prestiged before this shipped gets their
-- first window with their next prestige.
UPDATE `GameSave` SET `phdTotal` = `phdCount`;

-- Bought tree nodes. Never written by PUT /save. `cost` is what was actually
-- paid (a refund returns exactly that); `boughtInWindow` is the
-- careerWindowId at purchase time — a node is refundable only while that
-- same window is still open. Survives prestige, unlike UnitSave/UpgradeSave.
CREATE TABLE `CareerNodeSave` (
    `id`             INTEGER     NOT NULL AUTO_INCREMENT,
    `gameSaveId`     INTEGER     NOT NULL,
    `nodeId`         VARCHAR(32) NOT NULL,
    `cost`           INTEGER     NOT NULL,
    `boughtInWindow` INTEGER     NOT NULL,
    `boughtAt`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CareerNodeSave_gameSaveId_nodeId_key`(`gameSaveId`, `nodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
-- Supports the "phd" leaderboard's ORDER BY phdTotal DESC LIMIT query. The
-- old phdCount index stays: the still-running old API orders by it during
-- the deploy window, and dropping it would not be additive.
CREATE INDEX `GameSave_phdTotal_idx` ON `GameSave`(`phdTotal`);

-- AddForeignKey
-- Cascade (like UnitSave): a node row is meaningless without its GameSave.
ALTER TABLE `CareerNodeSave` ADD CONSTRAINT `CareerNodeSave_gameSaveId_fkey`
    FOREIGN KEY (`gameSaveId`) REFERENCES `GameSave`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
