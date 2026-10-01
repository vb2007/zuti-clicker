import { test, expect } from "./fixtures";

test.describe("main layout smoke", () => {
  test("guest: game renders and the page does not scroll horizontally", async ({ app, page }) => {
    await app.open();
    await app.dismissGuestWarning();
    await expect(page.locator(".clicker-area")).toBeVisible();
    expect(await app.horizontalOverflow()).toEqual([]);
  });
});

test.describe("clicker area", () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
    await app.dismissGuestWarning();
  });

  // Regression: a fixed 220px circle plus its hint and cps pill needs ~311px of
  // height; phone landscape leaves the area ~275px, so the stack was clipped.
  test("the circle, hint and cps pill all fit inside the area (never clipped)", async ({ app, page }) => {
    await app.seed((s) => void (s.game.tokens = 10));
    await app.settle();
    const g = await page.evaluate(() => {
      const area = document.querySelector(".clicker-area")!.getBoundingClientRect();
      const content = document.querySelector(".clicker-content")!.getBoundingClientRect();
      const circle = document.querySelector(".circle-wrap")!.getBoundingClientRect();
      return {
        top: content.top - area.top,
        bottom: area.bottom - content.bottom,
        left: content.left - area.left,
        right: area.right - content.right,
        circle: circle.width
      };
    });
    for (const side of ["top", "bottom", "left", "right"] as const) {
      expect(g[side], side).toBeGreaterThanOrEqual(4);
    }
    expect(g.circle).toBeGreaterThanOrEqual(140);
  });

  test("the circle grows on a big screen instead of looking lost", async ({ page }) => {
    const vp = page.viewportSize()!;
    test.skip(vp.width < 1900, "large monitors only");
    const w = (await page.locator(".circle-wrap").boundingBox())!.width;
    expect(w).toBeGreaterThan(250);
  });

  test("the circle stays square and keeps its rings concentric at every size", async ({ page }) => {
    const g = await page.evaluate(() => {
      const wrap = document.querySelector(".circle-wrap")!.getBoundingClientRect();
      const face = document.querySelector(".circle")!.getBoundingClientRect();
      return {
        square: Math.abs(wrap.width - wrap.height) < 1,
        faceCentreDx: Math.abs(face.x + face.width / 2 - (wrap.x + wrap.width / 2)),
        faceCentreDy: Math.abs(face.y + face.height / 2 - (wrap.y + wrap.height / 2))
      };
    });
    expect(g.square).toBe(true);
    expect(g.faceCentreDx).toBeLessThan(1);
    expect(g.faceCentreDy).toBeLessThan(1);
  });

  // Regression: the active-booster chip bar was centred above the circle; on a
  // short screen (the circle fills the height) it sat on top of it.
  test("an active-booster bar never covers the circle", async ({ app, page }) => {
    await app.seed((s) => {
      s.game.grantBooster("frenzy", 60_000);
      s.game.grantBooster("clickStorm", 60_000);
      s.game.grantBooster("clearance", 60_000);
    });
    await expect(page.locator(".boosters-bar")).toBeVisible();
    await app.settle();
    const overlap = await page.evaluate(() => {
      const bar = document.querySelector(".boosters-bar")!.getBoundingClientRect();
      const circle = document.querySelector(".circle-wrap")!.getBoundingClientRect();
      // circle-vs-rect distance
      const cx = circle.x + circle.width / 2;
      const cy = circle.y + circle.height / 2;
      const nx = Math.max(bar.left, Math.min(cx, bar.right));
      const ny = Math.max(bar.top, Math.min(cy, bar.bottom));
      return Math.hypot(cx - nx, cy - ny) - circle.width / 2;
    });
    expect(overlap).toBeGreaterThanOrEqual(0);
  });
});
