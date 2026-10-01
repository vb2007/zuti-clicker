import { test, expect, type AppHelper } from "./fixtures";
import type { Page } from "@playwright/test";

type ModalCase = {
  name: string;
  open: (app: AppHelper) => Promise<void>;
  // Closed by ✕ (and Back); the alert-style modals have their own buttons.
};

const CASES: ModalCase[] = [
  {
    name: "leaderboard",
    open: (app) => app.seed((s) => void (s.ui.leaderboardModalOpen = true))
  },
  {
    name: "settings",
    open: (app) => app.seed((s) => void (s.ui.settingsModalOpen = true))
  },
  {
    name: "auth",
    open: async (app) => {
      await app.dismissGuestWarning();
      await app.seed((s) => void (s.ui.authModalOpen = true));
    }
  },
  {
    name: "upgrader",
    open: (app) =>
      app.seed((s) => {
        s.game.phdCount = 50;
        s.ui.upgraderOpen = true;
      })
  }
];

const modalOf = (page: Page) => page.locator(".base-modal");
const sentinelActive = (page: Page) =>
  page.evaluate(() => Boolean((history.state as Record<string, unknown> | null)?.zutiOverlay));

test.describe("closable modals", () => {
  test.use({ loggedIn: true });

  for (const c of CASES) {
    test.describe(c.name, () => {
      test("✕ is visible, comfortably tappable, and closes it", async ({ app, page }, info) => {
        await app.open();
        await c.open(app);
        const modal = modalOf(page);
        await expect(modal).toBeVisible();
        await app.settle();

        const close = modal.getByRole("button", { name: /^(close|bezárás)$/i });
        await expect(close).toBeVisible();
        const box = (await close.boundingBox())!;
        // 44px is the touch minimum; fine pointers may use a slightly smaller target.
        const min = info.project.use.hasTouch ? 44 : 36;
        expect(box.width).toBeGreaterThanOrEqual(min);
        expect(box.height).toBeGreaterThanOrEqual(min);

        // The ✕ must lie inside the viewport.
        const vp = page.viewportSize()!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);

        await close.click();
        await expect(modal).toHaveCount(0);
        // The history sentinel pushed for Back handling is consumed again.
        await expect.poll(() => sentinelActive(page)).toBe(false);
      });

      test("the Back button closes it and stays in the game", async ({ app, page }) => {
        await app.open();
        await c.open(app);
        await expect(modalOf(page)).toBeVisible();

        await page.goBack();
        await expect(modalOf(page)).toHaveCount(0);
        await expect(page.locator(".app")).toBeVisible();
        expect(new URL(page.url()).pathname).toBe("/");
      });
    });
  }

  test("leaderboard: tapping the backdrop closes it", async ({ app, page }) => {
    await app.open();
    await app.seed((s) => void (s.ui.leaderboardModalOpen = true));
    await expect(modalOf(page)).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(modalOf(page)).toHaveCount(0);
  });

  test("Back closes only the top-most of two stacked overlays", async ({ app, page }) => {
    await app.open();
    // Opened one after the other, like a player would (the second can't be
    // reached while the first's backdrop is up in the real UI, so any order
    // of registration is this one).
    await app.seed((s) => void (s.ui.settingsModalOpen = true));
    await expect(modalOf(page)).toHaveCount(1);
    await app.seed((s) => void (s.ui.confirmDeleteOpen = true));
    await expect(modalOf(page)).toHaveCount(2);

    await page.goBack();
    await expect(modalOf(page)).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: /settings|beállítások/i })).toBeVisible();

    await page.goBack();
    await expect(modalOf(page)).toHaveCount(0);
  });
});

// Hungarian strings run longer than English — check the layout in both.
for (const language of ["en", "hu"] as const) {
  test.describe(`modals fit the viewport (${language})`, () => {
    test.use({ loggedIn: true, language });

    for (const c of CASES) {
      test(`${c.name}: no clipping or horizontal scrolling`, async ({ app, page }) => {
        await app.open();
        await c.open(app);
        await expect(modalOf(page)).toBeVisible();
        await app.settle();
        const vp = page.viewportSize()!;
        const box = (await modalOf(page).boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
        expect(
          await app.horizontalOverflow([
            ".base-modal",
            ".base-modal .seg-group",
            ".base-modal .field-row",
            ".base-modal .stake-row",
            ".base-modal .board-row",
            ".base-modal .outcomes"
          ])
        ).toEqual([]);
      });
    }
  });
}
