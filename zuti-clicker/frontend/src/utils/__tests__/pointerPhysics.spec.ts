import { describe, it, expect } from "vitest";
import { createPointerPhysicsTracker } from "@/utils/pointerPhysics";

// happy-dom's PointerEvent doesn't implement getCoalescedEvents, so these
// tests build plain objects matching the subset of the PointerEvent
// interface the tracker actually reads, cast through `as unknown as
// PointerEvent` — the tracker never touches anything beyond those fields.
function moveEvent(opts: {
  clientX: number;
  clientY: number;
  movementX: number;
  movementY: number;
  coalescedCount?: number;
  pointerType?: string;
}): PointerEvent {
  return {
    pointerType: opts.pointerType ?? "mouse",
    clientX: opts.clientX,
    clientY: opts.clientY,
    movementX: opts.movementX,
    movementY: opts.movementY,
    getCoalescedEvents:
      opts.coalescedCount !== undefined
        ? () => new Array(opts.coalescedCount).fill({} as PointerEvent)
        : undefined
  } as unknown as PointerEvent;
}

function downEvent(pressure: number, pointerType = "mouse"): PointerEvent {
  return { pointerType, pressure } as unknown as PointerEvent;
}

describe("createPointerPhysicsTracker", () => {
  it("reports no flags before enough samples have been seen", () => {
    const tracker = createPointerPhysicsTracker();
    for (let i = 0; i < 5; i++) {
      tracker.onPointerMove(moveEvent({ clientX: i, clientY: i, movementX: 1, movementY: 1 }));
    }
    expect(tracker.getFlags()).toEqual([]);
  });

  it("flags movementX/Y staying zero while clientX/Y visibly changes (the CDP synthesis tell)", () => {
    const tracker = createPointerPhysicsTracker();
    let x = 0;
    for (let i = 0; i < 25; i++) {
      x += 10;
      tracker.onPointerMove(moveEvent({ clientX: x, clientY: 0, movementX: 0, movementY: 0 }));
    }
    expect(tracker.getFlags()).toContain("movementInconsistent");
  });

  it("does not flag real-looking movement (movementX/Y consistent with clientX/Y deltas)", () => {
    const tracker = createPointerPhysicsTracker();
    let x = 0;
    for (let i = 0; i < 25; i++) {
      x += 10;
      tracker.onPointerMove(
        moveEvent({ clientX: x, clientY: 0, movementX: 10, movementY: 0, coalescedCount: 3 })
      );
    }
    expect(tracker.getFlags()).toEqual([]);
  });

  it("flags an absent coalesced-event buffer, isolated from the movementX/Y check", () => {
    const tracker = createPointerPhysicsTracker();
    // clientX/Y held constant with a matching zero movementX/Y (a neutral,
    // self-consistent "not moving" state) so the movementX/Y check never
    // independently supplies its own real-motion evidence — this isolates
    // getCoalescedEvents() always returning just the one event as the sole
    // signal under test.
    for (let i = 0; i < 25; i++) {
      tracker.onPointerMove(moveEvent({ clientX: 0, clientY: 0, movementX: 0, movementY: 0, coalescedCount: 1 }));
    }
    expect(tracker.getFlags()).toContain("noCoalescedEvents");
  });

  it("flags a pressure value frozen at a single non-zero constant across every pointerdown", () => {
    const tracker = createPointerPhysicsTracker();
    for (let i = 0; i < 10; i++) tracker.onPointerDown(downEvent(0.5));
    expect(tracker.getFlags()).toContain("frozenPressure");
  });

  it("does not flag pressure that's always exactly 0 (real non-pressure-sensitive mice)", () => {
    const tracker = createPointerPhysicsTracker();
    for (let i = 0; i < 10; i++) tracker.onPointerDown(downEvent(0));
    expect(tracker.getFlags()).not.toContain("frozenPressure");
  });

  it("does not flag naturally-varying pressure", () => {
    const tracker = createPointerPhysicsTracker();
    const pressures = [0.4, 0.51, 0.48, 0.55, 0.42, 0.5, 0.47];
    for (const p of pressures) tracker.onPointerDown(downEvent(p));
    expect(tracker.getFlags()).not.toContain("frozenPressure");
  });

  it("ignores non-mouse pointer types entirely (touch/pen have their own valid physics)", () => {
    const tracker = createPointerPhysicsTracker();
    for (let i = 0; i < 30; i++) {
      tracker.onPointerMove(
        moveEvent({ clientX: i, clientY: 0, movementX: 0, movementY: 0, pointerType: "touch" })
      );
    }
    for (let i = 0; i < 10; i++) tracker.onPointerDown(downEvent(0.5, "touch"));
    expect(tracker.getFlags()).toEqual([]);
  });
});
