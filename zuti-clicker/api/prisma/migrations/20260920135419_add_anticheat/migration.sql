-- AddAntiCheat
-- Additive only: two brand-new, empty tables, each a 1:N/1:1 child of User —
-- the currently deployed API neither reads nor writes either, so it keeps
-- working unchanged.

-- Per-account strike/restriction state. Created lazily on a user's first
-- soft clamp or strike; most accounts never get a row here at all.
-- `restrictedUntil` is the single gate every write-capable endpoint checks —
-- NULL (not "in the past") means "never restricted, or the restriction has
-- been consumed", so a clean account's common-case check is a cheap NULL
-- test rather than a timestamp comparison. `lastCleanAt` anchors the
-- 30-consecutive-clean-day strike-decay window.
CREATE TABLE `AntiCheatState` (
    `id`               INTEGER     NOT NULL AUTO_INCREMENT,
    `userId`           INTEGER     NOT NULL,
    `strikeCount`      INTEGER     NOT NULL DEFAULT 0,
    `restrictedUntil`  DATETIME(3) NULL,
    `lastStrikeAt`     DATETIME(3) NULL,
    `lastStrikeReason` VARCHAR(64) NULL,
    `lastCleanAt`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `suspicionScore`   INTEGER     NOT NULL DEFAULT 0,
    `softClampCount`   INTEGER     NOT NULL DEFAULT 0,
    `highRateWindows`  INTEGER     NOT NULL DEFAULT 0,
    `updatedAt`        DATETIME(3) NOT NULL,

    UNIQUE INDEX `AntiCheatState_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Append-only audit log of every anti-cheat verdict, including ones
-- suppressed by ANTICHEAT_MODE=monitor — this is what makes the detection
-- thresholds tunable against real traffic instead of guessed at. Never holds
-- game save data itself, only which signals fired and the envelope numbers.
CREATE TABLE `AntiCheatEvent` (
    `id`        INTEGER     NOT NULL AUTO_INCREMENT,
    `userId`    INTEGER     NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `kind`      VARCHAR(32) NOT NULL,
    `severity`  VARCHAR(16) NOT NULL,
    `mode`      VARCHAR(16) NOT NULL,
    `detail`    JSON        NULL,
    `enforced`  BOOLEAN     NOT NULL DEFAULT false,

    INDEX `AntiCheatEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
-- Cascade (like UnitSave/UpgradeSave/ActiveBooster): both tables are
-- meaningless without their parent User, so deleting an account cleans them
-- up too.
ALTER TABLE `AntiCheatState` ADD CONSTRAINT `AntiCheatState_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AntiCheatEvent` ADD CONSTRAINT `AntiCheatEvent_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
