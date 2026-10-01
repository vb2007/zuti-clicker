import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const compact = (page: Page) => page.viewportSize()!.width < 760;

// Regression: the accent border-left appeared only while a unit was affordable, so each
// card shifted 2px sideways every time affordability changed.
test("a unit card's content does not shift when it becomes affordable", async ({ app, page }) => {
  await app.open();
  await app.dismissGuestWarning();
  await app.seed((s) => {
    s.game.tokens = 0;
    s.game.totalTokensEarned = 1e18; // reveal every unit regardless of balance
  });
  if (compact(page)) {
    await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
  }
  await app.settle();
  const name = page.locator(".unit-card .unit-name").first();
  const before = (await name.boundingBox())!.x;
  await expect(page.locator(".unit-card.affordable")).toHaveCount(0);

  await app.seed((s) => void (s.game.tokens = 1e15));
  await expect(page.locator(".unit-card.affordable").first()).toBeVisible();
  await app.settle();
  const after = (await name.boundingBox())!.x;
  expect(after).toBeCloseTo(before, 1);
});
