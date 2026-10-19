import { describe, it, expect } from "vitest";
import { createI18n } from "vue-i18n";
import en from "@/i18n/en";
import hu from "@/i18n/hu";
import { CAREER_NODES, CAREER_NODES_BY_ID } from "@/utils/careerCore";
import {
  careerNodeName,
  careerNodeFlavor,
  careerEffectText,
  formatBp,
  formatFactorBp,
  romanTier,
  appliesFromNextPrestige
} from "@/utils/careerText";

// No fallback locale: a key missing from one language must show up as the raw
// key path here, not be silently papered over by English.
function translator(locale: "en" | "hu") {
  const i18n = createI18n({ legacy: false, locale, messages: { en, hu }, missingWarn: false });
  return (key: string, params?: Record<string, unknown>) =>
    i18n.global.t(key, params ?? {}) as string;
}

function keysOf(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe("career copy", () => {
  it("en.ts and hu.ts are structurally mirrored", () => {
    expect(keysOf(hu).sort()).toEqual(keysOf(en).sort());
  });

  it.each(["en", "hu"] as const)("every node has a real name and effect in %s", (locale) => {
    const t = translator(locale);
    for (const node of CAREER_NODES) {
      const name = careerNodeName(t, node);
      const effect = careerEffectText(t, node);
      expect(name, node.id).not.toMatch(/career\.|units\.names|\{/);
      expect(effect, node.id).not.toMatch(/career\.|boosters\.names|units\.names|\{/);
      expect(effect.length, node.id).toBeGreaterThan(3);
      if (node.keystone) expect(careerNodeFlavor(t, node), node.id).not.toMatch(/career\./);
    }
  });

  it("names track tiers with roman numerals", () => {
    const t = translator("en");
    expect(careerNodeName(t, CAREER_NODES_BY_ID.get("research.grantWriting.4")!)).toBe(
      "Grant Writing IV"
    );
    expect(careerNodeName(t, CAREER_NODES_BY_ID.get("research.alphaStudies.2")!)).toBe(
      "Alpha Studies II"
    );
    expect(romanTier(10)).toBe("X");
  });

  it("regression: fractional percents keep their decimals instead of rounding", () => {
    // A 0.03%-per-PhD node must never read as "0%" or "0.1%".
    expect(formatBp(3)).toBe("0.03");
    expect(formatBp(25)).toBe("0.25");
    expect(formatBp(50)).toBe("0.5");
    expect(formatBp(2500)).toBe("25");
    expect(formatFactorBp(12500)).toBe("1.25");
    expect(formatFactorBp(10200)).toBe("1.02");
    const t = translator("en");
    expect(careerEffectText(t, CAREER_NODES_BY_ID.get("thesis.reputation.1")!)).toBe(
      "+0.03% production per PhD held"
    );
  });

  it("marks exactly the run-start nodes as applying from the next prestige", () => {
    expect(appliesFromNextPrestige(CAREER_NODES_BY_ID.get("administration.seedFunding")!)).toBe(true);
    expect(appliesFromNextPrestige(CAREER_NODES_BY_ID.get("administration.tenureTrack")!)).toBe(true);
    expect(appliesFromNextPrestige(CAREER_NODES_BY_ID.get("research.labAccess")!)).toBe(false);
  });
});
