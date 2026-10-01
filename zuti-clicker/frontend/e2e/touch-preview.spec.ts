import { test, expect, type AppHelper } from "./fixtures";
import type { Page } from "@playwright/test";

const compact = (page: Page) => page.viewportSize()!.width < 760;
const coarse = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches);

async function openUpgrades(app: AppHelper, page: Page) {
  test.skip(!(await coarse(page)), "touch devices only");
  await app.open();
  await app.dismissGuestWarning();
  await app.seed((s) => {
    s.game.tokens = 1e15;
    s.game.totalTokensEarned = 1e18;
  });
  if (compact(page)) await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
  await page.locator("#shop-tab-upgrades").click();
  await expect(page.locator(".upgrade-tile").first()).toBeVisible();
  await app.settle();
}

// Playwright's touchscreen only taps; a hold needs raw touch events.
async function hold(page: Page, x: number, y: number, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// Scrolled to the middle of the list first: in phone landscape the first tile can sit
// right at the bottom edge, under the tab bar, where a touch would hit the bar instead.
// A human tap lasts ~100-150ms; Playwright's own touchscreen.tap() is instantaneous, which
// would hide a long-press threshold set too low.
const humanTap = (page: Page, x: number, y: number) => hold(page, x, y, 120);

const center = async (page: Page, sel: string) => {
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  const b = (await page.locator(sel).first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test.describe("upgrade tiles on touch", () => {
  test.use({ loggedIn: false });

  test("holding a tile previews it and does not buy it", async ({ app, page }) => {
    await openUpgrades(app, page);
    const { x, y } = await center(page, ".upgrade-tile");
    const ownedBefore = await app.seed((s) => s.game.ownedUpgrades.length);

    await hold(page, x, y, 700);
    await expect(page.locator(".tooltip")).toBeVisible();
    await expect(page.locator(".tooltip")).toContainText(/\S/);
    // …fully on-screen
    const tip = (await page.locator(".tooltip").boundingBox())!;
    const vp = page.viewportSize()!;
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(vp.width);
    expect(tip.y).toBeGreaterThanOrEqual(0);
    expect(tip.y + tip.height).toBeLessThanOrEqual(vp.height);

    const ownedAfter = await app.seed((s) => s.game.ownedUpgrades.length);
    expect(ownedAfter).toBe(ownedBefore);
  });

  // The requirement that matters: spamming buy with fast taps must never turn into a preview.
  test("rapid tapping buys every tile it taps, with no preview", async ({ app, page }) => {
    await openUpgrades(app, page);
    // Tap the first tile of each family quickly, as fast as Playwright can issue taps.
    const firstOfEach = await page.locator(".upgrade-grid").evaluateAll((grids) =>
      grids.map((g) => g.querySelector<HTMLElement>(".upgrade-tile")?.textContent ?? "")
    );
    expect(firstOfEach.length).toBeGreaterThan(1);

    const bought: number[] = [];
    for (let i = 0; i < firstOfEach.length; i++) {
      const grid = page.locator(".upgrade-grid").nth(0); // the first grid shrinks as tiles are bought
      const tile = grid.locator(".upgrade-tile").first();
      await tile.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const b = (await tile.boundingBox())!;
      const before = await page.locator(".upgrade-tile").count();
      await humanTap(page, b.x + b.width / 2, b.y + b.height / 2);
      await expect(page.locator(".upgrade-tile")).toHaveCount(before - 1); // it left the buy grid
      bought.push(i);
      await expect(page.locator(".tooltip")).toHaveCount(0);
    }
    expect(bought).toHaveLength(firstOfEach.length);
  });

  test("an unaffordable (locked) tile can still be previewed by holding it", async ({ app, page }) => {
    await openUpgrades(app, page);
    await app.seed((s) => void (s.game.tokens = 0));
    await expect(page.locator(".upgrade-tile[aria-disabled='true']").first()).toBeVisible();
    const { x, y } = await center(page, ".upgrade-tile[aria-disabled='true']");
    await hold(page, x, y, 700);
    await expect(page.locator(".tooltip")).toBeVisible();
  });

  test("tapping elsewhere dismisses the preview", async ({ app, page }) => {
    await openUpgrades(app, page);
    const { x, y } = await center(page, ".upgrade-tile");
    await hold(page, x, y, 700);
    await expect(page.locator(".tooltip")).toBeVisible();
    const vp = page.viewportSize()!;
    // A press somewhere not on a tile: the panel header area / empty space.
    await page.touchscreen.tap(vp.width - 4, 4);
    await expect(page.locator(".tooltip")).toHaveCount(0);
  });
});

test.describe("unit info tooltip on touch", () => {
  test("tapping the (i) of a unit near the bottom opens a tooltip that stays on screen", async ({ app, page }) => {
    test.skip(!(await coarse(page)), "touch devices only");
    await app.open();
    await app.dismissGuestWarning();
    await app.seed((s) => {
      s.game.tokens = 1e15;
      s.game.totalTokensEarned = 1e18;
    });
    if (compact(page)) await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
    await app.settle();

    // The last unit the viewport shows — the one most likely to run the tooltip off the bottom.
    const infos = page.locator(".info-btn");
    const n = await infos.count();
    let target = infos.first();
    const vp = page.viewportSize()!;
    for (let i = 0; i < n; i++) {
      const b = await infos.nth(i).boundingBox();
      if (b && b.y + b.height < vp.height - 70) target = infos.nth(i);
    }
    await target.scrollIntoViewIfNeeded();
    const b = (await target.boundingBox())!;
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator(".tooltip")).toBeVisible();
    await app.settle();

    const tip = (await page.locator(".tooltip").boundingBox())!;
    expect(tip.y).toBeGreaterThanOrEqual(0);
    expect(tip.y + tip.height).toBeLessThanOrEqual(vp.height);
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.width).toBeLessThanOrEqual(vp.width);
  });
});
