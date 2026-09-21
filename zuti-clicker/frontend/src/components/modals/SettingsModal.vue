<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore, type SettingsSnapshot } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useToastStore } from "@/stores/toastStore";
import { AUTOSAVE_INTERVAL_OPTIONS } from "@/utils/gameConstants";
import { THEMES, LANGUAGES, CEREMONIES } from "@/utils/settingsSchema";
import { api } from "@/lib/api";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();
const settings = useSettingsStore();
const ui = useUiStore();
const toast = useToastStore();

// Frontend version is baked in at build time (vite.config.ts's
// __APP_VERSION__ define); the API version has to be fetched, since it
// reflects whatever image is actually deployed behind VITE_API_BASE_URL.
// Fetched once, on first open, and cached in this ref for the component's
// lifetime (it's mounted for the whole app session — see App.vue) rather
// than re-fetched every time the modal opens.
const apiVersion = ref<string | null>(null);
let versionFetched = false;
// Bound to a local const rather than referencing __APP_VERSION__ directly in
// the template — vue-tsc's template type-checker doesn't resolve a custom
// ambient global declared via `declare const` (env.d.ts), only script-level
// bindings.
const frontendVersion = __APP_VERSION__;

function intervalKey(opt: (typeof AUTOSAVE_INTERVAL_OPTIONS)[number]) {
  return `settings.intervals.${opt}` as Parameters<typeof t>[0];
}

// Live preview stays (theme/language apply as you click), but a change is
// only committed to the server on "Done" — Cancel/Esc (BaseModal emits
// "close" for both, since it doesn't distinguish backdrop-driven dismissal
// from Escape here) restores whatever was in effect when the modal opened.
const openSnapshot = ref<SettingsSnapshot | null>(null);
const saving = ref(false);

watch(
  () => ui.settingsModalOpen,
  (open) => {
    if (!open) return;
    openSnapshot.value = settings.snapshot();
    if (versionFetched) return;
    versionFetched = true;
    // Broad try/catch: request() calls res.json() unconditionally, so a
    // non-JSON response (e.g. a 404 HTML page if the API is unreachable)
    // throws a raw SyntaxError here, not an ApiError. Either way, leave
    // apiVersion null — the line below falls back to an em dash for it.
    api.meta
      .version()
      .then((res) => {
        apiVersion.value = res.version;
      })
      .catch(() => {
        // apiVersion stays null; rendered as "—".
      });
  }
);

function close() {
  ui.settingsModalOpen = false;
}

function handleCancel() {
  // Both action buttons disable while a Done-triggered save is in flight,
  // but Escape/backdrop reach this the same way — without this guard,
  // Escaping mid-save would revert the very values already being (or just)
  // sent to the server, arriving after the fact as a confusingly-timed
  // "Settings saved" toast for a change the UI had already discarded.
  if (saving.value) return;
  if (openSnapshot.value) settings.restore(openSnapshot.value);
  close();
}

async function handleDone() {
  saving.value = true;
  try {
    const result = await settings.flushPush();
    if (result.local) {
      toast.push("success", t("settings.savedLocal"));
    } else if (result.ok) {
      toast.push("success", t("settings.saved"));
    } else {
      toast.push("error", t("settings.saveFailed"));
    }
  } finally {
    saving.value = false;
    close();
  }
}
</script>

<template>
  <BaseModal
    :open="ui.settingsModalOpen"
    :title="t('settings.title')"
    :max-width="420"
    :z-index="1000"
    :dismiss-on-backdrop="false"
    @close="handleCancel"
  >
    <div class="section">
      <span class="section-label">{{ t("settings.appearance") }}</span>

      <div class="field-row">
        <span class="field-label">{{ t("settings.theme") }}</span>
        <div class="seg-group" role="group">
          <button
            v-for="opt in THEMES"
            :key="opt"
            class="seg-btn"
            :class="{ active: settings.theme === opt }"
            :aria-pressed="settings.theme === opt"
            @click="settings.theme = opt"
          >
            {{ opt === "dark" ? t("settings.themeDark") : t("settings.themeLight") }}
          </button>
        </div>
      </div>

      <div class="field-row">
        <span class="field-label">{{ t("settings.language") }}</span>
        <div class="seg-group" role="group">
          <button
            v-for="opt in LANGUAGES"
            :key="opt"
            class="seg-btn"
            :class="{ active: settings.language === opt }"
            :aria-pressed="settings.language === opt"
            @click="settings.setLanguage(opt)"
          >
            {{ opt.toUpperCase() }}
          </button>
        </div>
      </div>
    </div>

    <div class="section">
      <span class="section-label">{{ t("settings.game") }}</span>

      <div class="field-row">
        <span class="field-label">{{ t("settings.ceremonyLabel") }}</span>
        <div class="seg-group" role="group">
          <button
            v-for="opt in CEREMONIES"
            :key="opt"
            class="seg-btn"
            :class="{ active: settings.prestigeCeremony === opt }"
            :aria-pressed="settings.prestigeCeremony === opt"
            @click="settings.setPrestigeCeremony(opt)"
          >
            {{ opt === "full" ? t("settings.ceremonyFull") : t("settings.ceremonyBrief") }}
          </button>
        </div>
      </div>
    </div>

    <div class="section">
      <span class="section-label">{{ t("settings.saving") }}</span>

      <div class="field-row">
        <span class="field-label">{{ t("settings.autosave") }}</span>
        <button
          class="toggle-btn"
          :class="{ active: settings.autosaveEnabled }"
          :aria-pressed="settings.autosaveEnabled"
          @click="settings.autosaveEnabled = !settings.autosaveEnabled"
        >
          {{ settings.autosaveEnabled ? "✓" : "✗" }}
        </button>
      </div>

      <div v-if="settings.autosaveEnabled" class="field-row">
        <span class="field-label">{{ t("settings.autosaveInterval") }}</span>
        <div class="seg-group" role="group">
          <button
            v-for="opt in AUTOSAVE_INTERVAL_OPTIONS"
            :key="opt"
            class="seg-btn"
            :class="{ active: settings.autosaveIntervalSecs === opt }"
            :aria-pressed="settings.autosaveIntervalSecs === opt"
            @click="settings.autosaveIntervalSecs = opt"
          >
            {{ t(intervalKey(opt)) }}
          </button>
        </div>
      </div>
    </div>

    <div class="section">
      <span class="section-label">{{ t("settings.privacy") }}</span>

      <div class="field-row">
        <span class="field-label">{{ t("settings.hideFromLeaderboards") }}</span>
        <button
          class="toggle-btn"
          :class="{ active: settings.hideFromLeaderboards }"
          :aria-pressed="settings.hideFromLeaderboards"
          @click="settings.hideFromLeaderboards = !settings.hideFromLeaderboards"
        >
          {{ settings.hideFromLeaderboards ? "✓" : "✗" }}
        </button>
      </div>
    </div>

    <p class="version-line">
      {{ t("settings.versions", { frontend: frontendVersion, api: apiVersion ?? "—" }) }}
    </p>

    <template #actions>
      <div class="modal-actions">
        <button class="btn-cancel" :disabled="saving" @click="handleCancel">
          {{ t("settings.cancelBtn") }}
        </button>
        <button class="btn-close" :disabled="saving" @click="handleDone">
          {{ t("settings.closeBtn") }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.section {
  margin-bottom: 18px;
}
.section:last-of-type {
  margin-bottom: 22px;
}

.section-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
}

.field-label {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.seg-group {
  display: flex;
  gap: 4px;
}

.seg-btn {
  padding: 6px 12px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  transition: all var(--transition-fast);
}
.seg-btn:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}
.seg-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.toggle-btn {
  width: 32px;
  height: 28px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
  transition: all var(--transition-fast);
}
.toggle-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.version-line {
  font-size: 10.5px;
  color: var(--text-muted);
  text-align: center;
  border-top: 1px solid var(--border-subtle);
  padding-top: 10px;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 8px 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  transition: all var(--transition-fast);
}
.btn-cancel:hover:not(:disabled) { border-color: var(--accent); color: var(--text-primary); }
.btn-cancel:disabled { opacity: 0.6; cursor: not-allowed; }

.btn-close {
  padding: 8px 20px;
  background: var(--btn-buy-bg);
  border: 1px solid var(--btn-buy-bg);
  color: var(--btn-buy-text);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 700;
  transition: all var(--transition-fast);
}
.btn-close:hover:not(:disabled) { filter: brightness(1.1); }
.btn-close:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
