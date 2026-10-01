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
    // …and that second Back was swallowed by the re-armed sentinel: without it the
    // browser would have left the game (to about:blank), which also has no modals.
    await expect(page.locator(".app")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  // Regression: an overlay opened between our own history.back() being requested and it
  // landing was never given a sentinel, so Back left the game. Delays straddle the window.
  for (const delay of [0, 1, 5, 20]) {
    test(`Back still works when an overlay opens ${delay}ms after another closed`, async ({
      app,
      page
    }) => {
      await app.open();
      await app.seed((s) => void (s.ui.settingsModalOpen = true));
      await expect(modalOf(page)).toBeVisible();
      await page.evaluate(
        (d) =>
          new Promise<void>((resolve) => {
            const ui = (
              document.querySelector("#app") as any
            ).__vue_app__.config.globalProperties.$pinia._s.get("ui");
            ui.settingsModalOpen = false;
            setTimeout(() => {
              ui.leaderboardModalOpen = true;
              resolve();
            }, d);
          }),
        delay
      );
      await expect(modalOf(page)).toBeVisible();
      await page.waitForTimeout(150); // let our own history traversal land

      await page.goBack();
      await expect(modalOf(page)).toHaveCount(0);
      await expect(page.locator(".app")).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/");
    });
  }
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

test.describe("upgrader bet controls stay reachable", () => {
  test.use({ loggedIn: true });

  const CONTROLS = ["#upgrader-stake", ".slider", ".spin-btn"];

  // Whatever is topmost at the control's centre must be the control itself: a
  // sticky bar (or the header) sitting over it would fail this.
  async function inViewAndUncovered(page: Page, sel: string) {
    const vp = page.viewportSize()!;
    const el = page.locator(sel);
    const box = (await el.boundingBox())!;
    const covered = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !(top === node || node.contains(top));
    });
    return {
      inView: box.y >= 0 && box.y + box.height <= vp.height,
      covered
    };
  }

  test("every control can be scrolled clear of the sticky bar and header", async ({
    app,
    page
  }) => {
    await app.open();
    await app.seed((s) => {
      s.game.phdCount = 50;
      s.ui.upgraderOpen = true;
    });
    await expect(modalOf(page)).toBeVisible();
    await app.settle();

    for (const sel of CONTROLS) {
      await page.locator(sel).evaluate((el) => el.scrollIntoView({ block: "center" }));
      const r = await inViewAndUncovered(page, sel);
      expect(r, sel).toEqual({ inView: true, covered: false });
    }
  });

  test("phone landscape: the whole bet is in view with no scrolling", async ({ app, page }) => {
    const vp = page.viewportSize()!;
    test.skip(
      !(vp.height <= 500 && vp.width >= 640),
      "only applies to the two-column landscape layout"
    );
    await app.open();
    await app.seed((s) => {
      s.game.phdCount = 50;
      s.ui.upgraderOpen = true;
    });
    await expect(modalOf(page)).toBeVisible();
    await app.settle();

    expect(await modalOf(page).evaluate((el) => el.scrollTop)).toBe(0);
    for (const sel of CONTROLS) {
      expect(await inViewAndUncovered(page, sel), sel).toEqual({ inView: true, covered: false });
    }
  });
});

// Alert-style modals ask a question, so they have explicit buttons rather than
// a ✕ — but they must still fit, stay thumb-sized, and yield to Back.
const ALERTS: { name: string; loggedIn: boolean; open: (app: AppHelper) => Promise<void> }[] = [
  { name: "guest warning", loggedIn: false, open: async () => {} },
  {
    name: "delete-save confirm",
    loggedIn: true,
    open: (app) => app.seed((s) => void (s.ui.confirmDeleteOpen = true))
  },
  {
    name: "prestige confirm",
    loggedIn: false,
    open: async (app) => {
      await app.dismissGuestWarning();
      await app.seed((s) => {
        s.game.runTokensEarned = 1e18;
        s.game.totalTokensEarned = 1e18;
        s.ui.prestigeConfirmOpen = true;
      });
    }
  },
  {
    name: "anti-cheat warning",
    loggedIn: false,
    open: async (app) => {
      await app.dismissGuestWarning();
      await app.seed((s) => {
        s.antiCheat.isRestricted = true;
        s.antiCheat.restrictedUntil = new Date(Date.now() + 600_000);
        s.antiCheat.strikeCount = 3;
      });
    }
  }
];

for (const language of ["en", "hu"] as const) {
  for (const a of ALERTS) {
    test.describe(`${a.name} (${language})`, () => {
      test.use({ loggedIn: a.loggedIn, language });

      test("fits, with 44px buttons on touch and none clipped", async ({ app, page }, info) => {
        await app.open();
        await a.open(app);
        const dialog = page.getByRole("alertdialog");
        await expect(dialog).toBeVisible();
        await app.settle();

        const vp = page.viewportSize()!;
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
        expect(await app.horizontalOverflow([".base-modal"])).toEqual([]);

        // Regression: wrapping the title in the modal header made it shrink to its text and
        // sit at the left of centred modals (guest / anti-cheat), while everything else was centred.
        const centred = page.locator(".base-modal.center-content .modal-title");
        if ((await centred.count()) > 0) {
          const t = (await centred.boundingBox())!;
          expect(Math.abs(t.x + t.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(2);
        }

        const buttons = dialog.getByRole("button");
        const n = await buttons.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
          const b = (await buttons.nth(i).boundingBox())!;
          if (info.project.use.hasTouch) expect(b.height, `button ${i}`).toBeGreaterThanOrEqual(44);
          // A label wrapping to a second line is the symptom of a squeezed row.
          const lines = await buttons.nth(i).evaluate((el) => {
            const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
            return Math.round((el.getBoundingClientRect().height - 16) / lh);
          });
          expect(lines, `button ${i} wraps`).toBeLessThanOrEqual(1);
        }
      });

      test("Back dismisses it", async ({ app, page }) => {
        await app.open();
        await a.open(app);
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await page.goBack();
        await expect(page.getByRole("alertdialog")).toHaveCount(0);
        await expect(page.locator(".app")).toBeVisible();
      });
    });
  }
}

// Regression (review): the two-column split started at 560px wide, where the right column
// left the stake input ~70px — clipping a 6-digit stake. Below 640px the modal stays one column.
test.describe("upgrader stake input is never too narrow to read", () => {
  test.use({ loggedIn: true });
  test("a 7-digit stake is fully visible in the input", async ({ app, page }) => {
    await app.open();
    await app.seed((s) => {
      s.game.phdCount = 2_000_000;
      s.ui.upgraderOpen = true;
    });
    await expect(modalOf(page)).toBeVisible();
    await app.settle();
    const input = page.locator("#upgrader-stake");
    await input.fill("1999999");
    const clipped = await input.evaluate(
      (el: HTMLInputElement) => el.scrollWidth > el.clientWidth + 1
    );
    expect(clipped).toBe(false);
  });
});
