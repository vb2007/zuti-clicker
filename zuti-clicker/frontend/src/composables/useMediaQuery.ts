import { getCurrentScope, onScopeDispose, ref } from "vue";

/**
 * Reactive `matches` for an arbitrary media query, backed by `matchMedia` so
 * it updates live on resize/rotation without a resize-event listener. Falls
 * back to `false` when `matchMedia` is unavailable (very old browsers, some
 * non-browser test environments) rather than throwing — the roomy layout is
 * always a safe default.
 *
 * Use this (rather than a CSS-only rule) when JS has to branch on the same
 * condition a stylesheet does — e.g. a prop that changes a component's
 * padding variant. Keep the query string in sync with the matching CSS.
 */
export function useMediaQuery(query: string) {
  const mql =
    typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(query) : null;

  const matches = ref(mql?.matches ?? false);

  function onChange(e: MediaQueryListEvent) {
    matches.value = e.matches;
  }

  mql?.addEventListener("change", onChange);
  if (getCurrentScope()) onScopeDispose(() => mql?.removeEventListener("change", onChange));

  return { matches };
}
