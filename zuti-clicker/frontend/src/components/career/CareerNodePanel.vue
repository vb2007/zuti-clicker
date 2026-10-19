<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useCareer } from "@/composables/useCareer";
import { CAREER_NODES, CAREER_NODES_BY_ID, getCareerModifiers } from "@/utils/careerCore";
import { getCareerPhdProductionMultiplier } from "@/utils/careerEconomy";
import {
  careerNodeName,
  careerNodeFlavor,
  careerEffectText,
  careerNodeState,
  appliesFromNextPrestige
} from "@/utils/careerText";
import { formatNumber } from "@/utils/formatters";
import CareerIcon from "./CareerIcon.vue";

/**
 * What the selected Academic Career node does and what can be done with it —
 * the side panel on wide screens, the bottom sheet on phones (the overlay
 * decides which; this only renders the content). Buying shows its trade-off
 * up front: the PhDs it costs stop boosting production, so the held-PhD bonus
 * before and after is part of the decision, not a surprise afterwards.
 */
const props = defineProps<{ nodeId: string | null; sheet?: boolean }>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();

const { t } = useI18n();
const game = useGameStore();
const career = useCareer();

const node = computed(() => (props.nodeId ? (CAREER_NODES_BY_ID.get(props.nodeId) ?? null) : null));
const ownedMap = computed(
  () => new Map(game.careerNodes.map((n) => [n.nodeId, { refundable: n.refundable }]))
);
const state = computed(() =>
  node.value
    ? careerNodeState(node.value, ownedMap.value, game.phdCount, game.careerWindowOpen)
    : null
);
const parent = computed(() =>
  node.value?.parent ? (CAREER_NODES_BY_ID.get(node.value.parent) ?? null) : null
);
const paid = computed(
  () => game.careerNodes.find((n) => n.nodeId === props.nodeId)?.cost ?? node.value?.cost ?? 0
);
const refundPreview = computed(() =>
  props.nodeId && state.value === "refundable" ? game.careerRefundPreview(props.nodeId) : null
);

const fmtMult = (m: number) => m.toFixed(2);
const tradeoff = computed(() => {
  if (!node.value || state.value !== "buyable") return null;
  const after = getCareerPhdProductionMultiplier(
    game.phdCount - node.value.cost,
    getCareerModifiers([...game.careerNodeIds, node.value.id])
  );
  return { before: fmtMult(game.productionMultiplier), after: fmtMult(after) };
});

const busy = ref(false);
const announcement = ref("");

async function onBuy(e: MouseEvent): Promise<void> {
  if (!node.value || busy.value) return;
  const name = careerNodeName(t, node.value);
  busy.value = true;
  try {
    if (await career.buy(node.value.id, e)) announcement.value = t("career.bought", { name });
  } finally {
    busy.value = false;
  }
}

async function onRefund(e: MouseEvent): Promise<void> {
  const preview = refundPreview.value;
  if (!node.value || !preview || busy.value) return;
  busy.value = true;
  try {
    if (await career.refund(node.value.id, e)) {
      announcement.value = t("career.refunded", {
        count: preview.nodeIds.length,
        phd: formatNumber(preview.phd)
      });
    }
  } finally {
    busy.value = false;
  }
}

const ownedCount = computed(() => game.careerNodes.length);
</script>

<template>
  <section
    class="node-panel"
    :class="{ sheet }"
    :aria-label="node ? careerNodeName(t, node) : t('career.title')"
  >
    <template v-if="node && state">
      <header class="panel-head">
        <span class="badge" :class="`badge-${state}`">
          <CareerIcon :branch="node.branch" :size="20" />
        </span>
        <div class="titles">
          <h3 class="name">{{ careerNodeName(t, node) }}</h3>
          <span class="branch">{{ t(`career.branches.${node.branch}`) }}</span>
        </div>
        <button
          v-if="sheet"
          type="button"
          class="close"
          :aria-label="t('common.close')"
          @click="emit('close')"
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
      </header>

      <p v-if="careerNodeFlavor(t, node)" class="flavor">{{ careerNodeFlavor(t, node) }}</p>
      <p class="effect">{{ careerEffectText(t, node) }}</p>
      <p v-if="appliesFromNextPrestige(node)" class="note">{{ t("career.nextPrestige") }}</p>

      <dl class="cost-row">
        <dt>{{ t("career.cost") }}</dt>
        <dd>
          {{ formatNumber(state === "owned" || state === "refundable" ? paid : node.cost) }} PhD
        </dd>
      </dl>

      <div class="action">
        <template v-if="state === 'refundable' && refundPreview">
          <p class="hint">{{ t("career.refundNote") }}</p>
          <button type="button" class="btn-secondary" :disabled="busy" @click="onRefund">
            {{
              busy
                ? t("career.busy")
                : refundPreview.nodeIds.length > 1
                  ? t("career.refundCascade", {
                      count: refundPreview.nodeIds.length,
                      phd: formatNumber(refundPreview.phd)
                    })
                  : t("career.refundOne", { phd: formatNumber(refundPreview.phd) })
            }}
          </button>
        </template>
        <p v-else-if="state === 'owned'" class="hint owned">{{ t("career.owned") }}</p>
        <p v-else-if="state === 'locked' && parent" class="hint">
          <i18n-t keypath="career.locked" tag="span">
            <template #name>
              <button type="button" class="link" @click="emit('select', parent.id)">
                {{ careerNodeName(t, parent) }}
              </button>
            </template>
          </i18n-t>
        </p>
        <p v-else-if="!game.careerWindowOpen" class="hint">{{ t("career.viewOnly") }}</p>
        <template v-else>
          <p v-if="tradeoff" class="tradeoff">
            {{ t("career.tradeoff", tradeoff) }}
          </p>
          <p v-else class="hint">
            {{
              t("career.needPhd", {
                cost: formatNumber(node.cost),
                held: formatNumber(game.phdCount)
              })
            }}
          </p>
          <button
            type="button"
            class="btn-primary"
            :disabled="state !== 'buyable' || busy || game.serverActionPending"
            @click="onBuy"
          >
            {{ busy ? t("career.busy") : t("career.buy", { cost: formatNumber(node.cost) }) }}
          </button>
        </template>
      </div>
    </template>

    <template v-else>
      <p class="empty">{{ t("career.selectHint") }}</p>
      <ul class="legend">
        <li><span class="swatch state-owned"></span>{{ t("career.legendOwned") }}</li>
        <li><span class="swatch state-refundable"></span>{{ t("career.legendRefundable") }}</li>
        <li><span class="swatch state-buyable"></span>{{ t("career.legendBuyable") }}</li>
        <li><span class="swatch state-locked"></span>{{ t("career.legendLocked") }}</li>
      </ul>
      <p class="progress">
        {{ t("career.progress", { owned: ownedCount, total: CAREER_NODES.length }) }}
      </p>
    </template>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<style scoped>
.node-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 18px;
  color: var(--text-primary);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
}
.badge-owned,
.badge-refundable {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.badge-buyable {
  border-color: var(--accent);
  color: var(--accent-text);
}
.titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.name {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.branch {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -8px -8px -8px 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
}

.flavor {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.effect {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
  color: var(--accent-text);
}
.note {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--booster);
}

.cost-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0;
  padding: 10px 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 13px;
}
.cost-row dt {
  color: var(--text-secondary);
  font-weight: 600;
}
.cost-row dd {
  margin: 0;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.action {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.hint.owned {
  color: var(--success);
  font-weight: 700;
}
.tradeoff {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.link {
  padding: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.btn-primary,
.btn-secondary {
  min-height: 44px;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 700;
  transition:
    filter var(--transition-fast),
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}
.btn-primary {
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
}
.btn-primary:disabled {
  background: var(--btn-dis-bg);
  color: var(--btn-dis-text);
  cursor: not-allowed;
}
.btn-secondary {
  background: transparent;
  border: 1.5px dashed var(--booster);
  color: var(--text-primary);
}
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: wait;
}
@media (hover: hover) {
  .btn-primary:not(:disabled):hover {
    filter: brightness(1.08);
  }
  .btn-secondary:not(:disabled):hover {
    background: var(--booster-glow);
  }
}

.empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.swatch {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
}
.swatch.state-owned,
.swatch.state-refundable {
  background: var(--accent);
  border-color: var(--accent);
}
.swatch.state-refundable {
  outline: 1.5px dashed var(--booster);
  outline-offset: 2px;
}
.swatch.state-buyable {
  border: 2px solid var(--accent);
}
.swatch.state-locked {
  border-style: dashed;
  border-color: var(--text-muted);
}
.progress {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
