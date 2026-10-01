import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper, type VueWrapper } from "@vue/test-utils";
import LeaderboardModal from "@/components/modals/LeaderboardModal.vue";
import { useUiStore } from "@/stores/uiStore";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    leaderboard: {
      get: vi.fn()
    }
  },
  ApiError: class ApiError extends Error {}
}));

describe("LeaderboardModal", () => {
  // Same leak hazard BaseModal has everywhere else (see SettingsModal.spec.ts):
  // an open-and-abandoned instance leaves a window keydown listener behind.
  let activeWrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.mocked(api.leaderboard.get).mockReset();
    vi.mocked(api.leaderboard.get).mockResolvedValue({
      metric: "tokens",
      entries: [
        { rank: 1, username: "alice", value: 1000 },
        { rank: 2, username: "bob", value: 500 }
      ],
      viewer: { rank: 2, value: 500, hidden: false }
    });
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
    document.body.innerHTML = "";
  });

  function openModal() {
    const ui = useUiStore();
    const wrapper = mount(LeaderboardModal);
    activeWrapper = wrapper;
    ui.leaderboardModalOpen = true;
    return wrapper;
  }

  it("fetches the default tokens metric when opened", async () => {
    openModal();
    await nextTick();
    await Promise.resolve();

    expect(api.leaderboard.get).toHaveBeenCalledWith("tokens");
  });

  it("renders the returned entries", async () => {
    openModal();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    const rows = body.findAll(".board-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text()).toContain("alice");
    expect(rows[1]!.text()).toContain("bob");
  });

  it("switching the metric tab fetches the new metric", async () => {
    openModal();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    const clicksBtn = body.findAll(".seg-btn").find((b) => b.text() === "Clicks")!;
    await clicksBtn.trigger("click");

    expect(api.leaderboard.get).toHaveBeenLastCalledWith("clicks");
  });

  it("shows the empty state when there are no entries", async () => {
    vi.mocked(api.leaderboard.get).mockResolvedValue({
      metric: "tokens",
      entries: [],
      viewer: null
    });
    openModal();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    expect(body.find(".board-status").text()).toBe("No players on this leaderboard yet.");
  });

  it("shows an error state when the request fails", async () => {
    vi.mocked(api.leaderboard.get).mockRejectedValue(new Error("network down"));
    openModal();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    expect(body.find(".board-status").text()).toBe("Couldn't load the leaderboard.");
  });

  it("pins the viewer's own rank below the list when they're outside the returned entries", async () => {
    vi.mocked(api.leaderboard.get).mockResolvedValue({
      metric: "tokens",
      entries: [{ rank: 1, username: "alice", value: 1000 }],
      viewer: { rank: 42, value: 3, hidden: false }
    });
    openModal();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    const pinned = body.find(".board-row.pinned");
    expect(pinned.exists()).toBe(true);
    expect(pinned.text()).toContain("42");
  });

  it("does not duplicate a pinned row when the viewer is already among the entries", async () => {
    openModal(); // default mock: viewer rank 2, already in entries
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    expect(body.find(".board-row.pinned").exists()).toBe(false);
  });

  it("shows a hidden note when the viewer has opted out", async () => {
    vi.mocked(api.leaderboard.get).mockResolvedValue({
      metric: "tokens",
      entries: [{ rank: 1, username: "alice", value: 1000 }],
      viewer: { rank: 1, value: 1000, hidden: true }
    });
    openModal();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const body = new DOMWrapper(document.body);
    expect(body.find(".hidden-note").exists()).toBe(true);
  });

  // Regression: the leaderboard had no close control at all — on a phone the
  // only way out was the 20px backdrop gutter (no Escape key either), so
  // players had to refresh the page to get the game back.
  it("regression: has a labelled close button that closes it", async () => {
    openModal();
    await nextTick();

    const body = new DOMWrapper(document.body);
    const close = body.find(".modal-close");
    expect(close.exists()).toBe(true);
    expect(close.attributes("aria-label")).toBe("Close");

    await close.trigger("click");
    expect(useUiStore().leaderboardModalOpen).toBe(false);
  });
});
