-- Completely erase (cascade delete) a user and all their data from the database.

SET @user_id = 0; -- <-- fill in the user id to delete

START TRANSACTION;

-- Preview what this will remove.
SELECT *
FROM zutiClicker.`User`
WHERE `id` = @user_id;

SELECT *
FROM zutiClicker.`Authentication`
WHERE `userId` = @user_id;

SELECT *
FROM zutiClicker.`GameSave`
WHERE `userId` = @user_id;

SELECT zutiClicker.`UnitSave`.*
FROM zutiClicker.`UnitSave`
JOIN zutiClicker.`GameSave` ON zutiClicker.`GameSave`.`id` = zutiClicker.`UnitSave`.`gameSaveId`
WHERE zutiClicker.`GameSave`.`userId` = @user_id;

SELECT *
FROM zutiClicker.`UserSettings`
WHERE `userId` = @user_id;

-- Delete children with a RESTRICT FK first; CASCADE FKs (UnitSave via
-- GameSave, UserSettings via User) are handled by the database itself.
DELETE FROM zutiClicker.`Authentication` WHERE `userId` = @user_id;
DELETE FROM zutiClicker.`GameSave` WHERE `userId` = @user_id;
DELETE FROM zutiClicker.`User` WHERE `id` = @user_id;

-- Verify the user is gone before committing.
SELECT *
FROM zutiClicker.`User`
WHERE `id` = @user_id;

-- Review the output above, then either:
COMMIT;
-- ROLLBACK;
