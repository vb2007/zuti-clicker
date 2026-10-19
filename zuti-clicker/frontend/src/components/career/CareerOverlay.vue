<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useUiStore } from "@/stores/uiStore";
import { useCareer } from "@/composables/useCareer";
import { useOverlay } from "@/composables/useOverlayStack";
import { useBreakpoint } from "@/composables/useBreakpoint";
import { useMediaQuery } from "@/composables/useMediaQuery";
import { CAREER_NODES } from "@/utils/careerCore";
import { formatNumber } from "@/utils/formatters";
import CareerCanvas from "./CareerCanvas.vue";
import CareerNodePanel from "./CareerNodePanel.vue";
import CareerIcon from "./CareerIcon.vue";

/**
 * The Academic Career, full screen. Two modes, decided by the store, not by
 * whoever opened it:
 *
 *  - window: a prestige opened the purchase window. Nothing dismisses it but
 *    Skip ("keep my PhDs") or Done — Escape, Back and outside clicks only clear
 *    the node selection — and it comes back after a reload or on another
 *    device until one of those is pressed (the server keeps the window open).
 *    The game is paused meanwhile (see gameStore.tick).
 *  - view: opened from the Prestige panel to look; closable any way.
 */
const { t } = useI18n();
const game = useGameStore();
const ui = useUiStore();
const career = useCareer();
const { isCompact } = useBreakpoint();
const { matches: shortScreen } = useMediaQuery("(max-height: 500px)");

const windowMode = computed(() => game.careerWindowOpen);
const selectedId = ref<string | null>(null);
// Phones: the "?" button shows the legend (the panel's empty state) as a sheet.
const legendOpen = ref(false);
watch(selectedId, (id) => {
  if (id) legendOpen.value = false;
});
const sheetOpen = computed(
  () => isCompact.value && (selectedId.value !== null || legendOpen.value)
);
function showLegend(): void {
  selectedId.value = null;
  legendOpen.value = isCompact.value;
}
function closeSheet(): void {
  selectedId.value = null;
  legendOpen.value = false;
}
const closing = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const boughtThisWindow = computed(() => game.careerNodes.some((n) => n.refundable));

// The phone sheet covers the canvas's lower part; the canvas keeps the
// selected node above it.
const sheetEl = ref<HTMLElement | null>(null);
const sheetHeight = ref(0);
let sheetObserver: ResizeObserver | null = null;
watch(sheetEl, (el) => {
  sheetObserver?.disconnect();
  sheetHeight.value = el?.offsetHeight ?? 0;
  if (el && typeof ResizeObserver === "function") {
    sheetObserver = new ResizeObserver(() => {
      sheetHeight.value = el.offsetHeight;
    });
    sheetObserver.observe(el);
  }
});
// Docked to the right on short screens (see the max-height media query): no inset.
const bottomInset = computed(() =>
  sheetOpen.value && typeof matchMedia === "function" && !matchMedia("(max-height: 500px)").matches
    ? sheetHeight.value
    : 0
);

function closeView(): void {
  ui.careerOpen = false;
}

async function finish(): Promise<void> {
  if (closing.value) return;
  closing.value = true;
  try {
    if (await career.close()) {
      selectedId.value = null;
      ui.careerOpen = false;
    }
  } finally {
    closing.value = false;
  }
}

// Escape / Back: clear the selection first; then close — but only in view mode.
useOverlay(
  () => true,
  () => {
    if (selectedId.value) selectedId.value = null;
    else if (legendOpen.value) legendOpen.value = false;
    else if (!windowMode.value) closeView();
  },
  1150 // keep in sync with .career-overlay's z-index
);

// Focus stays inside while it's open (like BaseModal's trap).
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Tab" || !rootEl.value) return;
  const focusables = Array.from(
    rootEl.value.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')
  ).filter((el) => el.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

let previouslyFocused: HTMLElement | null = null;
onMounted(async () => {
  previouslyFocused = document.activeElement as HTMLElement | null;
  window.addEventListener("keydown", onKeydown);
  await nextTick();
  rootEl.value
    ?.querySelector<HTMLElement>('.career-node[tabindex="0"]')
    ?.focus({ preventScroll: true });
});
onUnmounted(() => {
  sheetObserver?.disconnect();
  window.removeEventListener("keydown", onKeydown);
  previouslyFocused?.focus?.();
});
</script>

<template>
  <!--
    THESIS: an academic career drawn as a real tree you climb — root at the
    bottom, six branches rising — not a grid of upgrade cards.
    OWN-WORLD: the game's navy/blue system (base.css); one blue accent for owned
    and buyable, the rare amber only for "bought now, still undoable"; node
    shape carries kind (medallion root, ringed keystones with drawn branch
    glyphs, tier discs with roman numerals); state is never colour alone.
    STORY: see what PhDs could become, weigh each against the held-PhD bonus
    it costs, invest or keep, then start the new run.
    FIRST VIEWPORT: the frontier around the root; detail panel right (sheet on
    phones); in the purchase window a footer with Skip/Done.
    FORM: pan/zoom canvas — user-pinned, no concept roll (no seed key).
    FINISH: unreviewed is unfinished; this build ends with the finish review and
    its verdict.
  -->
  <Teleport to="body">
    <div
      ref="rootEl"
      class="career-overlay"
      :class="{ 'window-mode': windowMode, compact: isCompact }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="career-title"
    >
      <header class="career-head">
        <div class="head-title">
          <span class="crest" aria-hidden="true"><CareerIcon branch="root" :size="22" /></span>
          <div class="title-block">
            <h2 id="career-title" class="title">{{ t("career.title") }}</h2>
            <p class="intro">{{ windowMode ? t("career.windowIntro") : t("career.viewIntro") }}</p>
            <p v-if="windowMode" class="intro-short">{{ t("career.windowIntroShort") }}</p>
          </div>
          <button
            v-if="!windowMode"
            type="button"
            class="head-close"
            :aria-label="t('common.close')"
            @click="closeView"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M3 3l10 10M13 3L3 13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <dl class="stats">
          <div class="stat">
            <dt>{{ t("career.statsHeld") }}</dt>
            <dd class="stat-strong">{{ formatNumber(game.phdCount) }}</dd>
          </div>
          <div class="stat">
            <dt>{{ t("career.statsInvested") }}</dt>
            <dd>{{ formatNumber(game.phdInvested) }}</dd>
          </div>
          <div class="stat">
            <dt>{{ t("career.statsBonus") }}</dt>
            <dd>
              {{ t("career.statsBonusValue", { mult: game.productionMultiplier.toFixed(2) }) }}
            </dd>
          </div>
          <div class="stat">
            <dt>{{ t("career.title") }}</dt>
            <dd>
              {{
                t("career.progress", { owned: game.careerNodes.length, total: CAREER_NODES.length })
              }}
            </dd>
          </div>
        </dl>
      </header>

      <div class="career-body">
        <CareerCanvas
          class="canvas"
          :selected-id="selectedId"
          :bottom-inset="bottomInset"
          @select="selectedId = $event"
          @legend="showLegend"
        />
        <aside v-if="!isCompact" class="side">
          <CareerNodePanel :node-id="selectedId" @select="selectedId = $event" />
        </aside>
        <Transition name="sheet">
          <div v-if="sheetOpen" ref="sheetEl" class="career-sheet">
            <CareerNodePanel
              :node-id="selectedId"
              sheet
              @select="selectedId = $event"
              @close="closeSheet"
            />
          </div>
        </Transition>
      </div>

      <footer v-if="windowMode" class="career-foot">
        <!-- Short screens hide the header intro: the short version lives here. -->
        <p class="foot-note">
          {{ shortScreen ? t("career.windowIntroShort") : t("career.footerNote") }}
        </p>
        <button
          type="button"
          class="finish"
          :class="{ primary: boughtThisWindow }"
          :disabled="closing || game.careerPending"
          @click="finish"
        >
          {{ boughtThisWindow ? t("career.done") : t("career.skip") }}
        </button>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.career-overlay {
  position: fixed;
  inset: 0;
  z-index: 1150;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  color: var(--text-primary);
  padding: var(--sai-top) var(--sai-right) 0 var(--sai-left);
  animation: fadeIn 220ms ease;
}

/* ---- Header ---------------------------------------------------------- */
.career-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 28px;
  flex-wrap: wrap;
  padding: 14px 20px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}
.head-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 380px;
}
.crest {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
}
.title-block {
  min-width: 0;
  flex: 1;
}
.title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.2px;
}
.intro {
  margin: 2px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-secondary);
  max-width: 72ch;
}
.intro-short {
  display: none;
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.head-close {
  flex: none;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}
@media (hover: hover) {
  .head-close:hover {
    color: var(--text-primary);
    background: var(--bg-elevated);
  }
}

.stats {
  display: flex;
  gap: 22px;
  margin: 0;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.stat dt {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-secondary);
  white-space: nowrap;
}
.stat dd {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.stat dd.stat-strong {
  font-size: 20px;
  font-weight: 800;
  color: var(--accent-text);
  line-height: 1.15;
}

/* ---- Body ------------------------------------------------------------ */
.career-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.canvas {
  flex: 1;
  min-width: 0;
}
.side {
  flex: none;
  width: 320px;
  overflow-y: auto;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
}

/* Phones: the panel becomes a sheet over the canvas's lower part. (Not
   `.sheet`: a child's root element carries this component's scope id too, and
   the panel's own `sheet` class would match it — see the mobile-sheet note in
   App.vue for the same fallthrough.) */
.career-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 62%;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.35);
  z-index: 3;
}
.sheet-enter-active,
.sheet-leave-active {
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 220ms ease;
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(24px);
  opacity: 0;
}

/* ---- Footer (purchase window only) ------------------------------------- */
.career-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 12px 20px calc(12px + var(--sai-bottom));
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
}
.foot-note {
  margin: 0 auto 0 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.finish {
  min-height: 44px;
  padding: 10px 22px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 700;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-primary);
  transition:
    filter var(--transition-fast),
    border-color var(--transition-fast);
}
.finish.primary {
  background: var(--btn-buy-bg);
  border-color: var(--btn-buy-bg);
  color: var(--btn-buy-text);
}
.finish:disabled {
  opacity: 0.6;
  cursor: wait;
}
@media (hover: hover) {
  .finish:not(:disabled):hover {
    filter: brightness(1.08);
    border-color: var(--accent);
  }
}

/* ---- Compact (phones) -------------------------------------------------- */
.compact .career-head {
  padding: 10px 14px;
  gap: 8px;
}
.compact .head-title {
  flex-basis: 100%;
}
.compact .intro {
  display: none;
}
.compact .intro-short {
  display: block;
}
.compact .stats {
  gap: 16px;
  width: 100%;
  overflow-x: auto;
}
.compact .stat:last-child {
  display: none;
}
.compact .career-foot {
  padding: 10px 14px calc(10px + var(--sai-bottom));
}
.compact .foot-note {
  font-size: 11.5px;
}
.compact .finish {
  flex: none;
}

/* Short screens (a phone on its side, at any width): the tree needs the
   height, so the header drops its intro and tightens to one row. */
@media (max-height: 500px) {
  .career-head {
    padding: 6px 14px;
    gap: 6px 20px;
    flex-wrap: nowrap;
  }
  .head-title {
    flex: 0 1 auto;
  }
  .intro {
    display: none;
  }
  .crest {
    width: 32px;
    height: 32px;
  }
  .title {
    font-size: 15px;
  }
  .stats {
    gap: 14px;
    width: auto;
  }
  .stat dd.stat-strong {
    font-size: 15px;
  }
  .stat dd {
    font-size: 12.5px;
  }
  /* Keep the held-PhD bonus — the number the window is about. */
  .compact .stat:nth-child(2) {
    display: none;
  }
  .compact .intro-short {
    display: none;
  }
  .career-foot {
    padding: 6px 14px calc(6px + var(--sai-bottom));
  }
  /* Too short for a bottom sheet over the tree: it docks on the right. */
  .career-sheet {
    top: 0;
    left: auto;
    width: min(340px, 56%);
    max-height: none;
    border-top: none;
    border-left: 1px solid var(--border);
    border-radius: 0;
    box-shadow: -12px 0 40px rgba(0, 0, 0, 0.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .career-overlay {
    animation: none;
  }
  .sheet-enter-active,
  .sheet-leave-active {
    transition: none;
  }
}
</style>
