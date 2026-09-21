import { readFileSync } from "fs";
import path from "path";

// Read once at module load, from package.json's "version" field, rather than
// hand-duplicating the number into a source file the way the frontend/API
// balance constants have to be (see CLAUDE.md's "keep in sync" convention) —
// this one value CAN be read directly from its single source of truth.
// process.cwd() (not import.meta.url) because this module is loaded both via
// tsx running src/index.ts directly (repo root as cwd) and, after `tsc`,
// from dist/ — a relative-to-this-file path would break under the latter.
function readApiVersion(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const API_VERSION: string = readApiVersion();
