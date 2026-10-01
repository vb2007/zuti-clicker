import { test, expect, type AppHelper } from "./fixtures";
import type { Page } from "@playwright/test";

// Buttons whose visible glyph is intentionally small but whose tap target is
// padded out with a transparent ::before (see UnitCard's .info-btn,
// ToastHost's .toast-close) — measured by their box alone they'd look small.
const PADDED_TARGETS = [".info-btn", ".toast-close"];

async function undersized(page: Page): Promise<string[]> {
  // One-shot entrance animations (fade-scale-in menus, sliding rails) change
  // the measured box mid-flight; wait for them to land.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" || (a.effect?.getComputedTiming().iterations ?? 1) === Infinity
      )
  );
  return page.evaluate((exempt) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      "button, [role=tab], input[type=range]"
    )) {
      if (exempt.some((sel) => el.matches(sel))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Skip anything off-screen (a sheet parked below the fold, scrolled-out rows).
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)
        continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (r.height < 43.5)
        out.push(
          `${el.tagName.toLowerCase()}.${el.className.toString().split(" ")[0]} ${Math.round(r.width)}x${Math.round(r.height)}`
        );
    }
    return [...new Set(out)];
  }, PADDED_TARGETS);
}

test.describe("touch targets are at least 44px", () => {
  test.use({ loggedIn: true });

  async function start(app: AppHelper, page: Page) {
    test.skip(
      !(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)),
      "touch devices only"
    );
    await app.open();
    await app.seed((s) => {
      s.game.tokens = 1e15;
      s.game.totalTokensEarned = 1e18;
      s.game.phdCount = 5;
    });
  }

  test("main screen (header, rails, tab bar)", async ({ app, page }) => {
    await start(app, page);
    if (page.viewportSize()!.width < 760) {
      // Rails are sheets here: check the closed shell, then each open sheet.
      expect(await undersized(page)).toEqual([]);
      for (const i of [0, 1]) {
        await page.locator(".mobile-tab-bar .tab-btn").nth(i).click();
        await app.settle();
        expect(await undersized(page), `sheet ${i}`).toEqual([]);
        await page.locator(".mobile-tab-bar .tab-btn").nth(i).click();
      }
    } else {
      expect(await undersized(page)).toEqual([]);
    }
  });

  test("upgrades tab and user menu", async ({ app, page }) => {
    await start(app, page);
    if (page.viewportSize()!.width < 760)
      await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
    await page.locator("#shop-tab-upgrades").click();
    await app.settle();
    expect(await undersized(page)).toEqual([]);
    if (page.viewportSize()!.width < 760) await page.keyboard.press("Escape");
    await page.locator(".user-btn").click();
    expect(await undersized(page)).toEqual([]);
  });
});
