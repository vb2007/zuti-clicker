<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { formatNumber, formatRate } from "@/utils/formatters";
import SaveBar from "@/components/layout/SaveBar.vue";
import type { Language } from "@/types";

const { t } = useI18n();
const settings = useSettingsStore();
const ui = useUiStore();
const game = useGameStore();
const auth = useAuthStore();
const { theme, language } = storeToRefs(settings);

function toggleLanguage() {
  const next: Language = language.value === "en" ? "hu" : "en";
  settings.setLanguage(next);
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <span class="brand-name brand-full">{{ t("app.title") }}</span>
      <span class="brand-name brand-compact">{{ t("app.titleCompact") }}</span>
    </div>

    <SaveBar />

    <div class="controls">
      <!-- lang-btn / theme-btn are dropped below 400px (see the media query):
           both are one tap away in Settings, and the row has no room for them. -->
      <button class="ctrl-btn lang-btn" @click="toggleLanguage" :title="t('settings.language')">
        <span class="flag">{{ language === "en" ? "🇬🇧" : "🇭🇺" }}</span>
        <span class="lang-code">{{ language.toUpperCase() }}</span>
      </button>

      <button
        class="ctrl-btn icon-btn theme-btn"
        @click="settings.toggleTheme"
        :title="t('settings.toggleTheme')"
      >
        <span>{{ theme === "dark" ? "☀️" : "🌙" }}</span>
      </button>

      <button
        v-if="auth.isLoggedIn"
        class="ctrl-btn icon-btn"
        @click="ui.leaderboardModalOpen = true"
        :title="t('leaderboard.open')"
      >
        <span>🏆</span>
      </button>

      <button
        class="ctrl-btn icon-btn"
        @click="ui.settingsModalOpen = true"
        :title="t('settings.open')"
      >
        <span>⚙️</span>
      </button>
    </div>

    <!-- Only visible below 760px (see the media query) — the token/rate
         readout stays visible while both mobile sheets are closed, since
         StatusColumn (which normally shows it) is off-canvas there. -->
    <div class="mini-stats" aria-hidden="true">
      <span class="mini-tokens">🪙 {{ formatNumber(game.tokens) }}</span>
      <!-- 📈 rather than ⚡ — that glyph is reserved for boosters (see
           ActiveBoostersBar/BoosterPickup) and colliding with it here made a
           boosted rate look identical to an idle one at a glance. -->
      <span class="mini-tps" :class="{ boosted: game.boosterProductionMultiplier > 1 }">
        📈 {{ formatRate(game.tokensPerSecond) }}/s
      </span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 max(20px, var(--sai-right)) 0 max(20px, var(--sai-left));
  height: var(--header-h);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 20;
  transition:
    background var(--transition-slow),
    border-color var(--transition-slow);
}

.mini-stats {
  display: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-name {
  font-size: 17px;
  font-weight: 800;
  color: var(--accent);
  letter-spacing: -0.4px;
}

.brand-compact {
  display: none;
}

.controls {
  display: flex;
  gap: 6px;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

@media (hover: hover) {
  .ctrl-btn:hover {
    border-color: var(--accent);
    color: var(--accent-text);
    background: var(--bg-hover);
  }
}

.icon-btn {
  padding: 5px 10px;
}

.flag {
  font-size: 14px;
  line-height: 1;
}
.lang-code {
  letter-spacing: 0.5px;
}

@media (max-width: 759px) {
  .app-header {
    height: var(--header-h-compact);
    flex-wrap: wrap;
    align-content: center;
    row-gap: 4px;
    padding: 8px max(14px, var(--sai-right)) 8px max(14px, var(--sai-left));
  }

  /* Real estate is too tight below 760px for the full brand name alongside
     Sync/account controls and three icon buttons — swap to a shorter name
     (not a single truncated letter, which reads as broken rather than
     intentional) and drop the language code text (the flag alone still
     identifies it). */
  .brand-full {
    display: none;
  }
  .brand-compact {
    display: inline;
  }
  .lang-code {
    display: none;
  }

  .mini-stats {
    display: flex;
    width: 100%;
    justify-content: center;
    gap: 16px;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }

  .mini-tps.boosted {
    color: var(--booster);
  }
}

/* Touch (phone, or a tablet's coarse pointer): 44px targets. The header is 52px
   tall on a tablet, which fits them. */
@media (max-width: 759px), (pointer: coarse) {
  .ctrl-btn {
    min-width: 44px;
    min-height: 44px;
    justify-content: center;
  }
}

/* A logged-in header needs ~355px for brand + Sync + account + four 44px
   buttons; below 400px that wrapped onto a third row and spilled out of the
   fixed header height. Language and theme are both in Settings, so they go. */
@media (max-width: 399px) {
  .lang-btn,
  .theme-btn {
    display: none;
  }
}

/* Phone landscape: no room for a second row — mini-stats move inline between
   the account buttons and the controls, and the header slims to one row. */
@media (max-width: 759px) and (max-height: 500px) {
  .app-header {
    flex-wrap: nowrap;
    padding-block: 4px;
    column-gap: 10px;
  }
  .brand {
    flex: none;
  }
  .mini-stats {
    width: auto;
    order: 2;
    flex: 0 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
  .controls {
    order: 3;
    flex: none;
  }
}
</style>
