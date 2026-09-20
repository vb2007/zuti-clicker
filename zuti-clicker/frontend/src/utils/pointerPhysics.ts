// Pointer-physics consistency checks — Layer 2's corroborating (NOT
// zero-false-positive) signals. This is what separates CDP-driven
// automation (Playwright/Puppeteer, which produces real isTrusted:true
// events) from an actual mouse: synthetic input drops metadata the real
// input pipeline fills in. Feeds AntiCheatDigest.weakSignals, which the
// server scores at weight 1 alongside its own statistical signals — never
// decisive alone, since unusual-but-real hardware/drivers can occasionally
// look inconsistent too.
//
// Deliberately mouse-only: touch, pen, and keyboard/assistive-technology
// input all have their own valid physics this module doesn't attempt to
// model, so every check here is gated on pointerType === "mouse" and on
// having seen enough samples to judge at all.
const MIN_MOVE_SAMPLES_TO_JUDGE = 20;
const MIN_PRESSURE_SAMPLES_TO_JUDGE = 5;
const COALESCED_EMPTY_STREAK_THRESHOLD = 20;
const MOVEMENT_INCONSISTENT_THRESHOLD = 10;
const CLIENT_DELTA_EPSILON_PX = 1;

export interface PointerPhysicsTracker {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  getFlags: () => string[];
}

export function createPointerPhysicsTracker(): PointerPhysicsTracker {
  let moveSamples = 0;
  let coalescedEmptyStreak = 0;
  let sawRealMotionEvidence = false;
  let movementInconsistentCount = 0;
  let lastClientX: number | null = null;
  let lastClientY: number | null = null;
  let pressureDownCount = 0;
  const pressureSamples = new Set<number>();

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== "mouse") return;
    moveSamples++;

    if (typeof e.getCoalescedEvents === "function") {
      const coalesced = e.getCoalescedEvents();
      if (coalesced.length > 1) sawRealMotionEvidence = true;
      else coalescedEmptyStreak++;
    }

    if (lastClientX !== null && lastClientY !== null) {
      const dx = e.clientX - lastClientX;
      const dy = e.clientY - lastClientY;
      const clientMoved = Math.abs(dx) > CLIENT_DELTA_EPSILON_PX || Math.abs(dy) > CLIENT_DELTA_EPSILON_PX;
      const reportedNoMovement = e.movementX === 0 && e.movementY === 0;
      if (clientMoved && reportedNoMovement) {
        movementInconsistentCount++;
      } else if (!reportedNoMovement) {
        sawRealMotionEvidence = true;
      }
    }
    lastClientX = e.clientX;
    lastClientY = e.clientY;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "mouse") return;
    pressureDownCount++;
    // Rounded to avoid float noise turning two genuinely-identical readings
    // into "different" samples.
    pressureSamples.add(Math.round(e.pressure * 1000));
  }

  function getFlags(): string[] {
    const flags: string[] = [];

    // Movement-based signals need enough move samples to judge; pressure is
    // judged independently off its own (pointerdown) sample count — a
    // session with plenty of clicks but little cursor movement should still
    // get a pressure verdict, and vice versa.
    if (moveSamples >= MIN_MOVE_SAMPLES_TO_JUDGE) {
      if (!sawRealMotionEvidence && coalescedEmptyStreak >= COALESCED_EMPTY_STREAK_THRESHOLD) {
        flags.push("noCoalescedEvents");
      }
      if (movementInconsistentCount >= MOVEMENT_INCONSISTENT_THRESHOLD) {
        flags.push("movementInconsistent");
      }
    }

    // pressure === 0 is excluded — many real, non-pressure-sensitive mice
    // always report exactly 0, which would otherwise flag every one of them.
    if (
      pressureDownCount >= MIN_PRESSURE_SAMPLES_TO_JUDGE &&
      pressureSamples.size === 1 &&
      !pressureSamples.has(0)
    ) {
      flags.push("frozenPressure");
    }
    return flags;
  }

  return { onPointerDown, onPointerMove, getFlags };
}
