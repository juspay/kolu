/**
 * The shared fixture for every suite whose subject renders ssh options.
 *
 * Six suites reach one of the argv/env renderers, and each of them appends the
 * `ControlMaster` opts — which mkdir a kolu-private control dir out of
 * `$XDG_RUNTIME_DIR`. Pointing that at a throwaway dir per test is a
 * prerequisite, not a detail of any one suite, and getting it slightly wrong is
 * SILENT: the renderers degrade to `ControlPath=none` and the suite goes on
 * passing while it exercises the refusal arm instead of the one it names. That
 * happened — three of six copies rooted their fixture at `os.tmpdir()`.
 *
 * So the rationale lives here, once: root the runtime dir at `/tmp` and NOT at
 * `os.tmpdir()`. The expanded `ControlPath` has to fit a unix socket address
 * (`usableControlPath`), and `os.tmpdir()` is a long `/tmp/nix-shell.XXXXXX`
 * inside the devshell and a ~49-byte `/var/folders/…` on macOS — either pushes
 * the expanded path past `sun_path` on its own. A real `$XDG_RUNTIME_DIR` is
 * short (`/run/user/1000`); the fixture must be too, or it tests the length
 * guard instead of what it means to.
 *
 * Test-only, and package-internal (no `exports` entry): nothing outside this
 * package's own suites has a reason to stub our control dir.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { __resetControlMemo } from "./controlMaster";
import {
  DEFAULT_SSH_KEEPALIVE,
  policyTag,
  renderableKeepalive,
  type SshKeepalive,
  sshKeepalive,
} from "./keepalive";
import { makeProvisionBudgets, type ProvisionBudgets } from "./nixCopy";

/** Every directory this file handed out, cleaned by the fixture's `afterEach`.
 *  Module state, which is per-FILE under vitest's isolation — so two suites
 *  never share a list. */
const dirs: string[] = [];

/** The dir the fixture made for the test now running. */
let root: string | undefined;

/** Install the `$XDG_RUNTIME_DIR` stub + control-memo reset pair for this file.
 *  Call it once at the top of a suite that renders ssh options; it owns the
 *  whole lifecycle, including removing every dir {@link namedControlDir} named.
 *
 *  `prefix` only makes a failing test's temp path say which suite left it. */
export function useControlDir(prefix = "kolu-ssh-test-"): void {
  beforeEach(() => {
    const xdg = mkdtempSync(join("/tmp", prefix));
    dirs.push(xdg);
    root = xdg;
    vi.stubEnv("XDG_RUNTIME_DIR", xdg);
    __resetControlMemo();
  });
  afterEach(() => {
    __resetControlMemo();
    vi.unstubAllEnvs();
    root = undefined;
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
}

/** The runtime dir {@link useControlDir} stubbed for the running test — for the
 *  few assertions that have to NAME it (does the rendered path sit under it?)
 *  or reshape it (pre-create the control dir with loose permissions). */
export function controlRoot(): string {
  if (root === undefined) {
    throw new Error("controlDir.testutil: useControlDir() was not installed");
  }
  return root;
}

/** A runtime dir of a given literal name under `/tmp`, for the cases that need
 *  to CHOOSE the string — the length and non-literal-path refusals. Not created
 *  here: `ensureControlDir` creates it `0700`, which is what the guard has to
 *  run against. Registered for the fixture's cleanup, so {@link useControlDir}
 *  must be installed. */
export function namedControlDir(name: string): string {
  const dir = join("/tmp", name);
  dirs.push(dir);
  return dir;
}

/** A CI-shaped policy: probe every 30s, tolerate 10 misses ≈ five minutes of
 *  silence, so a network blip does not kill a lane mid-build. The shape
 *  juspay/odu passes, and the one the docs print. */
export const CI_KEEPALIVE: SshKeepalive = sshKeepalive(30, 10);

/** The `-o Key=Value` options out of a rendered dial, as a lookup. Takes EITHER
 *  render shape — the `sshDialOpts`/builder argv, or the whitespace-joined
 *  `NIX_SSHOPTS` string Nix splits — because "which option did we emit?" is one
 *  question and the two forms are two spellings of one answer. */
export function sshOpts(
  rendered: readonly string[] | string,
): Record<string, string> {
  const args = typeof rendered === "string" ? rendered.split(" ") : rendered;
  const opts: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const val = args[i + 1];
    if (args[i] === "-o" && val) {
      const [k, v] = val.split("=");
      opts[k ?? val] = v ?? "";
    }
  }
  return opts;
}

/** The `%C-<policy>` leaf a master for `keepalive` is named with — spelled the
 *  way `controlOptPairs` spells it (`policyTag` of the captured plan) rather
 *  than by hand, so a re-tuned tag cannot leave an assertion green on the old
 *  shape. */
export const socketLeaf = (
  keepalive: SshKeepalive = DEFAULT_SSH_KEEPALIVE,
): string => `/%C-${policyTag(renderableKeepalive(keepalive))}`;

/** The fused budgets a `provisionAgent` call needs (the connector reconciles the
 *  campaign reset itself, so `provisionAgent` takes no epoch), plus the dial's
 *  ssh policy — REQUIRED on `ProvisionOptions`, because every ssh of one dial
 *  must carry the same one. Pass a custom `budgets` (e.g. a tight-terminal one)
 *  to override. */
export function provArgs(budgets: ProvisionBudgets = makeProvisionBudgets()): {
  budgets: ProvisionBudgets;
  keepalive: SshKeepalive;
} {
  return { budgets, keepalive: DEFAULT_SSH_KEEPALIVE };
}
