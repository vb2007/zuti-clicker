<script setup lang="ts">
// One stroke-drawn glyph per branch (and the root's mortarboard), in a single
// 24-unit grid and 1.7 stroke so the whole tree reads as one family.
import type { CareerBranch } from "@/utils/careerCore";

defineProps<{ branch: CareerBranch | "root"; size?: number }>();

const PATHS: Record<CareerBranch | "root", string> = {
  root: "M2 9.5 12 4.5l10 5-10 5zM6.5 11.75V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.25M22 9.5v5.5",
  research: "M9.5 3h5M10.5 3v6.2L5.2 18.6A1.6 1.6 0 0 0 6.6 21h10.8a1.6 1.6 0 0 0 1.4-2.4L13.5 9.2V3M7.4 15h9.2",
  lecturing: "M3.5 4.5h17v11h-17zM8 20l4-4.5 4 4.5M7 8.5h6M7 11.5h9",
  administration: "M3 20.5h18M5 20.5V10M9.7 20.5V10M14.3 20.5V10M19 20.5V10M2.5 9.5 12 4l9.5 5.5z",
  conferences: "M8 2.5l4 5 4-5M6.5 8h11v13h-11zM9.5 13h5M9.5 16.5h5",
  thesis: "M5 4h10.5A2.5 2.5 0 0 1 18 6.5V20H7.5A2.5 2.5 0 0 1 5 17.5zM5 17.5A2.5 2.5 0 0 1 7.5 15H18M9 8h5",
  lab: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M5.3 18.7l2-2M16.7 7.3l2-2"
};
</script>

<template>
  <svg
    :width="size ?? 22"
    :height="size ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[branch]" />
  </svg>
</template>
