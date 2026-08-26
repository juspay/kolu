/**
 * **The CONSUMER CLOSURE emitter** — what it costs an out-of-repo repo to
 * hydrate a set of kolu packages, derived from the manifests rather than
 * hand-tracked.
 *
 * A consumer (olai, odu, drishti) does not `npm install` kolu. It copies package
 * DIRECTORIES out of a content-addressed pin and resolves their imports from its
 * own root `node_modules` — so what it must copy is the transitive closure of
 * the manifests, and what it must have installed is that closure's external
 * dependencies. Both are facts this tree already knows.
 *
 * They were being hand-tracked anyway. One consumer's `nix/kolu.nix` grew a
 * `names` list from 7 entries to 30, one line at a time, each added by someone
 * chasing a `TS2307` — a list that is a manual re-derivation of
 * `declaredDependencyClosure`, kept correct by whoever hit the error last. The
 * human's word for the result was "still intertwined".
 *
 * So the derivation ships. This emits the whole workspace ADJACENCY — every
 * member, its directory, its workspace deps, its external deps and the versions
 * it declares — and `nix/consumer.nix` walks it from a consumer's SEED list in
 * pure Nix. A consumer then keeps only the seeds (the packages it actually
 * imports); the closure fills the rest and cannot be stale, because a stale
 * emission fails this repo's own governance gate.
 *
 * **Why an emitted ARTIFACT and not a script the consumer runs.** Nix cannot
 * execute anything at eval time, and the hydrate argv is needed at eval time.
 * The adjacency is therefore committed and gate-checked — the same shape as any
 * other derived-and-pinned fact here. It is seed-AGNOSTIC on purpose: one
 * artifact serves every consumer, and adding a consumer adds nothing to kolu.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { workspacePackageRoots } from "@kolu/daemon-test-gate/runtimeDepEdges";

/** The file the emission lives in, repo-relative. */
export const CONSUMER_CLOSURE_PATH = "nix/consumer-closure.json";

/** One workspace member, as a consumer needs to see it. */
export type ClosureMember = {
  /** Repo-relative directory (`packages/padi-client`). */
  dir: string;
  /** PINNED members are not in the archive a consumer fetches.
   *
   *  `osfacts-client` is the standing case: it is grafted from its own npins
   *  pin and gitignored, so `git archive` — and therefore the `src` a consumer
   *  hands `consumer.nix` — does not contain the directory at all. A walk that
   *  reached it and emitted a `cp -r` out of that `src` would produce a
   *  derivation that cannot build, from the very seed list this repo's own
   *  README prints. The consumer must graft it from the same pin, which is
   *  exactly the contract `padi-client`'s hydrate guard already documents.
   *
   *  Derived from `git ls-files`, not from a second hand-kept list beside
   *  `nix/workspace.nix`'s `pinnedNames`: "is this directory in the archive a
   *  consumer vendors" is a question git answers, and answering it that way is
   *  also what makes this emission derivable from a bare clone rather than from
   *  whichever grafts happen to have run on the emitting machine. */
  pinned?: true;
  /** Workspace members this one's manifest names — the edges of the walk. */
  workspace: string[];
  /** Non-workspace dependencies, with the version range this manifest declares.
   *  A consumer installs these from its OWN root manifest, so it needs the
   *  ranges, not just the names. */
  external: Record<string, string>;
};

export type ConsumerClosure = {
  /** Bumped when the SHAPE changes, so a consumer pinned to an older kolu reads
   *  a file it understands or fails loudly rather than silently mis-walking. */
  schemaVersion: 1;
  members: Record<string, ClosureMember>;
};

/** The directories git actually carries — the set a consumer's `src` contains.
 *
 *  One `git ls-files` for the whole tree rather than one per member: the answer
 *  is a property of the index, and asking it 67 times would be 67 subprocesses
 *  to learn one thing. A member whose directory contributes no tracked file is
 *  PINNED (see {@link ClosureMember.pinned}). */
function trackedDirs(repoRoot: string): Set<string> {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const dirs = new Set<string>();
  for (const file of out.split("\0")) {
    if (file === "") continue;
    // Every ancestor directory of a tracked file is itself tracked-bearing.
    let cut = file.lastIndexOf("/");
    while (cut > 0) {
      dirs.add(file.slice(0, cut));
      cut = file.lastIndexOf("/", cut - 1);
    }
  }
  return dirs;
}
type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Emit the adjacency for the whole workspace.
 *
 *  `dependencies` + `peerDependencies` only — the same two fields
 *  `declaredDependencyClosure` walks, and for the same reason: a consumer
 *  installs a copied directory's DECLARED runtime edges, never its
 *  devDependencies. Sorted throughout so the artifact is byte-stable and its
 *  diff is readable. */
export function emitConsumerClosure(repoRoot: string): ConsumerClosure {
  const members: Record<string, ClosureMember> = {};
  const dirs = new Map<string, string>();
  const tracked = trackedDirs(repoRoot);
  for (const dir of workspacePackageRoots(repoRoot)) {
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Manifest;
    if (manifest.name === undefined) continue;
    dirs.set(manifest.name, relative(repoRoot, dir).split(sep).join("/"));
  }
  for (const dir of workspacePackageRoots(repoRoot)) {
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Manifest;
    const name = manifest.name;
    if (name === undefined) continue;
    const declared = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    };
    const workspace: string[] = [];
    const external: Record<string, string> = {};
    for (const dep of Object.keys(declared).sort()) {
      if (dirs.has(dep)) workspace.push(dep);
      else external[dep] = declared[dep] as string;
    }
    const rel = dirs.get(name) as string;
    members[name] = {
      dir: rel,
      ...(tracked.has(rel) ? {} : { pinned: true as const }),
      workspace,
      external,
    };
  }
  return {
    schemaVersion: 1,
    members: Object.fromEntries(
      Object.keys(members)
        .sort()
        .map((k) => [k, members[k] as ClosureMember]),
    ),
  };
}

/** The emission as the bytes that belong on disk — one newline-terminated,
 *  two-space-indented JSON document, so "is it fresh" is a string compare and
 *  never a deep-equal with its own formatting opinions. */
export function renderConsumerClosure(closure: ConsumerClosure): string {
  return `${JSON.stringify(closure, null, 2)}\n`;
}

/** Is the committed artifact what this tree would emit right now?
 *
 *  Returns the emitted bytes on a match and THROWS on a mismatch, naming the
 *  regeneration command — a stale adjacency is a consumer hydrating yesterday's
 *  package set, which shows up in that consumer's compiler and not here. */
export function checkConsumerClosureFresh(repoRoot: string): string {
  const want = renderConsumerClosure(emitConsumerClosure(repoRoot));
  const path = join(repoRoot, CONSUMER_CLOSURE_PATH);
  let have: string;
  try {
    have = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `${CONSUMER_CLOSURE_PATH} is missing. Run \`just emit-consumer-closure\`.`,
    );
  }
  if (have !== want) {
    throw new Error(
      `${CONSUMER_CLOSURE_PATH} is stale — a manifest changed and the emission did not. ` +
        `Every consumer hydrating this pin would copy yesterday's package set, and it ` +
        `would surface as a TS2307 in THEIR compiler, not here. ` +
        `Run \`just emit-consumer-closure\`.`,
    );
  }
  return want;
}
