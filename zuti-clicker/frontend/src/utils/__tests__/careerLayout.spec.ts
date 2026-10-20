import { describe, it, expect } from "vitest";
import { CAREER_NODES, CAREER_ROOT_ID, CAREER_BRANCHES } from "@/utils/careerCore";
import { layoutCareerTree } from "@/utils/careerLayout";

describe("layoutCareerTree", () => {
  const layout = layoutCareerTree(CAREER_NODES);

  it("places every node, and no two on the same spot", () => {
    expect(layout.nodes.size).toBe(CAREER_NODES.length);
    const spots = [...layout.nodes.values()].map((n) => `${n.col},${n.row}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it("points upward: the root is at the bottom centre and every child sits above its parent", () => {
    expect(layout.nodes.get(CAREER_ROOT_ID)).toEqual({ id: CAREER_ROOT_ID, col: 0, row: 0 });
    for (const n of CAREER_NODES) {
      if (n.parent === null) continue;
      expect(layout.nodes.get(n.id)!.row).toBeGreaterThan(layout.nodes.get(n.parent)!.row);
    }
  });

  it("has one edge per non-root node, parent to child", () => {
    expect(layout.edges).toHaveLength(CAREER_NODES.length - 1);
    for (const e of layout.edges) {
      expect(CAREER_NODES.find((n) => n.id === e.to)!.parent).toBe(e.from);
    }
  });

  it("keeps each branch in its own band of columns, left to right", () => {
    let previousMax = -Infinity;
    for (const branch of CAREER_BRANCHES) {
      const cols = CAREER_NODES.filter((n) => n.branch === branch).map(
        (n) => layout.nodes.get(n.id)!.col
      );
      expect(Math.min(...cols)).toBeGreaterThan(previousMax);
      previousMax = Math.max(...cols);
    }
  });

  it("never stacks two nodes of one column on overlapping rows (chains don't cross)", () => {
    // Every vertical edge (same column) must have no other node strictly between its ends.
    for (const e of layout.edges) {
      const a = layout.nodes.get(e.from)!;
      const b = layout.nodes.get(e.to)!;
      if (a.col !== b.col) continue;
      const between = [...layout.nodes.values()].filter(
        (n) => n.col === a.col && n.row > a.row && n.row < b.row
      );
      expect(between).toEqual([]);
    }
  });

  it("is deterministic", () => {
    const again = layoutCareerTree(CAREER_NODES);
    expect([...again.nodes.values()]).toEqual([...layout.nodes.values()]);
  });
});
