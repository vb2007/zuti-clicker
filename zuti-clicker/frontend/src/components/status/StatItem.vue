<script setup lang="ts">
defineProps<{
  label: string;
  value: string;
  primary?: boolean;
  // Set while an active booster is multiplying this specific stat (see
  // StatusColumn's boosterProductionMultiplier/boosterClickMultiplier) —
  // switches the value to the booster accent and shows `badge` (e.g. "×7")
  // beside it, so the boost is visible right on the stat it affects instead
  // of only in the active-buff chip above the circle.
  boosted?: boolean;
  badge?: string;
}>();
</script>

<template>
  <div class="stat-item" :class="{ primary, boosted }">
    <span class="stat-label">{{ label }}</span>
    <span class="stat-value-group">
      <span v-if="boosted && badge" class="stat-badge">{{ badge }}</span>
      <span class="stat-value">{{ value }}</span>
    </span>
  </div>
</template>

<style scoped>
.stat-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.stat-item:hover {
  background: var(--bg-elevated);
}

.stat-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.stat-value-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
}

.primary .stat-label {
  color: var(--text-secondary);
}
.primary .stat-value {
  color: var(--accent-text);
  font-size: 16px;
}

/* Boosted state deliberately does not touch padding/height — only the
   value's color and a badge that fits inside the row's existing height, so
   a booster starting/ending never reflows the status column around it. */
.boosted .stat-value {
  color: var(--booster);
}

.stat-badge {
  font-size: 10px;
  font-weight: 700;
  color: var(--booster);
  background: var(--booster-glow);
  border-radius: var(--radius-full);
  padding: 1px 6px;
  font-variant-numeric: tabular-nums;
}
</style>
