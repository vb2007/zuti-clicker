// Academic Career — the persistent PhD tree: catalog, modifier aggregator and
// the pure purchase/refund rules.
//
// BYTE-IDENTICAL COPY: this file exists twice, as
//   frontend/src/utils/careerCore.ts and api/src/services/careerCore.ts,
// and must stay byte-for-byte the same (it has no imports for exactly that
// reason). The two apps are deployed separately and share no package (see
// CLAUDE.md's "Repo shape"); the client needs it to show and apply the tree,
// the server to validate purchases and to bound saves by what the tree allows.
// Each side's career-parity test compares its own expansion against the same
// byte-identical fixture (fixtures/career-catalog.json + career-vectors.json),
// so a one-sided edit fails that side's suite.
//
// Every number here is an integer: costs, and every modifier value in basis
// points (1 bp = 0.01%) or whole units. No Math.pow/log anywhere — those can
// differ in the last bit between JS engines, and costs/floors must match the
// server exactly. Fractions are derived once, in getCareerModifiers.
//
// The catalog is APPEND-ONLY: never rename or remove a node id (bought rows
// reference it). A retired node keeps its id and is simply never offered.

export type CareerBranch =
  | "research"
  | "lecturing"
  | "administration"
  | "conferences"
  | "thesis"
  | "lab";

export const CAREER_BRANCHES: readonly CareerBranch[] = [
  "research",
  "lecturing",
  "administration",
  "conferences",
  "thesis",
  "lab"
];

// What a node does — exactly one of these per node. Units of `value`:
//   *Pct / *Discount / keepUnits / phdCostCapAdd / phdGainPct: additive bp
//   productionMult / unitProductionMult / clickMult: multiplicative factor in bp (15000 = x1.5)
//   clickSynergyAdd / critChanceAdd: additive bp (100 = +1%)
//   critMultAdd: additive bp of one multiplier step (10000 = +1x crit)
//   momentumMax: additive bp of the momentum cap (2500 = up to +25% click value)
//   phdProductionBonusAdd: additive bp per held PhD (20 = +0.2% production per PhD)
//   startingTokens: whole tokens · windfallSecs: whole seconds
//   autoClickRate: hundredths of a click per second (100 = 1 click/s)
//   keepUpgradeFamily / unlockBooster / autoBuy*: value 1, meaning in `target`
export type CareerModifierKind =
  | "productionPct"
  | "productionMult"
  | "unitProductionMult"
  | "clickMult"
  | "clickSynergyAdd"
  | "critChanceAdd"
  | "critMultAdd"
  | "momentumMax"
  | "unitCostDiscount"
  | "upgradeCostDiscount"
  | "startingTokens"
  | "keepUnitsPct"
  | "keepUpgradeFamily"
  | "boosterDurationPct"
  | "boosterSpawnPct"
  | "boosterWindowPct"
  | "boosterPotencyPct"
  | "unlockBooster"
  | "windfallSecs"
  | "phdGainPct"
  | "phdProductionBonusAdd"
  | "phdCostCapAdd"
  | "autoClickRate"
  | "autoBuyUnits"
  | "autoBuyUpgrades";

export interface CareerNode {
  id: string;
  branch: CareerBranch | "root";
  // The one node that must be owned before this one can be bought (null for
  // the root). The tree is a strict tree: every node has exactly one parent.
  parent: string | null;
  kind: CareerModifierKind;
  target?: string;
  value: number;
  // PhDs to buy it.
  cost: number;
  // Distance from the root in the tree (layout) and price level (cost).
  depth: number;
  level: number;
  // Keystones have their own name; track nodes are "<track name> <tier>".
  keystone: boolean;
  track: string | null;
  tier: number;
}

// ---- Prices ---------------------------------------------------------------

// A node's price is costAtLevel(level) scaled by its track's costScale
// (percent). Keystones step the level by KEYSTONE_LEVEL_STEP, track tiers by
// 1 — so each keystone is a big, deliberate saving goal and the tiers
// hanging off it are a steady drip of cheaper buys. The curve has two
// phases: gentle for the first CAREER_EARLY_LEVELS levels, so a new player's
// first prestiges (worth a PhD or two each) keep unlocking something, then
// steep, so the deep tree is a long-term goal. Tuned by the balance
// simulation (frontend/src/utils/__tests__/career-balance.sim.spec.ts, `pnpm
// sim:balance`): the fastest strategy it found (invest ~10% of held PhDs per
// window, 3 clicks/s, every booster) maxes the tree at ~130 h; investing half
// at every window takes ~175 h. Re-run it after any price or effect change.
export const CAREER_EARLY_LEVELS = 6;
export const CAREER_EARLY_GROWTH_PERCENT = 160;
export const CAREER_COST_GROWTH_PERCENT = 265;
export const KEYSTONE_LEVEL_STEP = 3;
export const KEYSTONE_COST_SCALE = 300;
export const FIRST_KEYSTONE_COST_SCALE = 150;

/** Base price at a level: 1, then x1.6 per early level and x2.3 after, rounded up, in exact integers. */
export function costAtLevel(level: number): number {
  let cost = 1;
  for (let i = 0; i < level; i++) {
    const growth =
      i < CAREER_EARLY_LEVELS ? CAREER_EARLY_GROWTH_PERCENT : CAREER_COST_GROWTH_PERCENT;
    cost = Math.floor((cost * growth + 99) / 100);
  }
  return cost;
}

function scaledCost(level: number, scalePercent: number): number {
  return Math.max(1, Math.floor((costAtLevel(level) * scalePercent + 99) / 100));
}

// ---- Catalog definition -----------------------------------------------------

interface KeystoneDef {
  slug: string;
  kind: CareerModifierKind;
  target?: string;
  value: number;
}

interface TrackDef {
  slug: string;
  // The keystone (by slug, same branch) this track hangs off.
  at: string;
  kind: CareerModifierKind;
  target?: string;
  // One value per tier, or one value repeated for every tier.
  values: number | number[];
  tiers: number;
  costScale: number;
}

interface BranchDef {
  id: CareerBranch;
  // Bought in order: keystone i+1 hangs off keystone i (the first off the root).
  keystones: KeystoneDef[];
  tracks: TrackDef[];
}

export const CAREER_ROOT_ID = "habilitation";

const ROOT_DEF: KeystoneDef = { slug: CAREER_ROOT_ID, kind: "productionPct", value: 1000 };

const UNIT_IDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];

const BRANCH_DEFS: BranchDef[] = [
  {
    id: "research",
    keystones: [
      { slug: "labAccess", kind: "productionPct", value: 2000 },
      { slug: "researchGroup", kind: "productionMult", value: 11500 },
      { slug: "institute", kind: "productionMult", value: 12000 },
      { slug: "nationalLab", kind: "productionMult", value: 12000 },
      { slug: "nobelNomination", kind: "productionMult", value: 13000 }
    ],
    tracks: [
      {
        slug: "grantWriting",
        at: "labAccess",
        kind: "productionPct",
        values: 200,
        tiers: 10,
        costScale: 100
      },
      ...UNIT_IDS.map((unit, i) => ({
        slug: `${unit}Studies`,
        at: [
          "researchGroup",
          "researchGroup",
          "institute",
          "institute",
          "nationalLab",
          "nationalLab",
          "nobelNomination",
          "nobelNomination"
        ][i]!,
        kind: "unitProductionMult" as const,
        target: unit,
        values: 11000,
        tiers: 3,
        costScale: 120
      })),
      {
        slug: "peerReviewedPapers",
        at: "institute",
        kind: "productionPct",
        values: 300,
        tiers: 8,
        costScale: 100
      },
      {
        slug: "citationIndex",
        at: "nationalLab",
        kind: "productionMult",
        values: 10200,
        tiers: 5,
        costScale: 150
      },
      {
        slug: "fieldWork",
        at: "nobelNomination",
        kind: "productionPct",
        values: 500,
        tiers: 8,
        costScale: 100
      }
    ]
  },
  {
    id: "lecturing",
    keystones: [
      { slug: "lecturer", kind: "clickMult", value: 15000 },
      { slug: "lectureMomentum", kind: "momentumMax", value: 2500 },
      { slug: "seminarLeader", kind: "clickSynergyAdd", value: 100 },
      { slug: "examiner", kind: "critChanceAdd", value: 500 },
      { slug: "standingOvation", kind: "critMultAdd", value: 20000 }
    ],
    tracks: [
      {
        slug: "rhetoric",
        at: "lecturer",
        kind: "clickMult",
        values: 11000,
        tiers: 8,
        costScale: 100
      },
      {
        slug: "momentum",
        at: "lectureMomentum",
        kind: "momentumMax",
        values: 1000,
        tiers: 6,
        costScale: 100
      },
      {
        slug: "appliedTheory",
        at: "seminarLeader",
        kind: "clickSynergyAdd",
        values: 25,
        tiers: 6,
        costScale: 110
      },
      {
        slug: "popQuizInstinct",
        at: "examiner",
        kind: "critChanceAdd",
        values: 200,
        tiers: 5,
        costScale: 100
      },
      {
        slug: "eureka",
        at: "standingOvation",
        kind: "critMultAdd",
        values: 5000,
        tiers: 6,
        costScale: 100
      },
      {
        slug: "officeHours",
        at: "standingOvation",
        kind: "clickMult",
        values: 10500,
        tiers: 6,
        costScale: 120
      }
    ]
  },
  {
    id: "administration",
    keystones: [
      { slug: "departmentBudget", kind: "unitCostDiscount", value: 500 },
      { slug: "seedFunding", kind: "startingTokens", value: 1000 },
      { slug: "tenureTrack", kind: "keepUnitsPct", value: 500 },
      { slug: "endowment", kind: "keepUpgradeFamily", target: "flat", value: 1 },
      { slug: "bulkPurchasing", kind: "upgradeCostDiscount", value: 1000 }
    ],
    tracks: [
      {
        slug: "procurement",
        at: "departmentBudget",
        kind: "unitCostDiscount",
        values: 200,
        tiers: 10,
        costScale: 100
      },
      {
        slug: "startupFund",
        at: "seedFunding",
        kind: "startingTokens",
        values: [4000, 15000, 50000, 130000, 300000, 500000],
        tiers: 6,
        costScale: 100
      },
      {
        slug: "tenure",
        at: "tenureTrack",
        kind: "keepUnitsPct",
        values: 250,
        tiers: 6,
        costScale: 120
      },
      {
        slug: "archives",
        at: "endowment",
        kind: "keepUpgradeFamily",
        values: 1,
        tiers: 4,
        costScale: 150
      },
      {
        slug: "bursary",
        at: "bulkPurchasing",
        kind: "upgradeCostDiscount",
        values: 500,
        tiers: 6,
        costScale: 100
      },
      {
        slug: "accounting",
        at: "bulkPurchasing",
        kind: "unitCostDiscount",
        values: 100,
        tiers: 5,
        costScale: 120
      }
    ]
  },
  {
    id: "conferences",
    keystones: [
      { slug: "conferenceSeason", kind: "boosterDurationPct", value: 2500 },
      { slug: "callForPapers", kind: "boosterSpawnPct", value: 1500 },
      { slug: "posterSession", kind: "boosterWindowPct", value: 2500 },
      { slug: "keynoteSpeaker", kind: "unlockBooster", target: "windfall", value: 1 },
      { slug: "symposium", kind: "unlockBooster", target: "critStorm", value: 1 }
    ],
    tracks: [
      {
        slug: "networking",
        at: "conferenceSeason",
        kind: "boosterDurationPct",
        values: 1000,
        tiers: 8,
        costScale: 100
      },
      {
        slug: "mailingList",
        at: "callForPapers",
        kind: "boosterSpawnPct",
        values: 500,
        tiers: 8,
        costScale: 100
      },
      {
        slug: "posterBoard",
        at: "posterSession",
        kind: "boosterWindowPct",
        values: 1000,
        tiers: 5,
        costScale: 90
      },
      {
        slug: "speakerFee",
        at: "keynoteSpeaker",
        kind: "windfallSecs",
        values: 30,
        tiers: 5,
        costScale: 100
      },
      {
        slug: "frenzyPotency",
        at: "conferenceSeason",
        kind: "boosterPotencyPct",
        target: "frenzy",
        values: 1000,
        tiers: 5,
        costScale: 130
      },
      {
        slug: "popQuizPotency",
        at: "callForPapers",
        kind: "boosterPotencyPct",
        target: "clickStorm",
        values: 1000,
        tiers: 5,
        costScale: 130
      },
      {
        slug: "clearancePotency",
        at: "posterSession",
        kind: "boosterPotencyPct",
        target: "clearance",
        values: 1000,
        tiers: 5,
        costScale: 130
      }
    ]
  },
  {
    id: "thesis",
    keystones: [
      { slug: "doctoralSchool", kind: "phdGainPct", value: 500 },
      { slug: "academicPrestige", kind: "phdProductionBonusAdd", value: 5 },
      { slug: "fundingCommittee", kind: "phdCostCapAdd", value: 500 },
      { slug: "habilitationCommittee", kind: "phdGainPct", value: 800 },
      { slug: "professorEmeritus", kind: "phdProductionBonusAdd", value: 25 }
    ],
    tracks: [
      {
        slug: "citations",
        at: "doctoralSchool",
        kind: "phdGainPct",
        values: 50,
        tiers: 10,
        costScale: 120
      },
      {
        slug: "reputation",
        at: "academicPrestige",
        kind: "phdProductionBonusAdd",
        values: 3,
        tiers: 8,
        costScale: 110
      },
      {
        slug: "scholarships",
        at: "fundingCommittee",
        kind: "phdCostCapAdd",
        values: 250,
        tiers: 6,
        costScale: 100
      },
      {
        slug: "legacy",
        at: "habilitationCommittee",
        kind: "phdGainPct",
        values: 100,
        tiers: 5,
        costScale: 140
      },
      {
        slug: "dissertations",
        at: "professorEmeritus",
        kind: "phdGainPct",
        values: 50,
        tiers: 6,
        costScale: 120
      }
    ]
  },
  {
    id: "lab",
    keystones: [
      { slug: "teachingAssistant", kind: "autoClickRate", value: 50 },
      { slug: "purchasingOfficer", kind: "autoBuyUnits", value: 1 },
      { slug: "upgradeClerk", kind: "autoBuyUpgrades", value: 1 },
      { slug: "secondAssistant", kind: "autoClickRate", value: 100 }
    ],
    tracks: [
      {
        slug: "taTraining",
        at: "teachingAssistant",
        kind: "autoClickRate",
        values: 25,
        tiers: 10,
        costScale: 100
      },
      {
        slug: "taHours",
        at: "secondAssistant",
        kind: "autoClickRate",
        values: 50,
        tiers: 8,
        costScale: 110
      }
    ]
  }
];

// The archives track keeps one more upgrade family per tier, in this order
// (endowment, the keystone it hangs off, keeps "flat").
const ARCHIVE_FAMILIES = ["multiplier", "synergy", "crit", "booster"];

/** Expands the compact definitions above into the full node list, in catalog order. */
export function expandCatalog(): CareerNode[] {
  const nodes: CareerNode[] = [
    {
      id: CAREER_ROOT_ID,
      branch: "root",
      parent: null,
      kind: ROOT_DEF.kind,
      value: ROOT_DEF.value,
      cost: 1,
      depth: 0,
      level: 0,
      keystone: true,
      track: null,
      tier: 0
    }
  ];

  for (const branch of BRANCH_DEFS) {
    const keystoneNodes = new Map<string, CareerNode>();
    let parent = nodes[0]!;
    branch.keystones.forEach((k, i) => {
      const level = i === 0 ? 1 : parent.level + KEYSTONE_LEVEL_STEP;
      const node: CareerNode = {
        id: `${branch.id}.${k.slug}`,
        branch: branch.id,
        parent: parent.id,
        kind: k.kind,
        ...(k.target !== undefined ? { target: k.target } : {}),
        value: k.value,
        // The first ring's keystones are the cheap way into each branch.
        cost: scaledCost(level, i === 0 ? FIRST_KEYSTONE_COST_SCALE : KEYSTONE_COST_SCALE),
        depth: parent.depth + 1,
        level,
        keystone: true,
        track: null,
        tier: 0
      };
      nodes.push(node);
      keystoneNodes.set(k.slug, node);
      parent = node;
    });

    for (const track of branch.tracks) {
      let prev = keystoneNodes.get(track.at)!;
      for (let tier = 1; tier <= track.tiers; tier++) {
        const value = Array.isArray(track.values) ? track.values[tier - 1]! : track.values;
        const target = track.slug === "archives" ? ARCHIVE_FAMILIES[tier - 1] : track.target;
        const level = prev.level + 1;
        const node: CareerNode = {
          id: `${branch.id}.${track.slug}.${tier}`,
          branch: branch.id,
          parent: prev.id,
          kind: track.kind,
          ...(target !== undefined ? { target } : {}),
          value,
          cost: scaledCost(level, track.costScale),
          depth: prev.depth + 1,
          level,
          keystone: false,
          track: track.slug,
          tier
        };
        nodes.push(node);
        prev = node;
      }
    }
  }
  return nodes;
}

export const CAREER_NODES: readonly CareerNode[] = expandCatalog();

// A Map, never a plain object: a lookup by an arbitrary request string
// ("__proto__", "toString") must miss, not hit Object.prototype.
export const CAREER_NODES_BY_ID: ReadonlyMap<string, CareerNode> = new Map(
  CAREER_NODES.map((n) => [n.id, n])
);

export function isKnownCareerNodeId(value: unknown): value is string {
  return typeof value === "string" && CAREER_NODES_BY_ID.has(value);
}

// ---- Modifier aggregation ---------------------------------------------------

// Caps that hold however much of the tree is owned (asserted by both sides'
// catalog tests with every node owned). They exist so no combination can
// reach a degenerate value — e.g. a cost multiplier near 0 would make "Max"
// buy near-unlimited units.
export const CAREER_CAPS = {
  // Combined unit cost multiplier (PhD discount x tree discount x clearance)
  // never goes below this — see combinedCostFloor's users.
  costMultiplierFloor: 0.1,
  unitCostDiscount: 0.3,
  upgradeCostDiscount: 0.5,
  // Total (upgrades + tree) income synergy per click.
  totalClickSynergy: 0.06,
  critChance: 1,
  keepUnitsBp: 2500,
  // Must stay <= PHD_TOKEN_SCALE (1,000,000): every honest prestige needed at
  // least that many lifetime tokens, so a start fund this size can never make
  // `tokens > totalTokensEarned` (the stateless PUT /save check) true.
  startingTokens: 1_000_000,
  // Booster spawn-rate divisor (1 + every spawn bonus, incl. the
  // departmentNewsletter upgrade) and the shortest possible cooldown.
  boosterSpawnDivisor: 2.5,
  boosterCooldownFloorSecs: 20,
  clearanceDiscount: 0.6,
  phdCostCapAdd: 0.25,
  autoClickRate: 20
} as const;

// The run-scoped upgrade families keepUpgradeFamily can name. "booster"
// covers both booster perks (boosterDuration + boosterSpawn).
export type KeptUpgradeFamily = "flat" | "multiplier" | "synergy" | "crit" | "booster";

export interface CareerModifiers {
  productionPct: number;
  productionMult: number;
  unitProductionMult: Record<string, number>;
  clickMult: number;
  clickSynergyAdd: number;
  critChanceAdd: number;
  critMultAdd: number;
  momentumMax: number;
  unitCostDiscount: number;
  upgradeCostDiscount: number;
  startingTokens: number;
  // Kept in basis points: it feeds a floor() at prestige.
  keepUnitsBp: number;
  keepUpgradeFamilies: KeptUpgradeFamily[];
  boosterDurationPct: number;
  boosterSpawnPct: number;
  boosterWindowPct: number;
  boosterPotency: Record<string, number>;
  unlockedBoosters: string[];
  windfallSecs: number;
  // Kept in basis points: it feeds a floor() at prestige.
  phdGainBp: number;
  phdProductionBonusAdd: number;
  phdCostCapAdd: number;
  autoClickRate: number;
  autoBuyUnits: boolean;
  autoBuyUpgrades: boolean;
}

export const CAREER_WINDFALL_BASE_SECS = 60;

export function emptyCareerModifiers(): CareerModifiers {
  return {
    productionPct: 0,
    productionMult: 1,
    unitProductionMult: {},
    clickMult: 1,
    clickSynergyAdd: 0,
    critChanceAdd: 0,
    critMultAdd: 0,
    momentumMax: 0,
    unitCostDiscount: 0,
    upgradeCostDiscount: 0,
    startingTokens: 0,
    keepUnitsBp: 0,
    keepUpgradeFamilies: [],
    boosterDurationPct: 0,
    boosterSpawnPct: 0,
    boosterWindowPct: 0,
    boosterPotency: {},
    unlockedBoosters: [],
    windfallSecs: 0,
    phdGainBp: 0,
    phdProductionBonusAdd: 0,
    phdCostCapAdd: 0,
    autoClickRate: 0,
    autoBuyUnits: false,
    autoBuyUpgrades: false
  };
}

/**
 * Folds owned node ids into one modifier set. Iterates the CATALOG (in its
 * fixed order), filtered by the owned set — never the input order: a DB's row
 * order is arbitrary, and float products are not associative, so the same
 * owned set must always multiply in the same order on both sides. Additive
 * kinds are summed in integer bp and converted to a fraction once, at the end.
 * Unknown ids are ignored.
 */
export function getCareerModifiers(ownedNodeIds: readonly string[]): CareerModifiers {
  const owned = new Set(ownedNodeIds);
  const m = emptyCareerModifiers();
  const bp: Record<string, number> = {};
  const unitMult: Record<string, number> = {};
  const potencyBp: Record<string, number> = {};
  let startingTokens = 0;
  let windfallSecs = 0;
  let autoClickHundredths = 0;
  let windfallUnlocked = false;

  for (const node of CAREER_NODES) {
    if (!owned.has(node.id)) continue;
    switch (node.kind) {
      case "productionMult":
        m.productionMult *= node.value / 10000;
        break;
      case "clickMult":
        m.clickMult *= node.value / 10000;
        break;
      case "unitProductionMult":
        unitMult[node.target!] = (unitMult[node.target!] ?? 1) * (node.value / 10000);
        break;
      case "boosterPotencyPct":
        potencyBp[node.target!] = (potencyBp[node.target!] ?? 0) + node.value;
        break;
      case "keepUpgradeFamily":
        if (!m.keepUpgradeFamilies.includes(node.target as KeptUpgradeFamily)) {
          m.keepUpgradeFamilies.push(node.target as KeptUpgradeFamily);
        }
        break;
      case "unlockBooster":
        if (!m.unlockedBoosters.includes(node.target!)) m.unlockedBoosters.push(node.target!);
        if (node.target === "windfall") windfallUnlocked = true;
        break;
      case "startingTokens":
        startingTokens += node.value;
        break;
      case "windfallSecs":
        windfallSecs += node.value;
        break;
      case "autoClickRate":
        autoClickHundredths += node.value;
        break;
      case "autoBuyUnits":
        m.autoBuyUnits = true;
        break;
      case "autoBuyUpgrades":
        m.autoBuyUpgrades = true;
        break;
      default:
        bp[node.kind] = (bp[node.kind] ?? 0) + node.value;
    }
  }

  const frac = (kind: CareerModifierKind) => (bp[kind] ?? 0) / 10000;
  m.productionPct = frac("productionPct");
  m.unitProductionMult = unitMult;
  m.clickSynergyAdd = frac("clickSynergyAdd");
  m.critChanceAdd = Math.min(CAREER_CAPS.critChance, frac("critChanceAdd"));
  m.critMultAdd = frac("critMultAdd");
  m.momentumMax = frac("momentumMax");
  m.unitCostDiscount = Math.min(CAREER_CAPS.unitCostDiscount, frac("unitCostDiscount"));
  m.upgradeCostDiscount = Math.min(CAREER_CAPS.upgradeCostDiscount, frac("upgradeCostDiscount"));
  m.startingTokens = Math.min(CAREER_CAPS.startingTokens, startingTokens);
  m.keepUnitsBp = Math.min(CAREER_CAPS.keepUnitsBp, bp["keepUnitsPct"] ?? 0);
  m.boosterDurationPct = frac("boosterDurationPct");
  m.boosterSpawnPct = frac("boosterSpawnPct");
  m.boosterWindowPct = frac("boosterWindowPct");
  m.boosterPotency = Object.fromEntries(
    Object.entries(potencyBp).map(([id, v]) => [id, v / 10000])
  );
  m.windfallSecs = windfallUnlocked ? CAREER_WINDFALL_BASE_SECS + windfallSecs : 0;
  m.phdGainBp = bp["phdGainPct"] ?? 0;
  m.phdProductionBonusAdd = frac("phdProductionBonusAdd");
  m.phdCostCapAdd = Math.min(CAREER_CAPS.phdCostCapAdd, frac("phdCostCapAdd"));
  m.autoClickRate = Math.min(CAREER_CAPS.autoClickRate, autoClickHundredths / 100);
  return m;
}

// ---- Purchase rules -------------------------------------------------------

export type CareerBuyRefusal =
  | "unknown"
  | "already_owned"
  | "prerequisite_missing"
  | "insufficient_phd";

/** Why `nodeId` can't be bought right now, or null if it can. */
export function careerBuyRefusal(
  nodeId: string,
  ownedNodeIds: readonly string[],
  phdCount: number
): CareerBuyRefusal | null {
  const node = CAREER_NODES_BY_ID.get(nodeId);
  if (!node) return "unknown";
  if (ownedNodeIds.includes(nodeId)) return "already_owned";
  if (node.parent !== null && !ownedNodeIds.includes(node.parent)) return "prerequisite_missing";
  if (phdCount < node.cost) return "insufficient_phd";
  return null;
}

/**
 * The nodes a refund of `nodeId` removes: the node itself plus every owned
 * descendant (they would lose their prerequisite). Returned in catalog order.
 * `null` when the closure would include a node outside `refundableIds` — that
 * can't happen to an honest tree (a prerequisite is always owned before its
 * child, so a refundable node's descendants were bought after it, in the same
 * window), and refusing is safer than leaving a permanent node orphaned.
 */
export function refundClosure(
  nodeId: string,
  ownedNodeIds: readonly string[],
  refundableIds: readonly string[]
): string[] | null {
  const owned = new Set(ownedNodeIds);
  if (!owned.has(nodeId)) return null;
  const removed = new Set([nodeId]);
  // Catalog order puts every parent before its children within a branch, and
  // the root before everything, so one pass collects the whole subtree.
  for (const node of CAREER_NODES) {
    if (owned.has(node.id) && node.parent !== null && removed.has(node.parent))
      removed.add(node.id);
  }
  const refundable = new Set(refundableIds);
  for (const id of removed) if (!refundable.has(id)) return null;
  return CAREER_NODES.filter((n) => removed.has(n.id)).map((n) => n.id);
}

/**
 * PhDs awarded for a prestige once the tree's PhD-gain bonus applies: the
 * base gain (which still needs a run worth at least 1 PhD on its own — that
 * keeps the server's prestige-count bound valid) scaled by (1 + bp/10000),
 * floored, in exact integer arithmetic.
 */
export function applyPhdGainBonus(baseGain: number, phdGainBp: number): number {
  if (baseGain < 1) return 0;
  const numerator = baseGain * (10000 + Math.max(0, phdGainBp));
  return (numerator - (numerator % 10000)) / 10000;
}

/** Units kept through a prestige: floor(owned x keep bp / 10000), exact. */
export function keptUnitCount(owned: number, keepUnitsBp: number): number {
  const numerator = owned * Math.max(0, keepUnitsBp);
  return (numerator - (numerator % 10000)) / 10000;
}

/** Sum of the catalog prices of `nodeIds` (unknown ids count 0). */
export function careerCatalogCost(nodeIds: readonly string[]): number {
  return nodeIds.reduce((sum, id) => sum + (CAREER_NODES_BY_ID.get(id)?.cost ?? 0), 0);
}
