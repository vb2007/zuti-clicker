// Regenerates the Academic Career parity fixtures from the API's own
// implementation and writes the SAME bytes to both apps:
//   api/src/tests/fixtures/career-{catalog,vectors}.json
//   frontend/src/utils/__tests__/fixtures/career-{catalog,vectors}.json
// Run after an intentional catalog/formula change (`pnpm generate:career-fixtures`),
// then run both career-parity suites: the frontend's proves its own copy of
// careerCore.ts + utils/careerEconomy.ts reproduces every value. The parity
// tests also pin a few hand-computed values that this script cannot launder.
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CAREER_NODES,
  getCareerModifiers,
  refundClosure,
  applyPhdGainBonus,
  keptUnitCount,
  costAtLevel
} from "../src/services/careerCore";
import {
  getCareerPhdProductionMultiplier,
  getCareerPhdCostMultiplier,
  getCareerProductionMultiplier,
  getCareerBaseTps,
  getCareerUnitCostMultiplier,
  getCareerUpgradeCost,
  getCareerClickSynergy,
  getBoosterEffectMultiplier,
  getMaxBoosterMultiplier,
  getWindfallGrant
} from "../src/services/economy";

const here = path.dirname(fileURLToPath(import.meta.url));
const targets = [
  path.join(here, "../src/tests/fixtures"),
  path.join(here, "../../frontend/src/utils/__tests__/fixtures")
];

const ALL = CAREER_NODES.map((n) => n.id);
const EARLY = ["habilitation", "research.labAccess", "research.grantWriting.1"];
const MIXED = [
  "habilitation",
  "thesis.doctoralSchool",
  "thesis.citations.1",
  "thesis.citations.2",
  "administration.departmentBudget",
  "administration.procurement.1",
  "conferences.conferenceSeason",
  "conferences.frenzyPotency.1",
  "lab.teachingAssistant",
  "lecturing.lecturer",
  "lecturing.rhetoric.1",
  "research.labAccess",
  "research.researchGroup",
  "research.alphaStudies.1",
  "research.alphaStudies.2"
];
// The same set in a different order, plus an id that isn't in the catalog —
// the aggregator must not care about either.
const MIXED_SHUFFLED = [...MIXED].reverse().concat(["not.a.node"]);
const NODE_SETS: Record<string, string[]> = {
  none: [],
  early: EARLY,
  mixed: MIXED,
  mixedShuffled: MIXED_SHUFFLED,
  all: ALL
};

const UNITS = [
  { unitId: "alpha", owned: 25 },
  { unitId: "beta", owned: 12 },
  { unitId: "theta", owned: 3 }
];

type Vector = { fn: string; args: unknown[]; expected: unknown };
const vectors: Vector[] = [];
const mods = (set: string) => getCareerModifiers(NODE_SETS[set]!);

for (const set of Object.keys(NODE_SETS)) {
  vectors.push({ fn: "getCareerModifiers", args: [{ set }], expected: mods(set) });
}
for (const level of [0, 1, 2, 3, 10, 21]) {
  vectors.push({ fn: "costAtLevel", args: [level], expected: costAtLevel(level) });
}
for (const [base, bp] of [
  [0, 5000],
  [1, 0],
  [1, 9700],
  [20, 1500],
  [7, 3300],
  [123456, 9700]
] as const) {
  vectors.push({
    fn: "applyPhdGainBonus",
    args: [base, bp],
    expected: applyPhdGainBonus(base, bp)
  });
}
for (const [owned, bp] of [
  [0, 2500],
  [7, 2500],
  [40, 500],
  [399, 2000]
] as const) {
  vectors.push({ fn: "keptUnitCount", args: [owned, bp], expected: keptUnitCount(owned, bp) });
}
const OWNED_FOR_REFUND = [
  "habilitation",
  "research.labAccess",
  "research.grantWriting.1",
  "research.grantWriting.2",
  "research.researchGroup",
  "lecturing.lecturer"
];
for (const [target, refundable] of [
  ["research.grantWriting.1", ["research.grantWriting.1", "research.grantWriting.2"]],
  ["research.labAccess", OWNED_FOR_REFUND.slice(1)],
  // A permanent descendant blocks the refund (null).
  ["research.labAccess", ["research.labAccess", "research.grantWriting.1"]],
  ["lecturing.rhetoric.1", OWNED_FOR_REFUND]
] as const) {
  vectors.push({
    fn: "refundClosure",
    args: [target, OWNED_FOR_REFUND, refundable],
    expected: refundClosure(target, OWNED_FOR_REFUND, refundable)
  });
}

for (const set of ["none", "mixed", "all"]) {
  for (const phd of [0, 37, 250]) {
    vectors.push({
      fn: "getCareerPhdProductionMultiplier",
      args: [phd, { set }],
      expected: getCareerPhdProductionMultiplier(phd, mods(set))
    });
    vectors.push({
      fn: "getCareerPhdCostMultiplier",
      args: [phd, { set }],
      expected: getCareerPhdCostMultiplier(phd, mods(set))
    });
    for (const booster of [1, 0.75]) {
      vectors.push({
        fn: "getCareerUnitCostMultiplier",
        args: [phd, { set }, booster],
        expected: getCareerUnitCostMultiplier(phd, mods(set), booster)
      });
    }
    vectors.push({
      fn: "getWindfallGrant",
      args: [UNITS, phd, { set }],
      expected: getWindfallGrant(UNITS, phd, mods(set))
    });
  }
  vectors.push({
    fn: "getCareerProductionMultiplier",
    args: [{ set }],
    expected: getCareerProductionMultiplier(mods(set))
  });
  vectors.push({
    fn: "getCareerBaseTps",
    args: [UNITS, { set }],
    expected: getCareerBaseTps(UNITS, mods(set))
  });
  vectors.push({
    fn: "getCareerUpgradeCost",
    args: [7500, { set }],
    expected: getCareerUpgradeCost(7500, mods(set))
  });
  for (const synergy of [0, 0.03]) {
    vectors.push({
      fn: "getCareerClickSynergy",
      args: [synergy, { set }],
      expected: getCareerClickSynergy(synergy, mods(set))
    });
  }
  for (const id of ["frenzy", "clickStorm", "clearance", "windfall", "critStorm", "nope"]) {
    vectors.push({
      fn: "getBoosterEffectMultiplier",
      args: [id, { set }],
      expected: getBoosterEffectMultiplier(id, mods(set))
    });
  }
  for (const kind of ["production", "click", "costReduction"] as const) {
    vectors.push({
      fn: "getMaxBoosterMultiplier",
      args: [kind, { set }],
      expected: getMaxBoosterMultiplier(kind, mods(set))
    });
  }
}

const NOTE =
  "Generated by api/scripts/generate-career-fixtures.ts and shared byte-for-byte between api/src/tests/fixtures/ and frontend/src/utils/__tests__/fixtures/. Never edit by hand — regenerate both copies together after an intentional Academic Career catalog/formula change.";

const catalog = JSON.stringify({ _note: NOTE, nodes: CAREER_NODES }, null, 2) + "\n";
const vectorFile = JSON.stringify({ _note: NOTE, nodeSets: NODE_SETS, vectors }, null, 2) + "\n";

for (const dir of targets) {
  writeFileSync(path.join(dir, "career-catalog.json"), catalog);
  writeFileSync(path.join(dir, "career-vectors.json"), vectorFile);
  console.log(`wrote ${path.relative(process.cwd(), dir)}/career-{catalog,vectors}.json`);
}
console.log(`${CAREER_NODES.length} nodes, ${vectors.length} vectors`);
