/**
 * A stand-in agent-distro BAKE for the e2e server — the three env vars
 * `default.nix` sets on a real kolu (`KOLU_AGENT_DISTRO_BUNDLE`,
 * `KOLU_AGENT_DISTRO_UPDATER`, `KOLU_AGENT_PLUGIN_DIR`), pointing at a tiny
 * on-disk bundle described the way `@kolu/agent-distro`'s Nix half describes the
 * real one — by its manifest, `share/kolu/agent-distro.json`, which names:
 *
 *     each profile's bin/claude        prints "agent-distro fixture: <name> claude"
 *     each profile's bin/agent-distro  its picker: `--list --json` lists that
 *                                      profile, as upstream's bundle does
 *
 * The real floor is gigabytes of compiled harnesses; what the e2e lane proves is
 * kolu's half — Settings lists the profiles, the next terminal (not the current
 * one) gets the chosen profile's `claude` first on its PATH and wears its chip,
 * and off removes both. The Nix build proves the real manifest's entries exist.
 *
 * The UPDATER is a stand-in too (`fixtureUpdaterScript`), run by padi exactly
 * as the real one is (`node <script> <config> --progress`) and writing what the
 * real one writes beside `current`: the `last-success` stamp and the history
 * log. By default a run finds nothing newer (`unchanged`: `current` points at
 * the floor's own profile dir, so nothing a step can see moves). A step steers
 * the NEXT run of a profile with {@link fixtureNextRun}: land a newer bundle
 * (`update` — its own dir, hash and claude version), or skip it as the real one
 * does when the cache does not hold the bundle yet (`skip`).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLACEHOLDER = "@KOLU_XDG_STATE_HOME@";
export const FIXTURE_PROFILES = ["vanilla", "juspay"] as const;
/** The profile the fixture's listing leads with — the one "turn Agents on"
 *  picks. */
export const FIXTURE_DEFAULT_PROFILE = FIXTURE_PROFILES[0];

/** The fixture's ONE harness, as its listing names it — steps read the line
 *  Settings shows off this (`harnessLine`), never a hand-typed copy. */
export const FIXTURE_HARNESS = {
  name: "claude",
  title: "Claude Code",
  tagline: "fixture",
  version: "0.0.0",
} as const;

/** A fixture profile, as its picker lists it. */
export function fixtureProfile(name: string): {
  name: string;
  description: string;
  harnesses: (typeof FIXTURE_HARNESS)[];
} {
  return {
    name,
    description: `Fixture profile ${name}`,
    harnesses: [FIXTURE_HARNESS],
  };
}

/** What a profile's stub `claude` prints — the step that runs it waits for
 *  this, and it is never typed (the command is just `claude`). */
export function fixtureClaudeSays(profile: string): string {
  return `agent-distro fixture: ${profile} claude`;
}

/** Every fixture path carries this, so a step can tell a fixture agent on the
 *  PATH from anything else. */
export const FIXTURE_MARK = "kolu-e2e-agent-distro";

/** Why the fixture updater skips, in the real updater's words. */
export const FIXTURE_SKIP_REASON =
  "bundle not fully cached yet (would build claude-code)";

/** How the next fixture updater run of a profile ends. */
export type FixtureRun = "unchanged" | "update" | "skip";

/** The stand-in updater. It reads its config (state dir, history log,
 *  profile), then the one-shot `next-<profile>` file in the fixture root (if a
 *  step wrote one), and does what it says. An `update` reports bytes, holds a
 *  moment so the run is visible, then lands a new bundle dir whose versions
 *  file moves the claude version one step on. */
function fixtureUpdaterScript(root: string): string {
  return `
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = ${JSON.stringify(root)};
const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
// Anything that goes wrong here is the run's failure, in words — never a bare
// crash whose only trace is Node's version line.
const failed = (err) => {
  out({ result: "failed", reason: "fixture updater: " + (err && err.stack ? err.stack.split("\\n")[0] : String(err)) });
  process.exit(1);
};
process.on("uncaughtException", failed);
process.on("unhandledRejection", failed);
const next = join(root, "next-" + cfg.profile);
const mode = existsSync(next) ? readFileSync(next, "utf8").trim() : "unchanged";
rmSync(next, { force: true });
mkdirSync(cfg.state, { recursive: true });
// Where this host keeps the fixture's state, for the reset between scenarios.
writeFileSync(join(root, "state-home"), join(cfg.state, ".."));
const current = join(cfg.state, "current");
const floor = join(root, "profiles", cfg.profile);
// No \`current\` yet points at the floor. A DANGLING one is not repaired:
// upstream at the pin reads \`lstat ? realpath(current) : ''\`
// (\`src/update/update.ts\`), which throws ENOENT on it — every run then fails
// (padi reads such a \`current\` as absent). The fixture fails the same way,
// through \`failed\` above, so a scenario that leaves one is visible.
try {
  lstatSync(current);
} catch (err) {
  if (err.code !== "ENOENT") failed(err);
  symlinkSync(floor, current);
}
try {
  realpathSync(current);
} catch (err) {
  failed(err);
}
// Local time with its offset, as upstream's \`timestamp()\` writes it
// (\`date +%Y-%m-%dT%H:%M:%S%:z\`), never UTC's \`Z\`.
const pad = (n) => String(n).padStart(2, "0");
const timestamp = (date = new Date()) => {
  const offset = -date.getTimezoneOffset();
  const zone = (offset < 0 ? "-" : "+") + pad(Math.floor(Math.abs(offset) / 60)) + ":" + pad(Math.abs(offset) % 60);
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate())
    + "T" + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds()) + zone;
};
const record = (event) => {
  mkdirSync(join(cfg.history, ".."), { recursive: true });
  appendFileSync(cfg.history, timestamp() + " " + cfg.profile + " " + event + "\\n");
};
const stamp = () => writeFileSync(join(cfg.state, "last-success"), Math.floor(Date.now() / 1000) + "\\n");
const claudeVersion = (bundle) =>
  readFileSync(join(bundle, "share", "agent-distro", "versions"), "utf8").split("\\t")[2].trim();
if (mode === "skip") {
  record("skipped: " + ${JSON.stringify(FIXTURE_SKIP_REASON)});
  out({ result: "skipped", reason: ${JSON.stringify(FIXTURE_SKIP_REASON)} });
} else if (mode === "update") {
  out({ progress: { done: 1048576, total: 4194304 } });
  await new Promise((r) => setTimeout(r, 1500));
  const old = realpathSync(current);
  const n = readdirSync(join(root, "updates")).length + 1;
  const fresh = join(root, "updates", "u" + n + cfg.profile);
  const from = claudeVersion(old);
  const to = "0.0." + n;
  mkdirSync(join(fresh, "bin"), { recursive: true });
  for (const command of ["claude", "agent-distro"])
    writeFileSync(join(fresh, "bin", command), readFileSync(join(floor, "bin", command)), { mode: 0o755 });
  mkdirSync(join(fresh, "share", "agent-distro"), { recursive: true });
  writeFileSync(join(fresh, "share", "agent-distro", "versions"), "claude\\tClaude Code\\t" + to + "\\n");
  out({ progress: { done: 4194304, total: 4194304 } });
  rmSync(current, { force: true });
  symlinkSync(fresh, current);
  stamp();
  record("updated: Claude Code " + from + " → " + to);
  out({ result: "updated", bundle: realpathSync(current) });
} else {
  // A moment, as a real check takes, so the run is visible.
  await new Promise((r) => setTimeout(r, 800));
  stamp();
  out({ result: "unchanged", bundle: realpathSync(current) });
}
`;
}

/** The fixture's root — the floor dir the bake names. */
function fixtureRoot(): string {
  const root = memo?.KOLU_AGENT_DISTRO_BUNDLE;
  if (root === undefined)
    throw new Error("the agent-distro fixture is not built in this worker");
  return root;
}

/** Make the next fixture updater run of `profile` end as `run`. */
export function fixtureNextRun(profile: string, run: FixtureRun): void {
  fs.writeFileSync(path.join(fixtureRoot(), `next-${profile}`), run);
}

/** Undo every run's traces — the state dir with its `current`, stamps and
 *  history, the landed bundles, any unconsumed `next-*` — so the next scenario
 *  meets the floor again. */
export function fixtureResetUpdates(): void {
  const root = fixtureRoot();
  const stateHome = path.join(root, "state-home");
  if (fs.existsSync(stateHome))
    fs.rmSync(fs.readFileSync(stateHome, "utf8"), {
      recursive: true,
      force: true,
    });
  fs.rmSync(path.join(root, "updates"), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "updates"));
  for (const profile of FIXTURE_PROFILES)
    fs.rmSync(path.join(root, `next-${profile}`), { force: true });
}

let memo: Record<string, string> | undefined;

const script = (file: string, body: string) => {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

/** Build the fixture once (per worker) and return the env that bakes it. */
export function agentDistroFixtureEnv(): Record<string, string> {
  memo ??= buildFixture();
  return memo;
}

function buildFixture(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${FIXTURE_MARK}-`));
  fs.mkdirSync(path.join(root, "updates"), { recursive: true });
  const updaterScript = path.join(root, "updater.mjs");
  fs.writeFileSync(updaterScript, fixtureUpdaterScript(root));
  const profiles = FIXTURE_PROFILES.map((name) => {
    const bin = path.join(root, "profiles", name, "bin");
    fs.mkdirSync(bin, { recursive: true });
    script(path.join(bin, "claude"), `echo "${fixtureClaudeSays(name)}"`);
    // The profile's own picker, as upstream's bundle carries it; kolu-server
    // lists each profile off it.
    const listing = JSON.stringify({ profiles: [fixtureProfile(name)] });
    script(path.join(bin, "agent-distro"), `printf '%s\\n' '${listing}'`);
    // The floor's versions, as a real bundle lists them.
    const share = path.join(root, "profiles", name, "share", "agent-distro");
    fs.mkdirSync(share, { recursive: true });
    fs.writeFileSync(
      path.join(share, "versions"),
      `${FIXTURE_HARNESS.name}\t${FIXTURE_HARNESS.title}\t${FIXTURE_HARNESS.version}\n`,
    );
    const config = path.join(root, `update-${name}.json`);
    fs.writeFileSync(
      config,
      JSON.stringify({
        profile: name,
        state: `${PLACEHOLDER}/${FIXTURE_MARK}/${name}`,
        history: `${PLACEHOLDER}/${FIXTURE_MARK}/history.log`,
        // Upstream's schedule (lib/schedule.nix), as `lib.mkUpdater` writes it.
        periodSeconds: 21600,
        offsetSeconds: 7200,
      }),
    );
    // This node, by absolute path: padi spawns it with its own PATH.
    return { name, command: [process.execPath, updaterScript], config };
  });
  const updater = path.join(root, "updater.json");
  fs.writeFileSync(
    updater,
    JSON.stringify({ stateHomePlaceholder: PLACEHOLDER, profiles }),
  );
  // The manifest — the only thing about the floor's shape kolu reads.
  fs.mkdirSync(path.join(root, "share", "kolu"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "share", "kolu", "agent-distro.json"),
    JSON.stringify({
      default: FIXTURE_DEFAULT_PROFILE,
      profiles: FIXTURE_PROFILES.map((name) => {
        const dir = path.join(root, "profiles", name);
        return { name, dir, bin: path.join(dir, "bin"), hash: name };
      }),
    }),
  );
  const plugin = path.join(root, "plugin");
  fs.mkdirSync(plugin, { recursive: true });
  fs.writeFileSync(path.join(plugin, "plugin.json"), '{"name":"kolu"}');
  return {
    KOLU_AGENT_DISTRO_BUNDLE: root,
    KOLU_AGENT_DISTRO_UPDATER: updater,
    KOLU_AGENT_PLUGIN_DIR: plugin,
  };
}
