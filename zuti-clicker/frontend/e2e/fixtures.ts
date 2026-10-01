import { test as base, expect, type Page } from "@playwright/test";

// Everything under /api is intercepted — e2e runs never reach a real API or
// database. `loggedIn` decides whether GET /auth/me succeeds.
export interface Mocks {
  loggedIn: boolean;
  language: "en" | "hu";
}

const LEADERBOARD_ENTRIES = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1,
  username: i === 2 ? `averyveryverylongusername_${i}` : `player${i}`,
  value: 10 ** (12 - i) * 1.234
}));

async function installApiMock(page: Page, { loggedIn, language }: Mocks) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    switch (path) {
      case "/auth/me":
        return loggedIn
          ? json(200, { user: { id: 1, username: "player2", email: "a@example.com" } })
          : json(401, { error: "unauthenticated" });
      case "/save":
        return json(200, { save: null });
      case "/settings":
        return json(200, {
          settings: {
            theme: "dark",
            language,
            autosaveEnabled: true,
            autosaveIntervalSecs: 60,
            prestigeCeremony: "full",
            hideFromLeaderboards: false,
            updatedAt: null
          }
        });
      case "/leaderboard":
        return json(200, {
          metric: url.searchParams.get("metric"),
          entries: LEADERBOARD_ENTRIES,
          viewer: { rank: 42, value: 5, hidden: false }
        });
      case "/anticheat/status":
        return json(200, { isRestricted: false, restrictedUntil: null, strikeCount: 0 });
      case "/anticheat/report":
        return json(200, { message: "ok", status: "clean", restrictedUntil: null, strikeCount: 0 });
      case "/version":
        return json(200, { version: "test" });
      default:
        return json(200, {});
    }
  });
}

export const test = base.extend<Mocks & { app: AppHelper }>({
  loggedIn: [false, { option: true }],
  language: ["en", { option: true }],
  app: async ({ page, loggedIn, language }, use) => {
    await installApiMock(page, { loggedIn, language });
    // Settings (incl. language) are read from localStorage on boot — see
    // settingsStore's STORAGE_KEY.
    await page.addInitScript((lang) => {
      try {
        localStorage.setItem(
          "zuti-clicker:settings",
          JSON.stringify({
            theme: "dark",
            language: lang,
            autosaveEnabled: true,
            autosaveIntervalSecs: 60,
            prestigeCeremony: "full",
            hideFromLeaderboards: false
          })
        );
      } catch {
        /* storage unavailable — default language applies */
      }
    }, language);
    await use(new AppHelper(page));
  }
});

export { expect };

type Store = Record<string, any>;

export class AppHelper {
  constructor(readonly page: Page) {}

  async open() {
    await this.page.goto("/");
    await this.page.waitForSelector(".app");
    // Let checkSession() settle so the logged-in/guest UI is final.
    await this.page.waitForTimeout(300);
  }

  /** Run `fn` in the page with the Pinia stores map ({ ui, game, ... }). */
  async seed<T>(fn: (stores: Store) => T): Promise<T> {
    return this.page.evaluate(
      `(${fn.toString()})(Object.fromEntries(document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s))`
    ) as Promise<T>;
  }

  async dismissGuestWarning() {
    await this.seed((s) => {
      s.ui.guestWarningDismissed = true;
    });
  }

  /** True when the document or any given selector scrolls horizontally. */
  async horizontalOverflow(selectors: string[] = []): Promise<string[]> {
    return this.page.evaluate((sels) => {
      const bad: string[] = [];
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) bad.push("document");
      for (const sel of sels) {
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          if (el.scrollWidth > el.clientWidth + 1) bad.push(sel);
        }
      }
      return bad;
    }, selectors);
  }
}
