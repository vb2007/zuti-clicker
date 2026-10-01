import { test, expect, type AppHelper } from "./fixtures";
import type { Page } from "@playwright/test";

const compact = (page: Page) => page.viewportSize()!.width < 760;

async function openShop(app: AppHelper, page: Page) {
  await app.open();
  await app.dismissGuestWarning();
  await app.seed((s) => {
    s.game.tokens = 1e15;
    s.game.totalTokensEarned = 1e18;
  });
  if (compact(page)) {
    await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
    await expect(page.locator("#mobile-sheet-units")).toBeVisible();
  }
  await app.settle();
}

for (const language of ["en", "hu"] as const) {
  test.describe(`shop (${language})`, () => {
    test.use({ language });

    // Regression: `repeat(3, 1fr)` is minmax(auto, 1fr), so a tile's long unbreakable
    // word (Hungarian especially) widened its column and scrolled the rail sideways
    // (seen on tablet widths, where the rail is narrowed to ~232px).
    test("the upgrades grid fits its panel, and tiles stay inside their column", async ({ app, page }) => {
      await openShop(app, page);
      await page.locator("#shop-tab-upgrades").click();
      await expect(page.locator(".upgrade-grid").first()).toBeVisible();
      await app.settle();

      expect(await app.horizontalOverflow([".units-list", ".upgrade-grid", ".units-panel"])).toEqual([]);
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const tile of document.querySelectorAll<HTMLElement>(".upgrade-tile")) {
          const grid = tile.closest(".upgrade-grid")!.getBoundingClientRect();
          const r = tile.getBoundingClientRect();
          if (r.right > grid.right + 0.5 || r.left < grid.left - 0.5) out.push(tile.textContent!.trim());
          for (const part of tile.children) {
            const p = part.getBoundingClientRect();
            if (p.right > r.right + 0.5 || p.left < r.left - 0.5) out.push(`text overflows: ${part.textContent}`);
          }
        }
        return out;
      });
      expect(bad).toEqual([]);
    });

    test("the units list fits its panel", async ({ app, page }) => {
      await openShop(app, page);
      expect(await app.horizontalOverflow([".units-list", ".units-panel", ".unit-card"])).toEqual([]);
    });
  });
}
