import { test, expect } from "./fixtures";

for (const language of ["en", "hu"] as const) {
  test.describe(`prestige ceremony (${language})`, () => {
    test.use({ language });

    test("a big gain fits, and Continue is reachable and dismisses it", async ({ app, page }) => {
      await app.open();
      await app.dismissGuestWarning();
      await app.seed((s) => {
        s.ui.lastPrestigeGain = 1234567;
        s.ui.prestigeCeremonyOpen = true;
      });

      const cont = page.locator(".continue-btn");
      await expect(cont).toBeVisible(); // visibility flips once the count-up settles
      // Grouping separator is locale-specific (comma in EN, a non-breaking space in HU).
      await expect(page.locator(".gain-number")).toHaveText(/^\+1\D234\D567$/);

      // The gain number never overflows the screen width.
      const vp = page.viewportSize()!;
      const num = (await page.locator(".gain-number").boundingBox())!;
      expect(num.x).toBeGreaterThanOrEqual(0);
      expect(num.x + num.width).toBeLessThanOrEqual(vp.width);
      expect(await app.horizontalOverflow([".ceremony-backdrop"])).toEqual([]);

      // Continue can be scrolled into view and is not covered (phone landscape
      // has less height than the content, so it may need scrolling).
      await cont.scrollIntoViewIfNeeded();
      const box = (await cont.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      expect(box.height).toBeGreaterThanOrEqual(44);

      await cont.click();
      await expect(page.locator(".ceremony-backdrop")).toHaveCount(0);
    });

    test("Continue's arrival does not move the content", async ({ app, page }) => {
      await app.open();
      await app.dismissGuestWarning();
      await app.seed((s) => {
        s.ui.lastPrestigeGain = 42;
        s.ui.prestigeCeremonyOpen = true;
      });
      const num = page.locator(".gain-number");
      await expect(num).toBeVisible();
      const before = (await num.boundingBox())!;
      await expect(page.locator(".continue-btn")).toBeVisible();
      const after = (await num.boundingBox())!;
      expect(after.y).toBeCloseTo(before.y, 0);
    });
  });
}

test("Back continues past the ceremony (once offered) and stays in the game", async ({ app, page }) => {
  await app.open();
  await app.dismissGuestWarning();
  await app.seed((s) => {
    s.ui.lastPrestigeGain = 7;
    s.ui.prestigeCeremonyOpen = true;
  });
  await expect(page.locator(".continue-btn")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".ceremony-backdrop")).toHaveCount(0);
  await expect(page.locator(".app")).toBeVisible();
});
