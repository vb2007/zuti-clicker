// Build-time feature flags. Baked into the bundle by frontend/Dockerfile's
// ARG/ENV pair (keep in sync with that file and with
// .github/workflows/deploy.yml's build-args) - there is no runtime env for
// the static-nginx production image, so flipping one of these means a
// rebuild + redeploy, not an .env edit.
//
// Strict equality against "true": unset, empty, "1", "yes" all mean off.
// This is deliberately off by default - see shouldQuickReset below.
export const QUICK_RESET_ENABLED = import.meta.env.VITE_ENABLE_QUICK_RESET === "true";

// Alt+X instantly wipes the save and logs out with no confirmation - a
// power-user/QA shortcut that must never be reachable unless the operator
// opted in via VITE_ENABLE_QUICK_RESET. Pulled out as a pure predicate (no
// game/auth store access) so it's unit-testable without mounting App.vue.
export function shouldQuickReset(e: KeyboardEvent, enabled: boolean): boolean {
  return enabled && !e.repeat && e.altKey && e.code === "KeyX";
}
