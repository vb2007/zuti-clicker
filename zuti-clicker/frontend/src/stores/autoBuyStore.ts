import { defineStore } from "pinia";
import { ref, watch } from "vue";

// Per-viewer on/off switches for the Academic Career's auto-buyers (Purchasing
// Officer / Upgrade Clerk). A convenience preference, not progress: kept in
// this browser's localStorage only, never synced, and safe to lose — every
// access is wrapped, and it defaults to on (the player bought the node).
const STORAGE_KEY = "zuti-clicker:autobuy";

function read(): { units: boolean; upgrades: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return {
      units: typeof raw["units"] === "boolean" ? raw["units"] : true,
      upgrades: typeof raw["upgrades"] === "boolean" ? raw["upgrades"] : true
    };
  } catch {
    return { units: true, upgrades: true };
  }
}

export const useAutoBuyStore = defineStore("autoBuy", () => {
  const initial = read();
  const unitsEnabled = ref(initial.units);
  const upgradesEnabled = ref(initial.upgrades);

  watch([unitsEnabled, upgradesEnabled], ([units, upgrades]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ units, upgrades }));
    } catch {
      // A private window or blocked storage: the switch still works this session.
    }
  });

  return { unitsEnabled, upgradesEnabled };
});
