/**
 * The profiles of the Agents setting, made deliverable — kolu-server's two
 * steps before a profile can go to a host, both run HERE, on the machine
 * running kolu (which already needs Nix and GitHub to provision padi):
 *
 *   - LOCK (`lockProfile`): a flake reference is fetched once with
 *     `nix flake prefetch` and pinned to the tree and revision it resolved to;
 *     a path (absolute, or `~/`) names a tree on this machine and is used as
 *     it is. So a `Custom…` path works on every host: the host never reads it.
 *   - BUILD (`buildProfile`): agent-distro's own `lib.mkProfile`, from the
 *     revision the host's package was published at (`./profile.nix`), into a
 *     store path holding everything a launch reads — nothing is fetched,
 *     evaluated or compiled at launch.
 *
 * Shipping the built path to a host is `./ops.ts`'s, beside the package's
 * pull. Every failure throws with Nix's own words, on one line: a profile that
 * will not lock or build is said under its entry in Settings and on the hosts
 * it could not reach, never dropped.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseProfileFile, profileFile } from "@kolu/agent-distro/profileFile";

/** A reference pinned: the tree it names (a store path, or a path on this
 *  machine) and, for a flake reference, the revision it was locked to. */
export interface LockedProfile {
  readonly reference: string;
  readonly tree: string;
  readonly rev?: string;
}

/** A profile built for a host's system: its store path on this machine, and
 *  the name and description the build gives itself. */
export interface BuiltProfile {
  readonly path: string;
  readonly name: string;
  readonly description: string;
}

/** Nix's words for a failure, on one line: its `error:` and what follows,
 *  else its last line. */
export function nixWords(stderr: string, fallback: string): string {
  const text = stderr.trim();
  const at = text.indexOf("error:");
  const words = (at < 0 ? (text.split("\n").at(-1) ?? "") : text.slice(at))
    .split(/\s*\n\s*/)
    .join(" ")
    .trim();
  return words === "" ? fallback : words;
}

/** Locking a reference the first time fetches it; a build fetches agent-distro
 *  and nixpkgs the first time, and may substitute packages. */
const NIX_TIMEOUT_MS = 15 * 60_000;

function runNix(args: readonly string[], what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "nix",
      [...args],
      {
        timeout: NIX_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => {
        if (err === null) resolve(stdout);
        else reject(new Error(`${what}: ${nixWords(stderr, err.message)}`));
      },
    );
  });
}

/** Is `reference` a path rather than a flake reference? Only an absolute path
 *  or one under `~/` names anything on this machine; a relative one names
 *  nothing (kolu-server has no working directory of the user's), and is
 *  refused by {@link lockProfile}. */
function pathOf(reference: string): string | undefined {
  if (reference.startsWith("/")) return reference;
  if (reference.startsWith("~/")) return join(homedir(), reference.slice(2));
  return undefined;
}

/** Pin `reference` — see the module header. */
export async function lockProfile(reference: string): Promise<LockedProfile> {
  const path = pathOf(reference);
  if (path !== undefined) return { reference, tree: path };
  if (reference.startsWith("./") || reference.startsWith("../"))
    throw new Error(
      `${reference}: a relative path names no profile here — use an absolute path, or one under ~/`,
    );
  // The global registry is downloaded before any fetch; only an indirect
  // reference (no `scheme:`) is looked up in it — agent-distro's own rule.
  const registry = /^[a-z][a-z0-9+.-]*:/i.test(reference)
    ? ["--option", "flake-registry", ""]
    : [];
  const out = await runNix(
    ["flake", "prefetch", ...registry, "--json", reference],
    `cannot fetch ${reference}`,
  );
  const value = JSON.parse(out) as {
    storePath?: unknown;
    locked?: { rev?: unknown; dir?: unknown };
    original?: { dir?: unknown };
  };
  if (typeof value.storePath !== "string")
    throw new Error(
      `cannot fetch ${reference}: nix flake prefetch gave no store path`,
    );
  const dir = value.locked?.dir ?? value.original?.dir;
  const rev = value.locked?.rev;
  return {
    reference,
    tree:
      typeof dir === "string" && dir !== ""
        ? join(value.storePath, dir)
        : value.storePath,
    ...(typeof rev === "string" ? { rev } : {}),
  };
}

const PROFILE_NIX = join(import.meta.dirname, "profile.nix");

/** Build `locked` for `hostSystem` with `flake` (agent-distro) at `rev` — see
 *  `./profile.nix`. */
export async function buildProfile(args: {
  readonly flake: string;
  readonly rev: string;
  readonly locked: LockedProfile;
  readonly hostSystem: string;
}): Promise<BuiltProfile> {
  const { locked } = args;
  const expr = `import ${JSON.stringify(PROFILE_NIX)} { agentDistro = ${JSON.stringify(`${args.flake}/${args.rev}`)}; profile = ${JSON.stringify(locked.tree)}; hostSystem = ${JSON.stringify(args.hostSystem)}; }`;
  const out = await runNix(
    ["build", "--impure", "--no-link", "--print-out-paths", "--expr", expr],
    `cannot build ${locked.reference} for ${args.hostSystem}`,
  );
  const path = out.trim().split("\n").at(-1) ?? "";
  if (!path.startsWith("/"))
    throw new Error(
      `cannot build ${locked.reference} for ${args.hostSystem}: nix build printed no store path`,
    );
  const file = parseProfileFile(readFileSync(profileFile(path), "utf8"));
  return { path, name: file.name, description: file.description };
}
