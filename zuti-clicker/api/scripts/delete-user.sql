-- Deletes a single user and everything that references them.
--
-- Fill in the user id below, then run the whole file. `UserSettings` and
-- `UnitSave` carry `ON DELETE CASCADE` (see prisma/schema.prisma) so the
-- database removes those rows on its own; `Authentication` and `GameSave`
-- are `ON DELETE RESTRICT`, so they're deleted explicitly here, in
-- child-to-parent order, before the `User` row itself.
--
-- Review the preview SELECTs before trusting the COMMIT.

SET @user_id = 0; -- <-- fill in the user id to delete

START TRANSACTION;

-- Preview what this will remove.
SELECT *
FROM `User`
WHERE `id` = @user_id;

SELECT *
FROM `Authentication`
WHERE `userId` = @user_id;

SELECT *
FROM `GameSave`
WHERE `userId` = @user_id;

SELECT `UnitSave`.*
FROM `UnitSave`
JOIN `GameSave` ON `GameSave`.`id` = `UnitSave`.`gameSaveId`
WHERE `GameSave`.`userId` = @user_id;

SELECT *
FROM `UserSettings`
WHERE `userId` = @user_id;

-- Delete children with a RESTRICT FK first; CASCADE FKs (UnitSave via
-- GameSave, UserSettings via User) are handled by the database itself.
DELETE FROM `Authentication` WHERE `userId` = @user_id;
DELETE FROM `GameSave` WHERE `userId` = @user_id;
DELETE FROM `User` WHERE `id` = @user_id;

-- Verify the user is gone before committing.
SELECT *
FROM `User`
WHERE `id` = @user_id;

-- Review the output above, then either:
COMMIT;
-- ROLLBACK;
