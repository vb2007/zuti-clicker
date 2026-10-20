// The grace-lead ledger: one clock-grace budget per save chain, instead of
// CLOCK_GRACE_SECS granted to every save on its own (which let a script saving
// ten times a second claim ~51x real playtime and clicks). See
// SAVE_LEAD_CAP_SECS in constants/antiCheat.ts for why an honest client never
// builds a lead, and controllers/save.ts for where a refusal is answered.
//
// Pure: the controller reads the stored lead, asks this module what grace the
// envelope may use and whether the save fits, and stores `nextLead` with it.
import {
  CLOCK_GRACE_SECS,
  SAVE_LEAD_CAP_SECS,
  SAVE_LEAD_DECAY_PER_SEC,
  SAVE_LEAD_ENFORCE_EARNINGS
} from "../constants/antiCheat";

export interface GraceLeadNeeds {
  elapsed: number;
  clicks: number;
  earnings: number;
}

export interface GraceLeadDecision {
  // The stored lead after draining for this interval.
  lead: number;
  // The clock grace the envelope may use for this save: never less than
  // CLOCK_GRACE_SECS (so never stricter than before the ledger), and more
  // when the budget has room — an upload that stalled past the fixed grace
  // used to be struck on the save right after it.
  graceSecs: number;
  // The grace this save draws (negative: it gives some back), clamped to what
  // the envelope allows — whatever is over that, the envelope clamps away.
  need: number;
  // What to store on the written save.
  nextLead: number;
  // Seconds this save would put the chain over the cap; > 0 means refuse it.
  overBy: number;
  // When to try again: by then the lead has drained enough (the claim and the
  // interval grow together while the client waits, so the need doesn't change).
  retryAfterMs: number;
  // Earnings alone would have put it over (logged while they aren't enforced).
  earningsWouldRefuse: boolean;
}

// A save whose need is clamped to the grace lands exactly on the cap; float
// noise in lead + (cap - lead) must not read as being over it.
const OVER_EPSILON_SECS = 1e-6;

export function decideGraceLead(
  storedLead: number,
  dtRealSecs: number,
  needs: GraceLeadNeeds
): GraceLeadDecision {
  const lead = Math.max(0, storedLead - SAVE_LEAD_DECAY_PER_SEC * Math.max(0, dtRealSecs));
  const graceSecs = Math.max(CLOCK_GRACE_SECS, SAVE_LEAD_CAP_SECS - lead);
  // Nothing can be banked: the lead never goes below 0, so a save claiming
  // less than the clock gives back at most what the chain is ahead by.
  const clamp = (need: number) => Math.min(graceSecs, Math.max(-lead, need));
  const timeNeed = Math.max(needs.elapsed, needs.clicks);
  const need = clamp(SAVE_LEAD_ENFORCE_EARNINGS ? Math.max(timeNeed, needs.earnings) : timeNeed);
  const over = (n: number) => lead + n - SAVE_LEAD_CAP_SECS > OVER_EPSILON_SECS;
  const overBy = over(need) ? lead + need - SAVE_LEAD_CAP_SECS : 0;
  return {
    lead,
    graceSecs,
    need,
    nextLead: Math.min(SAVE_LEAD_CAP_SECS, Math.max(0, lead + need)),
    overBy,
    retryAfterMs: Math.ceil((overBy / SAVE_LEAD_DECAY_PER_SEC) * 1000),
    earningsWouldRefuse: overBy === 0 && over(clamp(Math.max(timeNeed, needs.earnings)))
  };
}
