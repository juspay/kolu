/**
 * The deadlocked-pull incident, end to end through the REAL `runCapture`: a
 * child whose stderr is Nix's internal-json progress result, re-sent several
 * times a second. When its `done` counter never moves (a transfer stalled in a
 * two-way socket deadlock — the field incident), the silence bound must still
 * fire; when it advances, the bound must never fire however long it runs.
 */
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runNix } from "./nixLog";

/** An executable standing in for `nix`: ignores its argv (`runNix` adds the
 *  log-format flag), writes one progress result every 20 ms for `ms`, then
 *  exits 0. `advance` decides whether `done` moves. */
function fakeNix(advance: boolean, ms: number): string {
  const dir = mkdtempSync(join(tmpdir(), "kolu-nix-liveness-"));
  const path = join(dir, "nix");
  writeFileSync(
    path,
    `#!${process.execPath}
let done = 4096;
const start = Date.now();
const tick = setInterval(() => {
  if (Date.now() - start > ${ms}) { clearInterval(tick); return; }
  if (${advance}) done += 512;
  process.stderr.write('@nix {"action":"result","fields":[' + done + ',1048576,1,0],"id":7,"type":105}\\n');
}, 20);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

const SILENCE_MS = 400;

describe("progress-liveness reads Nix's progress, not its heartbeat", () => {
  it("an unmoved progress counter re-sent forever is silence — the bound fires", {
    timeout: 10_000,
  }, async () => {
    let activity = 0;
    const start = Date.now();
    const res = await runNix("localhost", [fakeNix(false, 5000)], {
      policy: { kind: "progress-liveness", silenceMs: SILENCE_MS },
      onActivity: () => activity++,
      signal: undefined,
    });
    expect(res.kind).toBe("lifetime-expired");
    expect(Date.now() - start).toBeLessThan(2500);
    // Only the first report was news; the session's own backstop saw the same.
    expect(activity).toBe(1);
  });

  it("an advancing counter is activity — a run far longer than the bound survives", {
    timeout: 10_000,
  }, async () => {
    const res = await runNix("localhost", [fakeNix(true, 3 * SILENCE_MS)], {
      policy: { kind: "progress-liveness", silenceMs: SILENCE_MS },
      onActivity: () => {},
      signal: undefined,
    });
    expect(res.kind).toBe("exit");
    expect(res.ok).toBe(true);
  });
});
