import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Guests and the account boundary on every device class: a guest can't
// prestige (the panel sends them to log in), is reminded at PhD milestones,
// logging out starts a fresh guest, and an account's refused first save asks
// what to do. Logic lives in Vitest; this suite owns layout and real input.

const coarse = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches);
const compact = (page: Page) => page.viewportSize()!.width < 760;
const MIN_TARGET = 44;

/** On a phone the Prestige panel lives in the stats sheet. */
async function showPrestigePanel(page: Page) {
  if (compact(page)) await page.locator(".mobile-tab-bar .tab-btn").nth(0).click();
  await expect(page.locator(".prestige-panel")).toBeVisible();
}

async function expectOnScreen(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  return box;
}

test.describe("guest", () => {
  test.use({ loggedIn: false });

  test("a ready guest's prestige button asks to log in and opens the login dialog", async ({
    app,
    page
  }) => {
    await app.open();
    await app.dismissGuestWarning();
    await app.seed((s) => {
      s.game.totalTokensEarned = 4e6;
      s.game.runTokensEarned = 4e6;
    });
    await showPrestigePanel(page);
    const btn = page.locator(".prestige-btn");
    await expect(btn).toContainText("Log in to defend");
    await expect(btn).toContainText("×2");
    await expect(page.locator(".prestige-panel .guest-note")).toBeVisible();
    expect(await app.horizontalOverflow([".prestige-panel"])).toEqual([]);

    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await expect(page.locator(".modal-tabs")).toBeVisible();
    await expect(page.locator(".prestige-confirm, .btn-confirm")).toHaveCount(0);
    expect(await app.seed((s) => s.game.prestigeCount)).toBe(0);
  });

  test("the milestone reminder toast is on screen and its button opens the login dialog", async ({
    app,
    page
  }) => {
    await app.open();
    await app.dismissGuestWarning();
    await app.seed((s) => {
      s.game.runTokensEarned = 1e6;
    });
    const toast = page.locator(".toast-item.info");
    await expect(toast).toBeVisible();
    await app.settle();
    await expectOnScreen(page, ".toast-item.info");
    const action = toast.locator(".toast-action");
    if (await coarse(page)) {
      const box = (await action.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect(await app.horizontalOverflow()).toEqual([]);
    await action.click();
    await expect(page.locator(".modal-tabs")).toBeVisible();
    await expect(toast).toHaveCount(0);
  });
});

test.describe("account boundary", () => {
  test.use({ loggedIn: true });

  test("logging out saves first, then starts a fresh guest", async ({ app, page }) => {
    const puts: number[] = [];
    await page.route("**/api/save", (route) => {
      if (route.request().method() === "PUT") {
        puts.push((route.request().postDataJSON() as { tokens: number }).tokens);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "ok", savedAt: new Date().toISOString() })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ save: null })
      });
    });
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"message":"ok"}' })
    );
    await app.open();
    await app.seed((s) => {
      s.game.tokens = 1234;
      s.game.totalTokensEarned = 5000;
    });
    await page.locator(".user-btn").click();
    await page.locator(".dropdown-item", { hasText: "Log out" }).click();
    await expect(page.locator(".save-guest-btn")).toBeVisible();
    expect(puts).toEqual([1234]);
    expect(await app.seed((s) => [s.game.tokens, s.game.totalTokensEarned])).toEqual([0, 0]);
  });

  test("a refused first save asks what to do, can't be dismissed, and keeps the progress as a guest", async ({
    app,
    page
  }) => {
    await page.route("**/api/save", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              code: "save_first_unverifiable",
              error: "The progress you made before creating this account could not be verified."
            })
          })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ save: null })
          })
    );
    await page.route("**/api/auth/logout", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"message":"ok"}' })
    );
    await app.open();
    await app.seed((s) => {
      s.game.tokens = 777;
      s.game.totalTokensEarned = 900;
      void s.save.sync();
    });
    const dialog = page.locator("[role='alertdialog']", {
      hasText: "couldn't move to this account"
    });
    await expect(dialog).toBeVisible();
    await app.settle();

    const buttons = dialog.locator(".modal-actions button");
    await expect(buttons).toHaveCount(2);
    for (const i of [0, 1]) {
      const box = (await buttons.nth(i).boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
      if (await coarse(page)) expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect(await app.horizontalOverflow()).toEqual([]);

    await page.keyboard.press("Escape");
    await page.goBack().catch(() => undefined);
    await page.waitForTimeout(150);
    await expect(dialog).toBeVisible();

    await buttons.nth(0).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".save-guest-btn")).toBeVisible();
    expect(await app.seed((s) => s.game.tokens)).toBe(777);
  });
});
