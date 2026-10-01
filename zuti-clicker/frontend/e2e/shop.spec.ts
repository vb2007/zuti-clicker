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
    test("the upgrades grid fits its panel, and tiles stay inside their column", async ({
      app,
      page
    }) => {
      await openShop(app, page);
      await page.locator("#shop-tab-upgrades").click();
      await expect(page.locator(".upgrade-grid").first()).toBeVisible();
      await app.settle();

      expect(
        await app.horizontalOverflow([".units-list", ".upgrade-grid", ".units-panel"])
      ).toEqual([]);
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const tile of document.querySelectorAll<HTMLElement>(".upgrade-tile")) {
          const grid = tile.closest(".upgrade-grid")!.getBoundingClientRect();
          const r = tile.getBoundingClientRect();
          if (r.right > grid.right + 0.5 || r.left < grid.left - 0.5)
            out.push(tile.textContent!.trim());
          for (const part of tile.children) {
            const p = part.getBoundingClientRect();
            if (p.right > r.right + 0.5 || p.left < r.left - 0.5)
              out.push(`text overflows: ${part.textContent}`);
          }
        }
        return out;
      });
      expect(bad).toEqual([]);
    });

    // Tiles must stay wide enough to read: a name never truncated to "Overhea d…" because the
    // rail (narrowed to ~232px on tablets) was divided into columns too narrow for it.
    test("upgrade tiles are readable: not squeezed, no name cut off", async ({ app, page }) => {
      await openShop(app, page);
      await page.locator("#shop-tab-upgrades").click();
      await expect(page.locator(".upgrade-grid").first()).toBeVisible();
      await app.settle();
      const g = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll<HTMLElement>(".upgrade-tile")];
        const narrowest = Math.min(...tiles.map((t) => t.getBoundingClientRect().width));
        const cut = tiles
          .map((t) => t.querySelector<HTMLElement>(".tile-name")!)
          .filter((n) => n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1)
          .map((n) => n.textContent!.trim());
        return { narrowest, cut };
      });
      expect(g.narrowest).toBeGreaterThanOrEqual(66);
      expect(g.cut).toEqual([]);
    });

    test("the units list fits its panel", async ({ app, page }) => {
      await openShop(app, page);
      expect(await app.horizontalOverflow([".units-list", ".units-panel", ".unit-card"])).toEqual(
        []
      );
    });
  });
}
