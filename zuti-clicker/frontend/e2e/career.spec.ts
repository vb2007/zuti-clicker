import { test, expect, type AppHelper } from "./fixtures";
import type { Page } from "@playwright/test";

// The Academic Career overlay on every device class: how it opens and refuses
// to close, and the pan/zoom canvas driven by real mouse, touch and pinch
// input. Logic (prices, refunds, the server contract) lives in Vitest; this
// suite owns what only a real layout engine and real input can show.

const coarse = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches);
const compact = (page: Page) => page.viewportSize()!.width < 760;

/** A guest whose prestige just opened the purchase window (as gameStore.prestige() does). */
async function openWindow(app: AppHelper, phd = 60, owned: string[] = []) {
  await app.open();
  await app.dismissGuestWarning();
  await app.seed((s) => {
    s.game.totalTokensEarned = 5e9;
    s.game.prestigeCount = 3;
  });
  await app.page.evaluate(
    ([phd, owned]) => {
      const p = (document.querySelector("#app") as any).__vue_app__.config.globalProperties.$pinia
        ._s;
      const game = p.get("game");
      game.applyCareerState({
        career: {
          windowOpen: false,
          windowId: 2,
          phdInvested: 0,
          nodes: (owned as string[]).map((nodeId) => ({ nodeId, cost: 1, refundable: false }))
        }
      });
      game.applyCareerWindow(true, 3);
      game.phdCount = phd;
    },
    [phd, owned] as const
  );
  await expect(app.page.locator(".career-overlay")).toBeVisible();
  await app.settle();
}

/** The canvas layer's current scale and translation. */
async function worldTransform(page: Page) {
  return page.locator(".world").evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { scale: m.a, x: m.e, y: m.f };
  });
}

async function nodeCenter(page: Page, id: string) {
  const b = (await page.locator(`[data-node="${id}"]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Real touches: Playwright's touchscreen only taps, so drags and pinches go
// through the DevTools protocol.
async function touchDrag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + (dx * i) / 8, y: from.y + (dy * i) / 8 }]
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function pinch(page: Page, mid: { x: number; y: number }, fromGap: number, toGap: number) {
  const cdp = await page.context().newCDPSession(page);
  const points = (gap: number) => [
    { x: mid.x - gap / 2, y: mid.y, id: 1 },
    { x: mid.x + gap / 2, y: mid.y, id: 2 }
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(fromGap) });
  for (let i = 1; i <= 10; i++) {
    const gap = fromGap + ((toGap - fromGap) * i) / 10;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(gap) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("Academic Career", () => {
  test.use({ loggedIn: false });

  test("a prestige opens the purchase window after the ceremony", async ({ app, page }) => {
    await app.open();
    await app.dismissGuestWarning();
    await app.seed((s) => {
      s.game.totalTokensEarned = 5e6;
      s.game.runTokensEarned = 4e6;
      s.ui.prestigeConfirmOpen = true;
    });
    await page.locator(".btn-confirm").click();
    const cont = page.locator(".continue-btn");
    await expect(cont).toBeVisible();
    // Not over the ceremony — it waits its turn.
    await expect(page.locator(".career-overlay")).toHaveCount(0);
    await cont.scrollIntoViewIfNeeded();
    await cont.click();
    await expect(page.locator(".career-overlay")).toBeVisible();
    await expect(page.locator(".career-foot .finish")).toHaveText(/keep my phds/i);
  });

  test("the window can't be dismissed by Escape, Back or the canvas — only Skip/Done", async ({
    app,
    page
  }) => {
    await openWindow(app);
    await page.keyboard.press("Escape");
    await page.goBack().catch(() => undefined);
    await page.waitForTimeout(150);
    const canvas = (await page.locator(".career-canvas").boundingBox())!;
    await page.mouse.click(canvas.x + canvas.width - 30, canvas.y + 30);
    await expect(page.locator(".career-overlay")).toBeVisible();
    await expect(page.locator(".head-close")).toHaveCount(0);

    await page.locator(".career-foot .finish").click();
    await expect(page.locator(".career-overlay")).toHaveCount(0);
  });

  test("tap selects without buying; Buy, then Undo with cascade, settle locally for a guest", async ({
    app,
    page
  }) => {
    await openWindow(app, 60);
    const root = page.locator('[data-node="habilitation"]');
    await root.click();
    await expect(root).toHaveAttribute("aria-pressed", "true");
    expect(await app.seed((s) => s.game.careerNodes.length)).toBe(0);

    const buy = page.locator(".node-panel .btn-primary").last();
    await expect(buy).toBeVisible();
    await buy.click();
    await expect(root).toHaveClass(/state-refundable/);

    // Walk the keyboard up to a child of the root (it scrolls into view), buy
    // it on top, then undo the root: both come back.
    await root.focus();
    await page.keyboard.press("ArrowUp");
    const child = await page.evaluate(() => document.activeElement?.getAttribute("data-node"));
    expect(child).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    await expect(page.locator(`[data-node="${child}"]`)).toBeInViewport();
    await page.keyboard.press("Enter");
    await page.locator(".node-panel .btn-primary").last().click();
    expect(await app.seed((s) => s.game.careerNodes.length)).toBe(2);
    // On a phone the sheet covers the lower canvas: close it to reach the root.
    if (await page.locator(".career-sheet").count())
      await page.locator(".node-panel .close").click();
    // Back to the root the keyboard way: focusing it brings it into view.
    await root.focus();
    await expect(root).toBeInViewport();
    await page.keyboard.press("Enter");
    const undo = page.locator(".node-panel .btn-secondary").last();
    await expect(undo).toContainText("2");
    await undo.click();
    expect(await app.seed((s) => s.game.careerNodes.length)).toBe(0);
    expect(await app.seed((s) => s.game.phdCount)).toBe(60);
  });

  test("regression: keyboard focus never leaves the open window, and Tab never scrolls the canvas", async ({
    app,
    page
  }) => {
    await openWindow(app);
    // Walk off the root first, so the roving tab stop isn't the first node in the DOM.
    await page.locator('[data-node="habilitation"]').focus();
    await page.keyboard.press("ArrowUp");
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest(".career-overlay"))).toBe(
        true
      );
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest(".career-overlay"))).toBe(
        true
      );
    }
    const scroll = await page
      .locator(".career-canvas")
      .evaluate((el) => [el.scrollLeft, el.scrollTop]);
    expect(scroll).toEqual([0, 0]);
  });

  test("regression: Tabbing back to a node dragged off screen doesn't scroll the canvas", async ({
    app,
    page
  }) => {
    test.skip(await coarse(page), "mouse devices only");
    await openWindow(app);
    // Drag the whole tree away, so the roving tab stop (the root) is off screen.
    const box = (await page.locator(".career-canvas").boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 30, box.y + 30, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('[data-node="habilitation"]')).not.toBeInViewport();
    // Back into the tree from the footer.
    await page.locator(".career-foot .finish").focus();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      if (await page.evaluate(() => !!document.activeElement?.closest(".career-node"))) break;
    }
    expect(await page.evaluate(() => !!document.activeElement?.closest(".career-node"))).toBe(true);
    const scroll = await page
      .locator(".career-canvas")
      .evaluate((el) => [el.scrollLeft, el.scrollTop]);
    expect(scroll).toEqual([0, 0]);
    // ...and the focused node was brought into view instead.
    await expect(page.locator(".career-node:focus")).toBeInViewport();
  });

  test("regression: Enter on a node still selects it after a drag", async ({ app, page }) => {
    test.skip(await coarse(page), "mouse devices only");
    await openWindow(app);
    const box = (await page.locator(".career-canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const root = page.locator('[data-node="habilitation"]');
    await root.focus();
    await page.keyboard.press("Enter");
    await expect(root).toHaveAttribute("aria-pressed", "true");
  });

  test("a tap on empty canvas clears the selection", async ({ app, page }) => {
    await openWindow(app);
    const root = page.locator('[data-node="habilitation"]');
    await root.click();
    await expect(root).toHaveAttribute("aria-pressed", "true");
    // A point where the canvas itself is on top — no node, label, control or sheet.
    const spot = await page.evaluate(() => {
      const c = document.querySelector(".career-canvas")!.getBoundingClientRect();
      for (let y = c.top + 20; y < c.bottom - 20; y += 23) {
        for (let x = c.left + 20; x < c.right - 20; x += 23) {
          const el = document.elementFromPoint(x, y);
          if (el && el.closest(".career-canvas") && !el.closest("button, .branch-label")) {
            return { x, y };
          }
        }
      }
      return null;
    });
    expect(spot).not.toBeNull();
    if (await coarse(page)) await page.touchscreen.tap(spot!.x, spot!.y);
    else await page.mouse.click(spot!.x, spot!.y);
    await expect(root).toHaveAttribute("aria-pressed", "false");
  });

  test("dragging pans the tree and never selects the node it started on", async ({ app, page }) => {
    await openWindow(app);
    const before = await worldTransform(page);
    const start = await nodeCenter(page, "habilitation");
    if (await coarse(page)) {
      await touchDrag(page, start, 0, -120);
    } else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 40, start.y - 100, { steps: 8 });
      await page.mouse.up();
    }
    const after = await worldTransform(page);
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(60);
    await expect(page.locator('[data-node="habilitation"]')).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  test("pinch zooms around the fingers' midpoint", async ({ app, page }) => {
    test.skip(!(await coarse(page)), "touch devices only");
    await openWindow(app);
    const canvas = (await page.locator(".career-canvas").boundingBox())!;
    const mid = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    const before = await worldTransform(page);
    // The world point under the midpoint before the gesture...
    const local = { x: mid.x - canvas.x, y: mid.y - canvas.y };
    const wx = (local.x - before.x) / before.scale;
    const wy = (local.y - before.y) / before.scale;
    await pinch(page, mid, 60, 180);
    const after = await worldTransform(page);
    expect(after.scale).toBeGreaterThan(before.scale * 1.3);
    // ...is still under it after (within a few px of float/integer touch rounding).
    expect(Math.abs(wx * after.scale + after.x - local.x)).toBeLessThan(6);
    expect(Math.abs(wy * after.scale + after.y - local.y)).toBeLessThan(6);
    // Pinching in again zooms back out.
    await pinch(page, mid, 180, 60);
    expect((await worldTransform(page)).scale).toBeLessThan(after.scale);
  });

  test("the wheel zooms around the cursor (mouse)", async ({ app, page }) => {
    test.skip(await coarse(page), "mouse devices only");
    await openWindow(app);
    const before = await worldTransform(page);
    const box = (await page.locator(".career-canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await worldTransform(page)).scale).toBeGreaterThan(before.scale);
  });

  test("a mouse opens on the whole fan: the root and all six branches", async ({ app, page }) => {
    test.skip(await coarse(page), "mouse devices only");
    await openWindow(app);
    await expect(page.locator(".branch-label")).toHaveCount(6);
    await expect(page.locator('[data-node="habilitation"]')).toBeInViewport();
  });

  test("the ? button shows the legend (a sheet on phones)", async ({ app, page }) => {
    await openWindow(app);
    await page.getByRole("button", { name: /legend/i }).click();
    const legend = page.locator(".node-panel .legend").last();
    await expect(legend).toBeVisible();
    await expect(legend).toBeInViewport();
    if (compact(page)) {
      // The zoom controls never end up under the sheet (a bottom sheet lifts
      // them; a right-docked one leaves them alone)...
      const sheet = (await page.locator(".career-sheet").boundingBox())!;
      await expect
        .poll(async () => {
          const c = (await page.locator(".zoom-controls").boundingBox())!;
          return c.y + c.height <= sheet.y + 1 || c.x + c.width <= sheet.x + 1;
        })
        .toBe(true);
      // ...nor under the header.
      const head = (await page.locator(".career-head").boundingBox())!;
      const c = (await page.locator(".zoom-controls").boundingBox())!;
      expect(c.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
      await page.locator(".node-panel .close").click();
      await expect(page.locator(".career-sheet")).toHaveCount(0);
    }
  });

  test("zoom buttons and fit work, and nothing scrolls the page sideways", async ({
    app,
    page
  }) => {
    await openWindow(app);
    const start = (await worldTransform(page)).scale;
    await page.getByRole("button", { name: /zoom in/i }).click();
    expect((await worldTransform(page)).scale).toBeGreaterThan(start);
    await page.getByRole("button", { name: /whole tree/i }).click();
    expect((await worldTransform(page)).scale).toBeLessThan(start);
    expect(await app.horizontalOverflow([".career-overlay", ".career-head"])).toEqual([]);
  });

  test("touch targets are at least 44px at the opening zoom", async ({ app, page }) => {
    test.skip(!(await coarse(page)), "touch devices only");
    await openWindow(app);
    for (const sel of [
      '[data-node="habilitation"]',
      '[data-node="research.labAccess"]',
      ".zoom-btn",
      ".career-foot .finish"
    ]) {
      const visible = page.locator(sel).first();
      if (!(await visible.isVisible())) continue;
      const b = (await visible.boundingBox())!;
      expect(Math.min(b.width, b.height), sel).toBeGreaterThanOrEqual(43.5);
    }
    // A track tier node (the smallest) is 44px at the opening scale too.
    const tier = (await page.locator(".career-node.is-tier").first().boundingBox())!;
    expect(tier.width).toBeGreaterThanOrEqual(43.5);
  });

  test("the node panel (sheet on phones) is fully on screen and its action reachable", async ({
    app,
    page
  }) => {
    await openWindow(app);
    await page.locator('[data-node="habilitation"]').click();
    const panel = page.locator(".node-panel").last();
    await expect(panel).toBeVisible();
    const vp = page.viewportSize()!;
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
    const buy = page.locator(".node-panel .btn-primary").last();
    await buy.scrollIntoViewIfNeeded();
    const b = (await buy.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    // Above the footer, not under it.
    const foot = (await page.locator(".career-foot").boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(foot.y + 0.5);
    if (compact(page)) {
      await page.locator(".node-panel .close").click();
      await expect(page.locator(".career-sheet")).toHaveCount(0);
    }
  });

  test("view mode (from the Prestige panel) is read-only and closes with ✕", async ({
    app,
    page
  }) => {
    await app.open();
    await app.dismissGuestWarning();
    await app.seed((s) => {
      s.game.prestigeCount = 2;
      s.game.phdCount = 100;
      s.ui.careerOpen = true;
    });
    await expect(page.locator(".career-overlay")).toBeVisible();
    await expect(page.locator(".career-foot")).toHaveCount(0);
    await page.locator('[data-node="habilitation"]').click();
    await expect(page.locator(".node-panel .btn-primary")).toHaveCount(0);
    await expect(page.locator(".node-panel").last()).toContainText(/next prestige/i);
    await page.locator(".head-close").click();
    await expect(page.locator(".career-overlay")).toHaveCount(0);
  });

  test("the auto-buy switch appears once Purchasing Officer is owned and toggles", async ({
    app,
    page
  }) => {
    await app.open();
    await app.dismissGuestWarning();
    await page.evaluate(() => {
      const p = (document.querySelector("#app") as any).__vue_app__.config.globalProperties.$pinia
        ._s;
      p.get("game").applyCareerState({
        career: {
          windowOpen: false,
          windowId: 1,
          phdInvested: 0,
          nodes: ["habilitation", "lab.teachingAssistant", "lab.purchasingOfficer"].map(
            (nodeId) => ({
              nodeId,
              cost: 1,
              refundable: false
            })
          )
        }
      });
    });
    if (compact(page)) await page.locator(".mobile-tab-bar .tab-btn").nth(1).click();
    const toggle = page.locator(".auto-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("Academic Career — logged in", () => {
  test.use({ loggedIn: true });

  test("a window still open on the server comes back after a reload", async ({ app, page }) => {
    await page.route("**/api/save", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          save: {
            tokens: 0,
            totalTokensEarned: 5e6,
            totalClicks: 10,
            elapsedSeconds: 100,
            runTokensEarned: 0,
            runClicks: 0,
            runSeconds: 0,
            phdCount: 12,
            prestigeCount: 1,
            units: [],
            upgrades: [],
            upgraderSeq: 0,
            savedAt: new Date().toISOString(),
            career: { windowOpen: true, windowId: 1, phdInvested: 0, nodes: [] }
          }
        })
      })
    );
    await app.open();
    await expect(page.locator(".career-overlay")).toBeVisible();
    await expect(page.locator(".career-foot .finish")).toBeVisible();
  });
});
