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
import {
  declaredDependencyClosure,
  workspacePackageRoots,
} from "@kolu/daemon-test-gate/runtimeDepEdges";
import { nixEvalJson, nixpkgsPreamble } from "./nixEval";
import { vendorEntries } from "./vendorEntries";

/** The file the emission lives in, repo-relative. */
export const CONSUMER_CLOSURE_PATH = "nix/consumer-closure.json";

/** One workspace member, as a consumer needs to see it. */
export type ClosureMember = {
  /** Repo-relative directory (`packages/padi-client`). */
  dir: string;
  /** PINNED members are not in the archive a consumer fetches — and this is the
   *  pin they are grafted from, at the revision kolu is built and tested
   *  against.
   *
   *  `osfacts-client` is the standing case: it is grafted from its own npins pin
   *  and gitignored, so `git archive` — and therefore the `src` a consumer hands
   *  `consumer.nix` — does not contain the directory at all. A walk that reached
   *  it and emitted a `cp -r` out of that `src` would produce a derivation that
   *  cannot build, from the very seed list this repo's own README prints. So the
   *  consumer grafts it from ITS pin — and then compiles the result against a
   *  supervisor copied from KOLU's. Two revisions of one package in one `tsc`,
   *  and nothing holding them together: it typechecks right up until a field
   *  moves.
   *
   *  That pairing was being held by hand. olai wrote 63 lines of shell for it
   *  (`scripts/check-osfacts-pin.sh`), which re-derives kolu's revision by
   *  jq-ing kolu's INTERNAL `npins/sources.json` — a file layout kolu never
   *  promised to keep. drishti took the other road and carries no second pin at
   *  all: its `nix/overlay.nix` reads kolu's own, so the two revisions are
   *  structurally one and there is nothing to check. odu does not reach osfacts.
   *  The revision is a fact this tree knows, so it is emitted here, and a
   *  consumer that DOES hold a second pin is checked against it at eval by
   *  `nix/consumer.nix` rather than in its own shell.
   *
   *  MEMBERSHIP is still derived from `git ls-files` — "is this directory in the
   *  archive a consumer vendors" is a question git answers, and answering it
   *  that way is what keeps this emission derivable from a bare clone rather
   *  than from whichever grafts happen to have run on the emitting machine. The
   *  PROVENANCE (which pin, which revision, which subdirectory) is DECLARED, in
   *  `nix/workspace.nix`'s `pinnedPins`, because a store path erases it. The two
   *  must agree, and {@link emitConsumerClosure} throws on EVERY way they can
   *  disagree — all three, which took two tries to get right. Untracked and
   *  undeclared was the hole the original one-way guard left open (it emitted a
   *  pinned member with nothing naming the revision a consumer must match);
   *  declared and absent was the one it did catch; and declared while TRACKED —
   *  a stale graft declaration, the state after a pinned package is brought into
   *  the tree for real — slipped through both, because the per-member branch
   *  never runs for a tracked member and the absent-check cannot see one that is
   *  present. "Both directions" was the claim; three is the number. */
  pin?: { name: string; revision: string; subdir: string };
  /** VENDORED members are the ones kolu actually supports being consumed from
   *  outside — the declared entries in `vendorEntries.ts` and their closure.
   *
   *  Being in that set is what puts a manifest under `effectPin.ts`, the gate
   *  that requires LITERAL dependency versions. Outside it, `catalog:`-freeness
   *  is a coincidence rather than an invariant: sixteen members are seedable
   *  today and in no vendored closure, and `@kolu/solid-markdown` — the obvious
   *  next reach for a consumer answering `renderLabel` — is one of them. Nothing
   *  stops it going `catalog:` on a future edit with CI green, breaking a
   *  consumer at a pin bump they did not make.
   *
   *  So `consumer.nix` gates SEEDS on this. That is not a gate on intent — the
   *  objection I raised when I declined to add one — it is a gate on a
   *  declaration that already exists. The closure may still REACH an unvendored
   *  member; what it may not do is let one be seeded, because a seed is a
   *  consumer saying "I import this". */
  vendored?: true;
  /** Workspace members this one's manifest names — the edges of the walk. */
  workspace: string[];
  /** Non-workspace dependencies, with the version range this manifest declares.
   *  A consumer installs these from its OWN root manifest, so it needs the
   *  ranges, not just the names. */
  external: Record<string, string>;
};

/** NO `schemaVersion`, deliberately — see `nix/consumer.nix`'s note. The reader
 *  and this artifact ship in the SAME pin (a consumer imports
 *  `"${koluSrc}/nix/consumer.nix"`, which reads `./consumer-closure.json` from
 *  that same store path), so a version comparison could never be false. Carrying
 *  the number anyway meant emitting a fact nobody compares across, to feed a
 *  guard that could not fire. */
export type ConsumerClosure = {
  members: Record<string, ClosureMember>;
};

/** The pin-grafted members and their provenance, asked of NIX rather than parsed
 *  out of its source.
 *
 *  `nix/workspace.nix` declares `pinnedPins` and derives `pinnedProvenance` from it,
 *  and this file needs the derived answer. The first version read the declaration
 *  with `/pinnedNames\s*=\s*\[([^\]]*)\]/` over the file's bytes — a hand-written
 *  parser for a language this repo ships an evaluator for, whose `[^\]]*` would
 *  have stopped at a `]` inside a comment and silently truncated the set.
 *  `closureWalk.ts` already asks Nix for the sibling `closureNamesFor` this way;
 *  there is no reason for two mechanisms in one directory. */
function declaredPinnedMembers(
  repoRoot: string,
): Record<string, { name: string; revision: string; subdir: string }> {
  const expr = `
    let pkgs = ${nixpkgsPreamble(repoRoot)};
    in (import "${repoRoot}/nix/workspace.nix" { inherit pkgs; }).pinnedProvenance`;
  return nixEvalJson<
    Record<string, { name: string; revision: string; subdir: string }>
  >(repoRoot, expr);
}

/** The directories git actually carries — the set a consumer's `src` contains.
 *
 *  One `git ls-files` for the whole tree rather than one per member: the answer
 *  is a property of the index. A member whose directory contributes no tracked
 *  file is PINNED (see {@link ClosureMember.pinned}). */
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
  const tracked = trackedDirs(repoRoot);
  const pinnedByDeclaration = declaredPinnedMembers(repoRoot);
  const vendored = new Set(
    declaredDependencyClosure({
      repoRoot,
      entries: vendorEntries(repoRoot),
    }).names,
  );

  // ONE walk, ONE parse per manifest. The first version looped
  // `workspacePackageRoots` twice with the same read/skip block copy-pasted into
  // both — two traversals and ~67 redundant `JSON.parse`s on every governance
  // run, beside a module that keeps an mtime-keyed manifest cache precisely to
  // avoid that.
  const parsed: { name: string; rel: string; manifest: Manifest }[] = [];
  for (const dir of workspacePackageRoots(repoRoot)) {
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Manifest;
    if (manifest.name === undefined) continue;
    parsed.push({
      name: manifest.name,
      rel: relative(repoRoot, dir).split(sep).join("/"),
      manifest,
    });
  }
  const names = new Set(parsed.map((m) => m.name));

  const members: Record<string, ClosureMember> = {};
  for (const { name, rel, manifest } of parsed) {
    // The SAME edge rule `declaredDependencyClosure` walks — `dependencies` +
    // `peerDependencies`, never devDependencies, because a hydrating consumer
    // installs a copied directory's declared RUNTIME edges. Spelled here rather
    // than imported only because that helper answers a closure, not an
    // adjacency; the rule itself must stay the same one, which is why it is
    // named rather than paraphrased.
    const declared = { ...manifest.dependencies, ...manifest.peerDependencies };
    const workspace: string[] = [];
    const external: Record<string, string> = {};
    for (const dep of Object.keys(declared).sort()) {
      if (names.has(dep)) workspace.push(dep);
      else external[dep] = declared[dep] as string;
    }
    // ABSENT-FROM-THE-ARCHIVE is git's answer; WHICH PIN IT CAME FROM is a
    // declaration, because a store path erases its own provenance. Untracked AND
    // undeclared is the hole the old one-directional guard left open: it emitted
    // `pinned: true` with nothing naming the revision a consumer has to match,
    // which is a consumer grafting whatever it likes and calling it agreement.
    let pin: ClosureMember["pin"];
    if (!tracked.has(rel)) {
      pin = pinnedByDeclaration[name];
      if (pin === undefined) {
        throw new Error(
          `'${name}' (${rel}) contributes no tracked file, so the source archive a ` +
            `consumer fetches will not contain it — but nix/workspace.nix does not ` +
            `declare it in \`pinnedPins\`, so nothing names the pin and revision it is ` +
            `grafted from. Declare it there, or commit the directory.`,
        );
      }
    }
    members[name] = {
      dir: rel,
      ...(pin !== undefined ? { pin } : {}),
      ...(vendored.has(name) ? { vendored: true as const } : {}),
      workspace,
      external,
    };
  }

  // THE LOUD FAIL a short emission needs — and the one the first attempt at this
  // guard missed. Parsing `workspace.nix` and throwing when its `pinnedNames`
  // SYNTAX is gone protects the parse, not the emission: membership still comes
  // from the directories that exist, so a bare clone without the graft quietly
  // dropped the member (and reclassified the supervisor's `workspace:*` edge as
  // an external). A consumer would then hydrate a package set missing a
  // directory nothing told it about. Declared-but-absent is the real failure, so
  // it is the one that throws.
  const missing = Object.keys(pinnedByDeclaration)
    .filter((n) => !(n in members))
    .sort();
  if (missing.length > 0) {
    throw new Error(
      `nix/workspace.nix declares these as pinned members but they are not in the ` +
        `tree: ${missing.join(", ")}. They are grafted from their own pins, so this ` +
        `emission would silently omit them and every consumer walking it would ` +
        `hydrate a short package set. Run \`just install\` and re-emit.`,
    );
  }

  // …and the THIRD case, which "both directions" did not actually cover: a
  // member that git DOES carry while `pinnedPins` still declares it. The
  // per-member branch above never runs for it (it is tracked), and `missing`
  // does not see it (it is in `members`), so the declaration was silently
  // dropped and the emission said nothing. That is a stale graft declaration —
  // the state after a pinned package is brought into the tree for real — and it
  // leaves `nix/workspace.nix` claiming a pin nothing grafts, which is the same
  // class of lie in the opposite direction.
  const stale = Object.keys(pinnedByDeclaration)
    .filter((n) => members[n] !== undefined && members[n]?.pin === undefined)
    .sort();
  if (stale.length > 0) {
    throw new Error(
      `nix/workspace.nix declares these in \`pinnedPins\`, but git carries their ` +
        `directories: ${stale.join(", ")}. A pinned member is one the source archive ` +
        `does NOT contain; these are in the tree, so nothing grafts them and the ` +
        `declaration is stale. Remove them from \`pinnedPins\` — leaving it in tells ` +
        `every consumer to supply a \`pinnedSources\` entry for a directory it ` +
        `already has.`,
    );
  }

  return {
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
  } catch (err) {
    // ENOENT ONLY. An EACCES or EIO reported as "is missing" would send a
    // reader to regenerate a file that is right there and unreadable — a caught
    // error collapsing into the convenient story.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
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
