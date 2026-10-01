<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { useSaveStore } from "@/stores/saveStore";
import { useUiStore } from "@/stores/uiStore";

const { t } = useI18n();
const auth = useAuthStore();
const save = useSaveStore();
const ui = useUiStore();

// --- Sync button feedback ---
const syncJustCompleted = ref(false);
let _fbTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => save.isSyncing,
  (syncing, wasSyncing) => {
    if (wasSyncing && !syncing && !save.syncError) {
      syncJustCompleted.value = true;
      if (_fbTimer) clearTimeout(_fbTimer);
      _fbTimer = setTimeout(() => {
        syncJustCompleted.value = false;
      }, 3000);
    }
  }
);

onUnmounted(() => {
  if (_fbTimer) clearTimeout(_fbTimer);
});

// --- User dropdown ---
const userMenuRef = ref<HTMLElement | null>(null);
const userMenuOpen = ref(false);

function onDocClick(e: MouseEvent) {
  if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
    userMenuOpen.value = false;
  }
}
onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));

function openAuthModal() {
  ui.authModalOpen = true;
}

function openDeleteConfirm() {
  userMenuOpen.value = false;
  ui.confirmDeleteOpen = true;
}

async function logout() {
  userMenuOpen.value = false;
  await auth.logout();
}
</script>

<template>
  <!-- Guest state -->
  <div v-if="!auth.isLoggedIn" class="save-bar">
    <button class="ctrl-btn save-guest-btn" :title="t('save.loginToSave')" @click="openAuthModal">
      <span>💾</span>
      <span class="btn-label">{{ t("save.loginToSave") }}</span>
    </button>
  </div>

  <!-- Logged-in state -->
  <div v-else class="save-bar">
    <!-- Sync button -->
    <button
      class="ctrl-btn sync-btn"
      :class="{
        syncing: save.isSyncing,
        synced: syncJustCompleted,
        'sync-error': !!save.syncError
      }"
      :disabled="save.isSyncing"
      :title="save.syncError ?? (save.lastSyncedAt ? save.lastSyncedAt.toLocaleTimeString() : t('save.neverSynced'))"
      @click="save.sync()"
    >
      <span class="sync-icon" :class="{ spinning: save.isSyncing }">
        {{ save.isSyncing ? "⟳" : syncJustCompleted ? "✓" : "↑" }}
      </span>
      <span class="btn-label">{{ save.isSyncing ? t("save.syncing") : t("save.sync") }}</span>
    </button>

    <!-- User dropdown -->
    <div ref="userMenuRef" class="user-menu">
      <button
        class="ctrl-btn user-btn"
        :title="auth.user?.username"
        @click.stop="userMenuOpen = !userMenuOpen"
      >
        <span>👤</span>
        <span class="username">{{ auth.user?.username }}</span>
        <span class="chevron">{{ userMenuOpen ? "▴" : "▾" }}</span>
      </button>

      <div v-if="userMenuOpen" class="dropdown-menu">
        <button class="dropdown-item danger" @click="openDeleteConfirm">
          {{ t("save.deleteSave") }}
        </button>
        <button class="dropdown-item" @click="logout">
          {{ t("save.logout") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.save-bar {
  display: flex;
  align-items: center;
  gap: 4px;
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
  transition: all var(--transition-fast);
  white-space: nowrap;
}
@media (hover: hover) {
  .ctrl-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-text);
    background: var(--bg-hover);
  }
}
.ctrl-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.save-guest-btn { border-color: var(--accent); color: var(--accent-text); }
@media (hover: hover) {
  .save-guest-btn:hover { background: var(--accent); color: #fff; }
}

.sync-btn.synced { border-color: var(--success); color: var(--success); }
.sync-btn.sync-error { border-color: var(--danger); color: var(--danger); }

@keyframes spin { to { transform: rotate(360deg); } }
.sync-icon.spinning { display: inline-block; animation: spin 0.7s linear infinite; }

.user-menu { position: relative; }

.username { max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
.chevron { font-size: 10px; opacity: 0.6; margin-left: 2px; }

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  min-width: 150px;
  z-index: 200;
  overflow: hidden;
  animation: fadeScaleIn 140ms ease;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 500;
  background: transparent;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
@media (hover: hover) {
  .dropdown-item:hover { background: var(--bg-hover); color: var(--text-primary); }
}
.dropdown-item.danger { color: var(--danger); }
@media (hover: hover) {
  .dropdown-item.danger:hover { background: rgba(248, 113, 113, 0.08); }
}

@media (max-width: 759px) {
  /* Icon-only: the header is already tight below 760px (see AppHeader.vue),
     and the title attribute on each button still exposes the full label. */
  .btn-label,
  .username {
    display: none;
  }

}

/* Touch: phone sheet layouts and tablets alike (a coarse pointer above 760px
   gets the same 44px targets). */
@media (max-width: 759px), (pointer: coarse) {
  .ctrl-btn {
    min-width: 44px;
    min-height: 44px;
    justify-content: center;
  }
  .dropdown-item {
    min-height: 44px;
  }
}
</style>
