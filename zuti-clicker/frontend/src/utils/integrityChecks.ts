// Script-integrity and honeypot checks — Layer 2's zero-false-positive
// signals. A legitimate player never monkey-patches a native browser
// function, and never interacts with an off-screen, aria-hidden,
// zero-opacity element that no pointer, keyboard, or assistive-technology
// path can reach. Feeds AntiCheatDigest.integrityFlags, which the server
// treats as decisive on the very first report (see
// api/src/services/antiCheat.ts) — nothing here contributes to the scored,
// corroboration-needed signals the way pointerPhysics.ts's do.

const NATIVE_CODE_MARKER = "[native code]";

// Captured immediately at module load — before a page-injected userscript
// (especially one that runs after @run-at document-start) gets a chance to
// overwrite the natives being checked. A monkey-patched
// Function.prototype.toString would otherwise let a patched native lie
// about itself; this reference is what's actually called below, never
// `fn.toString()` directly.
const nativeToString = Function.prototype.toString;

function looksNative(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  try {
    return nativeToString.call(fn).includes(NATIVE_CODE_MARKER);
  } catch {
    return false;
  }
}

/**
 * Checks the handful of natives a copy-pasted Tampermonkey-style clicker
 * script most commonly has to monkey-patch to work at all: dispatching
 * synthetic events, invoking `.click()` directly, wrapping a function with
 * `.bind()` to build a repeating call, driving that repeat off
 * `setInterval`, or spoofing elapsed time via `Date.now`.
 */
export function checkNativeIntegrity(): string[] {
  const flags: string[] = [];
  const checks: Array<[string, unknown]> = [
    ["dispatchEvent", EventTarget.prototype.dispatchEvent],
    ["click", HTMLElement.prototype.click],
    ["bind", Function.prototype.bind],
    ["setInterval", window.setInterval],
    ["dateNow", Date.now]
  ];
  for (const [name, fn] of checks) {
    if (!looksNative(fn)) flags.push(`patched:${name}`);
  }
  return flags;
}

export const HONEYPOT_ELEMENT_ID = "zuti-honeypot";

export interface HoneypotTracker {
  /** Idempotent — safe to call on every mount. */
  install: () => void;
  /** Every triggered honeypot flag since the last drain, then clears it. */
  drainFlags: () => string[];
  /** Test/teardown only — removes the trap element and global. */
  uninstall: () => void;
}

/**
 * A factory (not module-level state) so tests can create an isolated
 * tracker per case instead of fighting shared globals between them.
 */
export function createHoneypotTracker(): HoneypotTracker {
  let triggered: string[] = [];

  function install(): void {
    const g = window as unknown as Record<string, unknown>;
    if (!g["__zutiGame"]) {
      g["__zutiGame"] = {
        // A plausible-looking global a crude "just call the obvious cheat
        // function" script might try — no legitimate code path ever calls
        // this from within the app itself.
        addTokens: (..._args: unknown[]) => {
          triggered.push("honeypot:addTokens");
        }
      };
    }

    if (!document.getElementById(HONEYPOT_ELEMENT_ID)) {
      const trap = document.createElement("button");
      trap.id = HONEYPOT_ELEMENT_ID;
      trap.type = "button";
      // Excluded from the accessibility tree and the tab order, and placed
      // off-screen at zero opacity — no pointer, keyboard, or assistive
      // technology path can ever reach this element through normal use.
      trap.setAttribute("aria-hidden", "true");
      trap.tabIndex = -1;
      Object.assign(trap.style, {
        position: "fixed",
        left: "-9999px",
        top: "-9999px",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "auto"
      });
      trap.addEventListener("click", () => triggered.push("honeypot:clickTrap"));
      document.body.appendChild(trap);
    }
  }

  function drainFlags(): string[] {
    const flags = triggered;
    triggered = [];
    return flags;
  }

  function uninstall(): void {
    document.getElementById(HONEYPOT_ELEMENT_ID)?.remove();
    delete (window as unknown as Record<string, unknown>)["__zutiGame"];
    triggered = [];
  }

  return { install, drainFlags, uninstall };
}
