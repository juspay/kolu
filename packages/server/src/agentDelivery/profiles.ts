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
 *     revision the host's package was published at, for the host's system,
 *     into a store path holding everything a launch reads — nothing is
 *     fetched, evaluated or compiled at launch.
 *
 * Shipping the built path to a host is `./ops.ts`'s, beside the package's
 * pull. Every failure throws with Nix's own words, on one line: a profile that
 * will not lock or build is said under its entry in Settings and on the hosts
 * it could not reach, never dropped.
 *
 * A profile is an Agent Plugin: its tree holds a `plugin.json`, and the
 * plugins, packages, env and settings a plugin does not carry sit in that
 * file's `extensions."asia.nixos.agent-distro"`. A tree still holding an
 * `agent-distro.nix` does not build — upstream refuses that format, and its
 * migration message is what the red line under the row says, kolu adding no
 * words of its own.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  classifyReference,
  prefetchArgs,
  prefetchedTree,
} from "@juspay/agent-distro/profile/reference";
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

/** Pin `reference` — see the module header. What a reference names, the
 *  fetch's arguments and where its answer put the tree are upstream's own
 *  rules (`@juspay/agent-distro/profile/reference`, which its launch reads a
 *  reference with); kolu-server runs the fetch itself, asynchronously, and
 *  reads nothing against a working directory — it has none of the user's — so
 *  a relative path is refused. */
export async function lockProfile(reference: string): Promise<LockedProfile> {
  const kind = classifyReference(reference, { home: homedir() });
  if (kind === null)
    throw new Error(
      /^\.\.?(\/|$)/.test(reference)
        ? `${reference}: a relative path names no profile here — use an absolute path, or one under ~/`
        : `${reference}: not a profile reference — a flake reference (github:owner/repo), an absolute path, or one under ~/`,
    );
  if ("path" in kind) return { reference, tree: kind.path };
  const what = `cannot fetch ${reference}`;
  const tree = prefetchedTree(
    JSON.parse(await runNix(prefetchArgs(kind.flake), what)),
  );
  if (tree === null)
    throw new Error(`${what}: nix flake prefetch gave no store path`);
  return {
    reference,
    tree: tree.path,
    ...(tree.rev === undefined ? {} : { rev: tree.rev }),
  };
}

/** Build `locked` for `hostSystem` with agent-distro's own `lib.mkProfile`,
 *  from `flake` at `rev` — the revision the host's package was published at,
 *  so the same nixpkgs and the same plugin reader as the launcher that reads
 *  the profile there, and a launch fetches, evaluates and compiles nothing.
 *  A host of another system gets a profile built for this machine's, without
 *  packages — or, when it has packages for the host's system, mkProfile's
 *  refusal naming the profile and both systems (its `hostSystem`). Impure for
 *  `getFlake`, and for mkProfile locking a plugin named by a flake
 *  reference. */
export async function buildProfile(args: {
  readonly flake: string;
  readonly rev: string;
  readonly locked: LockedProfile;
  readonly hostSystem: string;
}): Promise<BuiltProfile> {
  const { locked } = args;
  const expr = `(builtins.getFlake ${JSON.stringify(`${args.flake}/${args.rev}`)}).lib.mkProfile { system = builtins.currentSystem; hostSystem = ${JSON.stringify(args.hostSystem)}; profile = ${JSON.stringify(locked.tree)}; }`;
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
