# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

General, global users of a free browser-based idle/incremental ("clicker") game — no account required to play. Anyone who enjoys the idle-game genre; also anyone who recognizes or is curious about the tribute theme. Optional account creation is for players who want their progress synced and preserved across sessions and devices.

## Product Purpose

An idle/incremental game: the player clicks a central character portrait to earn tokens, then spends tokens on units that boost and eventually automate token production, with costs and output scaling exponentially so progression never fully ends. The project originated as a tribute to a former teacher ("Dr. Zuti Pál") and continues in active development as a FOSS browser game for general public use. Success is a frictionless, engaging progression loop: instantly playable with zero setup, legible at every step (visible stats and cost/gain breakdowns), and endless without becoming opaque.

## Positioning

A personal, characterful take on the idle-clicker genre, built around commemorating a specific real person's persona and memorable catchphrases rather than a generic or corporate skin — a mechanism a template clicker clone could not truthfully copy. Distributed as FOSS (AGPL-3.0-only), unlike most closed-source idle games.

## Operating Context

Runs entirely in the browser, no installation. Playable immediately as a guest — progress lives only in memory and is lost on refresh/close, with an explicit warning and a beforeunload confirmation once progress exists. Prestige (and with it the Academic Career) needs an account: a guest who reaches a PhD is nudged to log in or register, and the guest's run carries over into a new account. Authenticated play adds server-backed persistence (MariaDB via an Express/Prisma API): manual "Sync," optional autosave on a selectable interval (15s/30s/1m/5m), and permanent save deletion. UI is bilingual (English/Hungarian) with instant switching, and supports dark/light themes.

## Capabilities and Constraints

- Core loop: click-to-earn plus purchasable units that add passive tokens/sec and reduce reliance on manual clicking.
- Bulk purchasing via a multiplier selector (1x/5x/10x/50x/Max).
- Units stay hidden until total tokens earned reaches 10% of that unit's base cost, so the shop reveals itself progressively.
- Guest mode and authenticated mode are both first-class; switching between them must not feel like a bait-and-switch.
- Unit names and flavor text (currently Alpha–Theta with generic sci-fi descriptions) are an explicit placeholder, not final content — the intended direction is to replace them with the honored teacher's actual memorable professional jargon/catchphrases. Undecided: the specific phrases and how they map to units.
- Only publicly available imagery of the honored teacher is used, and treatment of him must stay respectful and factual — never mocking, never fabricated — in any current or future copy, unit theming, or narrative content.

## Brand Commitments

- Name: "Zuti Clicker."
- The game is an explicit, respectful tribute to a real former teacher, "Dr. Zuti Pál"; his likeness (a publicly available portrait image) and eventual catchphrase-based content are core to the concept, not incidental theming.
- License: AGPL-3.0-only.

## Evidence on Hand

- A working implementation already exists: Vue 3 + TypeScript frontend (click loop, unit shop with tooltips, auth, save/sync controls, i18n, theming) and an Express/Prisma/MariaDB API.
- Honored teacher's portrait: `zuti-clicker/frontend/src/assets/images/zutiy.jpg`.
- No press mentions, testimonials, or case studies exist for this project — none should be invented.

## Product Principles

1. Zero-friction entry: instantly playable with no login; accounts are strictly optional and exist only for cross-session/device persistence.
2. Respect the tribute: any content referencing the honored teacher must stay affectionate and grounded in real, public facts — never invented or mocking.
3. FOSS-first: open development, no monetization dark patterns or vendor lock-in implied by current scope.
4. Endless but legible: exponential scaling stays transparent to the player through visible stats and cost/gain breakdowns, not just a rising number.
5. Global-ready: bilingual today, structured to add more locales, and built to meet general idle-game genre expectations for a worldwide audience.

## Accessibility & Inclusion

Basic WCAG-level care expected: accessible color contrast, keyboard navigability, and readable text in both the dark and light themes, even without a formal compliance mandate.
