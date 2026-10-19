import { CAREER_BRANCHES, type CareerBranch, type CareerNode } from "@/utils/careerCore";

/**
 * Deterministic layout of the Academic Career tree, pointing upward: the root
 * at the bottom centre, each branch's keystones forming a vertical trunk above
 * it, and every track (a chain of tiers hanging off a keystone) climbing in a
 * column beside its trunk. Pure and DOM-free — the canvas component only
 * scales these grid coordinates — so it's unit-testable and identical on every
 * device.
 *
 * Coordinates are grid units: `col` grows to the right, `row` grows UPWARD
 * (row 0 is the root, row = node depth). Tracks are packed into the nearest
 * free column to their trunk, alternating sides, where "free" means no other
 * track in that column overlaps the rows this one needs — so chains never
 * cross or stack on each other however the catalog grows.
 */

export interface CareerLayoutNode {
  id: string;
  col: number;
  row: number;
}

export interface CareerLayoutEdge {
  from: string;
  to: string;
}

export interface CareerLayout {
  nodes: Map<string, CareerLayoutNode>;
  edges: CareerLayoutEdge[];
  minCol: number;
  maxCol: number;
  maxRow: number;
  // The trunk column of each branch (for labels).
  branchCols: Map<CareerBranch, number>;
}

// Empty columns kept between two neighbouring branches.
const BRANCH_GAP = 1;

interface BranchLayout {
  // Columns relative to the branch's own trunk (0).
  nodes: { id: string; col: number; row: number }[];
  minCol: number;
  maxCol: number;
}

function layoutBranch(branch: CareerBranch, nodes: readonly CareerNode[]): BranchLayout {
  const own = nodes.filter((n) => n.branch === branch);
  const placed: { id: string; col: number; row: number }[] = [];
  // Occupied row ranges per column: col -> [from, to][]
  const occupied = new Map<number, [number, number][]>();
  const isFree = (col: number, from: number, to: number) =>
    (occupied.get(col) ?? []).every(([a, b]) => to < a || from > b);
  const occupy = (col: number, from: number, to: number) => {
    occupied.set(col, [...(occupied.get(col) ?? []), [from, to]]);
  };

  const keystones = own.filter((n) => n.keystone);
  for (const k of keystones) placed.push({ id: k.id, col: 0, row: k.depth });
  if (keystones.length > 0) {
    occupy(0, keystones[0]!.depth, keystones[keystones.length - 1]!.depth);
  }

  // Tracks in catalog order; each is a chain of `tier`s with a common track id.
  const tracks = new Map<string, CareerNode[]>();
  for (const n of own) {
    if (n.keystone || n.track === null) continue;
    tracks.set(n.track, [...(tracks.get(n.track) ?? []), n]);
  }
  for (const chain of tracks.values()) {
    const from = chain[0]!.depth;
    const to = chain[chain.length - 1]!.depth;
    // Nearest column first, alternating right/left: 1, -1, 2, -2, ...
    let col = 0;
    for (let k = 1; ; k++) {
      const candidate = k % 2 === 1 ? (k + 1) / 2 : -k / 2;
      if (isFree(candidate, from, to)) {
        col = candidate;
        break;
      }
    }
    occupy(col, from, to);
    for (const n of chain) placed.push({ id: n.id, col, row: n.depth });
  }

  const cols = placed.map((p) => p.col);
  return { nodes: placed, minCol: Math.min(0, ...cols), maxCol: Math.max(0, ...cols) };
}

export function layoutCareerTree(nodes: readonly CareerNode[]): CareerLayout {
  const result = new Map<string, CareerLayoutNode>();
  const branchCols = new Map<CareerBranch, number>();

  // Lay the branches out side by side, left to right in CAREER_BRANCHES order.
  let cursor = 0;
  for (const branch of CAREER_BRANCHES) {
    const b = layoutBranch(branch, nodes);
    const trunkCol = cursor - b.minCol;
    for (const n of b.nodes) result.set(n.id, { id: n.id, col: trunkCol + n.col, row: n.row });
    branchCols.set(branch, trunkCol);
    cursor = trunkCol + b.maxCol + 1 + BRANCH_GAP;
  }

  // Centre everything on the root: shift so the midpoint between the first
  // and last trunk sits at column 0, where the root goes.
  const trunks = [...branchCols.values()];
  const centre = (Math.min(...trunks) + Math.max(...trunks)) / 2;
  for (const n of result.values()) n.col -= centre;
  for (const [b, c] of branchCols) branchCols.set(b, c - centre);
  const root = nodes.find((n) => n.parent === null);
  if (root) result.set(root.id, { id: root.id, col: 0, row: 0 });

  const edges = nodes.filter((n) => n.parent !== null).map((n) => ({ from: n.parent!, to: n.id }));
  const cols = [...result.values()].map((n) => n.col);
  return {
    nodes: result,
    edges,
    minCol: Math.min(...cols),
    maxCol: Math.max(...cols),
    maxRow: Math.max(...[...result.values()].map((n) => n.row)),
    branchCols
  };
}
