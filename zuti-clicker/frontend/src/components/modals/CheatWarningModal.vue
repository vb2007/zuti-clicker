<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { formatTime } from "@/utils/formatters";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();
const antiCheat = useAntiCheatStore();

// Dismissing only closes THIS modal — the restriction underneath (every
// click/purchase/prestige button staying disabled) is untouched, since
// antiCheat.isRestricted is what those actually check, not this flag. A NEW
// restriction (a different restrictedUntil, e.g. the very next strike) resets
// the dismissal so it reliably reappears rather than staying silenced.
const dismissed = ref(false);
watch(
  () => antiCheat.restrictedUntil?.getTime(),
  () => {
    dismissed.value = false;
  }
);

const visible = computed(() => antiCheat.isRestricted && !dismissed.value);

const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  // Purely local — just advances the displayed countdown, never touches
  // the network. Kept entirely separate from the server-check below.
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (tickTimer !== null) clearInterval(tickTimer);
});

// The countdown can reach zero before the next scheduled heartbeat confirms
// the restriction actually lifted — ask right when it should expire,
// instead of leaving the player blocked for up to another heartbeat
// interval past when they can see it should be over.
//
// Regression #1: this used to be a per-second poll (re-checking "is now
// past restrictedUntil" inside the 1s countdown tick above) — if that
// single fetchStatus() call ever failed (network blip) or the server's
// clock lagged slightly behind the client's, restrictedUntil never
// changed, so the SAME stale comparison kept re-firing every second,
// forever, for the rest of the session, with no backoff and no cap.
//
// Regression #2 (found in review of the fix for #1): replacing the poll
// with a single one-shot timer, rescheduled only via a `watch` on
// restrictedUntil's own timestamp, has its own gap — if the server's
// re-check says "still restricted" with the EXACT SAME restrictedUntil
// (its clock lagging slightly behind the client's right at the boundary —
// the most likely reason a re-check ever comes back unchanged), that
// timestamp never changes, so the watch alone never fires again and the
// modal sits stuck at "0:00" with isRestricted still true.
//
// Final design: every fetchStatus() call (success OR failure — it never
// throws, see antiCheatStore.ts) reschedules exactly one more check via
// its own `.finally`, not just the watch. RETRY_BACKOFF_MS bounds this to
// once every 5s once already past the deadline, so it can never turn back
// into the per-second storm from regression #1 while still converging
// (via either the watch, once restrictedUntil actually changes, or this
// backoff, once the server's clock also passes the deadline) instead of
// getting stuck the way regression #2 did.
const RETRY_BACKOFF_MS = 5000;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}
function scheduleExpiryCheck(): void {
  clearExpiryTimer();
  if (antiCheat.restrictedUntil === null) return;
  const msRemaining = antiCheat.restrictedUntil.getTime() - Date.now();
  // A small buffer past the exact deadline absorbs client/server clock
  // skew without costing the player anything beyond a fraction of a second.
  // Once already past deadline (this is itself a retry), back off instead
  // of hammering the endpoint again immediately.
  const delay = msRemaining > 0 ? msRemaining + 250 : RETRY_BACKOFF_MS;
  expiryTimer = setTimeout(() => {
    void antiCheat.fetchStatus().finally(scheduleExpiryCheck);
  }, delay);
}
watch(() => antiCheat.restrictedUntil?.getTime(), scheduleExpiryCheck, { immediate: true });
onUnmounted(clearExpiryTimer);

const remainingLabel = computed(() => {
  if (antiCheat.restrictedUntil === null) return "";
  const remainingSecs = Math.max(0, Math.ceil((antiCheat.restrictedUntil.getTime() - now.value) / 1000));
  return formatTime(remainingSecs);
});

function dismiss() {
  dismissed.value = true;
}
</script>

<template>
  <BaseModal
    :open="visible"
    role="alertdialog"
    :title="t('anticheat.title')"
    :max-width="420"
    :z-index="1200"
    :dismiss-on-backdrop="false"
    center-content
    @close="dismiss"
  >
    <div class="modal-icon" aria-hidden="true">⏳</div>
    <p class="modal-body">{{ t("anticheat.body") }}</p>
    <div class="countdown">
      <span class="countdown-label">{{ t("anticheat.timeRemaining") }}</span>
      <span class="countdown-value">{{ remainingLabel }}</span>
    </div>
    <p v-if="antiCheat.strikeCount > 1" class="strike-note">
      {{ t("anticheat.strikeNote", { count: antiCheat.strikeCount }) }}
    </p>
    <template #actions>
      <div class="modal-actions">
        <button class="btn-primary" @click="dismiss">{{ t("anticheat.dismissBtn") }}</button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.modal-icon {
  font-size: 40px;
  margin-bottom: 14px;
  line-height: 1;
}

.modal-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 18px;
}

.countdown {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--danger);
  margin-bottom: 16px;
}

.countdown-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.countdown-value {
  font-size: 22px;
  font-weight: 800;
  color: var(--danger);
  font-variant-numeric: tabular-nums;
}

.strike-note {
  font-size: 12px;
  color: var(--danger);
  line-height: 1.5;
  margin-bottom: 20px;
}

.modal-actions {
  display: flex;
  justify-content: center;
}

.btn-primary {
  padding: 10px 20px;
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 700;
  transition: background var(--transition-fast);
}
.btn-primary:hover {
  background: var(--accent-dim);
}
</style>
