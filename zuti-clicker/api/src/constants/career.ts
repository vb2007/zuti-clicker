// Academic Career rules that only the server needs — the catalog and the
// shared purchase rules live in services/careerCore.ts.

// The purchase window stays open until Skip/Done (POST /career/close) — but
// never into a run that has actually started. The client pauses the game
// while the window is open, so an honest save made during it carries no run
// clicks and (bar this much timing slack) no run time. A save that shows the
// run under way closes the window, making its purchases permanent: otherwise
// a node bought "at the prestige" could be used for a whole run and then
// refunded at full price right before the next one.
export const CAREER_WINDOW_RUN_GRACE_SECS = 5;
