import { test, expect, type AppHelper } from "./fixtures";
import type { Page } from "@playwright/test";

const isCompact = (page: Page) => page.viewportSize()!.width < 760;

for (const language of ["en", "hu"] as const) {
  for (const loggedIn of [false, true]) {
    test.describe(`header (${language}, ${loggedIn ? "logged in" : "guest"})`, () => {
      test.use({ loggedIn, language });

      test("fits its row: nothing clipped, spilled, or off-screen", async ({ app, page }, info) => {
        await app.open();
        await app.dismissGuestWarning();
        await expect(page.locator(".app-header")).toBeVisible();

        const vp = page.viewportSize()!;
        const result = await page.evaluate(() => {
          const header = document.querySelector(".app-header")!;
          const h = header.getBoundingClientRect();
          const problems: string[] = [];
          if (header.scrollHeight > header.clientHeight + 1)
            problems.push("header content taller than header");
          for (const el of header.querySelectorAll<HTMLElement>("button, .brand, .mini-stats")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue; // display: none
            if (r.right > window.innerWidth + 0.5 || r.left < -0.5)
              problems.push(`${el.className} off-screen`);
            if (r.bottom > h.bottom + 0.5 || r.top < h.top - 0.5)
              problems.push(`${el.className} outside header`);
          }
          return { problems, height: h.height };
        });
        expect(result.problems).toEqual([]);

        if (isCompact(page)) {
          // The fixed height the sheets and scrim are positioned against.
          const token = await page.evaluate(() =>
            parseFloat(
              getComputedStyle(document.documentElement).getPropertyValue("--header-h-compact")
            )
          );
          expect(result.height).toBeCloseTo(token, 0);
          // Touch targets.
          const buttons = page.locator(".app-header button:visible");
          for (let i = 0; i < (await buttons.count()); i++) {
            const b = (await buttons.nth(i).boundingBox())!;
            expect(b.height, `header button ${i}`).toBeGreaterThanOrEqual(43.5);
            expect(b.width, `header button ${i}`).toBeGreaterThanOrEqual(43.5);
          }
        }
        // 320px keeps only the buttons that fit; wider screens keep language + theme.
        const langVisible = await page.locator(".lang-btn").isVisible();
        expect(langVisible).toBe(vp.width >= 400);
        void info;
      });
    });
  }
}

test.describe("mobile sheets", () => {
  test.use({ loggedIn: true });

  const SHEETS = [
    { name: "stats", tab: 0, sel: "#mobile-sheet-stats", panel: "stats" },
    { name: "shop", tab: 1, sel: "#mobile-sheet-units", panel: "units" }
  ];

  for (const sheet of SHEETS) {
    test.describe(sheet.name, () => {
      async function openSheet(app: AppHelper, page: Page) {
        test.skip(!isCompact(page), "mobile sheets only exist below 760px");
        await app.open();
        await page.locator(".mobile-tab-bar .tab-btn").nth(sheet.tab).click();
        await expect(page.locator(sheet.sel)).toBeVisible();
        await app.settle();
      }
      const panelState = (app: AppHelper) => app.seed((s) => s.ui.mobilePanel as string);

      test("has a ✕ (44px) that closes it", async ({ app, page }) => {
        await openSheet(app, page);
        const close = page.locator(`${sheet.sel} .sheet-close`);
        await expect(close).toBeVisible();
        const b = (await close.boundingBox())!;
        expect(b.width).toBeGreaterThanOrEqual(43.5);
        expect(b.height).toBeGreaterThanOrEqual(43.5);
        await close.click();
        expect(await panelState(app)).toBe("none");
        await expect
          .poll(() => page.evaluate(() => Boolean((history.state as any)?.zutiOverlay)))
          .toBe(false);
      });

      test("the Back button closes it and stays in the game", async ({ app, page }) => {
        await openSheet(app, page);
        await page.goBack();
        await expect.poll(() => panelState(app)).toBe("none");
        await expect(page.locator(".app")).toBeVisible();
      });

      test("Escape closes it", async ({ app, page }) => {
        await openSheet(app, page);
        await page.keyboard.press("Escape");
        expect(await panelState(app)).toBe("none");
      });

      // Regression: the sheet used to cover the scrim exactly, so "tap outside to
      // close" could never be reached. The strip above the sheet is the scrim.
      test("tapping the dimmed strip above the sheet closes it", async ({ app, page }) => {
        await openSheet(app, page);
        const vp = page.viewportSize()!;
        test.skip(vp.height <= 500, "no strip on short (landscape) screens — the sheet fills them");
        const sheetTop = (await page.locator(sheet.sel).boundingBox())!.y;
        const scrimTop = (await page.locator(".mobile-scrim").boundingBox())!.y;
        expect(sheetTop - scrimTop).toBeGreaterThanOrEqual(40);
        await page.touchscreen.tap(vp.width / 2, scrimTop + 12);
        await expect.poll(() => panelState(app)).toBe("none");
      });

      test("a modal over the sheet takes Back/Escape first", async ({ app, page }) => {
        await openSheet(app, page);
        await app.seed((s) => void (s.ui.settingsModalOpen = true));
        await expect(page.locator(".base-modal")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".base-modal")).toHaveCount(0);
        expect(await panelState(app)).toBe(sheet.panel); // the sheet is still open
        await page.goBack();
        await expect.poll(() => panelState(app)).toBe("none");
      });
    });
  }

  test("the sheet ✕ doesn't exist where the rails are always visible", async ({ app, page }) => {
    test.skip(isCompact(page), "desktop/tablet layout only");
    await app.open();
    await expect(page.locator(".sheet-close")).toHaveCount(0);
  });

  test("sheets and the tab bar line up, including with a 34px home-indicator inset", async ({
    app,
    page
  }) => {
    test.skip(!isCompact(page), "mobile sheets only exist below 760px");
    await app.open();
    // Chromium can't emulate env(safe-area-inset-*); the tokens are overridable.
    await page.evaluate(() => document.documentElement.style.setProperty("--sai-bottom", "34px"));
    await page.locator(".mobile-tab-bar .tab-btn").nth(0).click();
    await expect(page.locator("#mobile-sheet-stats")).toBeVisible();
    await app.settle();

    const g = await page.evaluate(() => {
      const bar = document.querySelector(".mobile-tab-bar")!.getBoundingClientRect();
      const sheet = document.querySelector("#mobile-sheet-stats")!.getBoundingClientRect();
      const scrim = document.querySelector(".mobile-scrim")!.getBoundingClientRect();
      const btn = document.querySelector(".mobile-tab-bar .tab-btn")!.getBoundingClientRect();
      return {
        barTop: bar.top,
        barBottom: bar.bottom,
        barHeight: bar.height,
        sheetBottom: sheet.bottom,
        scrimBottom: scrim.bottom,
        btnTop: btn.top,
        btnBottom: btn.bottom,
        btnHeight: btn.height,
        vh: window.innerHeight
      };
    });
    expect(g.barBottom).toBeCloseTo(g.vh, 0);
    expect(g.sheetBottom).toBeCloseTo(g.barTop, 0);
    expect(g.scrimBottom).toBeCloseTo(g.barTop, 0);
    // The tabs keep a full touch-sized row above the inset, inside the bar.
    expect(g.btnHeight).toBeGreaterThanOrEqual(43.5);
    expect(g.btnTop).toBeGreaterThanOrEqual(g.barTop - 0.5);
    expect(g.btnBottom).toBeLessThanOrEqual(g.barBottom - 34 + 0.5);
  });
});

test.describe("closed mobile sheets", () => {
  test.use({ loggedIn: true });

  // Regression: a closed sheet was only parked off-canvas, so its upward box-shadow spilled
  // over the clicker area on every load, and its controls stayed in the Tab order.
  test("are hidden: no shadow band, and never reachable by Tab", async ({ app, page }) => {
    test.skip(!isCompact(page), "mobile sheets only exist below 760px");
    await app.open();
    await app.dismissGuestWarning();

    const closed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".rail")].map(
        (r) => getComputedStyle(r).visibility
      )
    );
    expect(closed).toEqual(["hidden", "hidden"]);

    // Tab through the whole page: focus must never land inside a closed sheet.
    await page.locator(".app-header button").first().focus();
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".rail")));
      expect(inside, `Tab #${i + 1}`).toBe(false);
    }

    // Opening one makes it visible again (and only that one).
    await page.locator(".mobile-tab-bar .tab-btn").nth(0).click();
    await expect(page.locator("#mobile-sheet-stats")).toBeVisible();
    await expect(page.locator("#mobile-sheet-units")).toBeHidden();
  });
});

test.describe("mobile sheet motion", () => {
  test.use({ loggedIn: true });

  // Regression (review): `visibility 0s linear var(--transition-base)` expands to two easing
  // functions, which invalidates the whole declaration — the slide-OUT silently had no animation
  // (computed transition-duration 0s), while only the slide-in worked.
  test("a closed sheet has a real slide-out transition (not an invalid declaration)", async ({
    app,
    page
  }) => {
    test.skip(!isCompact(page), "mobile sheets only exist below 760px");
    await app.open();
    const closed = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector("#mobile-sheet-units")!);
      return { props: cs.transitionProperty, durations: cs.transitionDuration };
    });
    expect(closed.props).toContain("transform");
    expect(closed.durations).toContain("0.22s");
  });

  test("closing is animated: the sheet is still visible a moment after it is closed", async ({
    app,
    page
  }) => {
    test.skip(!isCompact(page), "mobile sheets only exist below 760px");
    await app.open();
    await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
    await expect(page.locator("#mobile-sheet-units")).toBeVisible();
    await app.settle();
    await page.locator("#mobile-sheet-units .sheet-close").click();
    // visibility flips only after the 220ms slide-out
    const vis = await page.evaluate(
      () => getComputedStyle(document.querySelector("#mobile-sheet-units")!).visibility
    );
    expect(vis).toBe("visible");
    await expect(page.locator("#mobile-sheet-units")).toBeHidden();
  });

  test("reduced motion: no slide at all, in either direction", async ({ app, page }) => {
    test.skip(!isCompact(page), "mobile sheets only exist below 760px");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await app.open();
    await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
    await expect(page.locator("#mobile-sheet-units")).toBeVisible();
    const open = await page.evaluate(
      () => getComputedStyle(document.querySelector("#mobile-sheet-units")!).transitionDuration
    );
    expect(open).toBe("0s");
  });
});

test.describe("focus when a sheet closes", () => {
  test.use({ loggedIn: true });

  // Regression (review): closing a sheet with focus inside it (its X, Escape) left focus on <body>
  // once the closed sheet turned visibility: hidden — keyboard/screen-reader users lost their place.
  test("returns to the tab that opened it", async ({ app, page }) => {
    test.skip(!isCompact(page), "mobile sheets only exist below 760px");
    await app.open();
    const tab = page.locator(".mobile-tab-bar .tab-btn").nth(1);
    await tab.click();
    await expect(page.locator("#mobile-sheet-units")).toBeVisible();
    await page.locator("#mobile-sheet-units .sheet-close").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#mobile-sheet-units")).toBeHidden();
    await expect(tab).toBeFocused();
  });
});
