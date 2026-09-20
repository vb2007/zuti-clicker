import { prisma } from "../prisma";
import type { AntiCheatMode } from "../../constants/antiCheat";

// Append-only — see the AntiCheatEvent model's own comment in schema.prisma
// for why this exists (tuning the detection thresholds against real
// traffic) and why it is never treated as a source of game-state truth.
// `severity` is "info" until services/antiCheat.ts's strike ladder (a later
// commit) actually applies a penalty for an event, at which point that
// service re-logs it as "strike" — logEvent itself never escalates.
export interface LogEventInput {
  userId: number;
  kind: string;
  severity: "info" | "strike";
  mode: AntiCheatMode;
  detail: unknown;
  enforced: boolean;
}

export async function logAntiCheatEvent(input: LogEventInput): Promise<void> {
  await prisma.antiCheatEvent.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      severity: input.severity,
      mode: input.mode,
      // Prisma's Json input type wants JsonValue, not `unknown` — a plain
      // JSON.parse(JSON.stringify(...)) round-trip is the simplest way to
      // satisfy that without hand-writing a recursive type guard, and it's
      // cheap: these payloads are small diagnostic objects, not save data.
      detail: JSON.parse(JSON.stringify(input.detail)),
      enforced: input.enforced
    }
  });
}
