import { test, expect } from "./fixtures";

test.describe("booster pickups", () => {
  // Regression: the old placement rule was a percentage of the area's box, which is a
  // different physical shape on every viewport — on a 320px phone its "safe" radius
  // (96px) was smaller than the circle's own radius (110px), so a pickup (which
  // renders above the circle) could land on the thing being clicked.
  test("never spawn on top of the click circle, nor outside the area", async ({ app, page }) => {
    await page.clock.install();
    await app.open();
    await app.dismissGuestWarning();

    for (let i = 0; i < 25; i++) {
      await page.clock.fastForward(301_000); // past the longest spawn wait
      const pickup = page.locator(".booster-pickup");
      await expect(pickup).toBeVisible();

      // Measured on the unanimated anchor (the button inside scales in), and no
      // settle(): that polls requestAnimationFrame, which the fake clock freezes.
      const g = await page.evaluate(() => {
        const q = (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) throw new Error(`missing ${sel}`);
          return el;
        };
        const area = q(".clicker-area").getBoundingClientRect();
        const circle = q(".circle-wrap").getBoundingClientRect();
        const p = q(".booster-anchor").getBoundingClientRect();
        const c = { x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 };
        const pc = { x: p.x + p.width / 2, y: p.y + p.height / 2 };
        const pr = p.width / 2;
        return {
          distance: Math.hypot(pc.x - c.x, pc.y - c.y),
          minDistance: circle.width / 2 + pr,
          inside:
            pc.x - pr >= area.left && pc.x + pr <= area.right && pc.y - pr >= area.top && pc.y + pr <= area.bottom
        };
      });
      expect(g.inside, `spawn ${i} inside area`).toBe(true);
      expect(g.distance, `spawn ${i} clear of the circle`).toBeGreaterThanOrEqual(g.minDistance);

      await page.clock.fastForward(21_000); // past the longest visible window: it is missed
      await expect(pickup).toHaveCount(0);
    }
  });
});
