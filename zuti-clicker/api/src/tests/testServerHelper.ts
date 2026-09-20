import { spawn, type ChildProcess } from "child_process";

// Shared by every *.test.ts file that needs an isolated server instance
// running under a specific ANTICHEAT_MODE — the single ambient server every
// other test file shares always runs in "monitor" (see CLAUDE.md/
// docs/developer/final.md's "Anti-cheat modell" section), so proving
// "enforce" actually blocks/restricts over HTTP needs a server genuinely
// started with that mode. Each caller must use its own port so Jest running
// test files concurrently doesn't collide.
export async function startTestServer(port: number, mode: string): Promise<ChildProcess> {
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(port), ANTICHEAT_MODE: mode },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));

  const baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/docs`);
      if (res.status < 500) return child;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) {
      throw new Error(`Server (mode=${mode}, port=${port}) exited early (code ${child.exitCode}):\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`Server (mode=${mode}, port=${port}) did not become ready in time:\n${output}`);
}

export async function stopTestServer(child: ChildProcess): Promise<void> {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
}
