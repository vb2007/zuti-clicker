import { test, expect } from "./fixtures";

test.describe("main layout smoke", () => {
  test("guest: game renders and the page does not scroll horizontally", async ({ app, page }) => {
    await app.open();
    await app.dismissGuestWarning();
    await expect(page.locator(".clicker-area")).toBeVisible();
    expect(await app.horizontalOverflow()).toEqual([]);
  });
});
