import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  declaredDependencyClosure,
  declaredRuntimeEdges,
  workspacePackageExtensions,
  workspacePackageRoots,
} from "@kolu/daemon-test-gate/runtimeDepEdges";
import { nixEvalJson, nixpkgsPreamble } from "./nixEval";
import { vendorEntries } from "./vendorEntries";

export const CONSUMER_CLOSURE_PATH = "nix/consumer-closure.json";

export type ClosureMember = {
  dir: string;
  pin?: { name: string; revision: string; subdir: string };
  vendored?: true;
  workspace: string[];
  external: Record<string, string>;
};

export type ConsumerClosure = {
  members: Record<string, ClosureMember>;
};

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

function trackedDirs(repoRoot: string): Set<string> {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const dirs = new Set<string>();
  for (const file of out.split("\0")) {
    if (file === "") continue;
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

export function emitConsumerClosure(repoRoot: string): ConsumerClosure {
  const tracked = trackedDirs(repoRoot);
  const pinnedByDeclaration = declaredPinnedMembers(repoRoot);
  const vendored = new Set(
    declaredDependencyClosure({
      repoRoot,
      entries: vendorEntries(repoRoot),
    }).names,
  );

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
  const extensions = workspacePackageExtensions(repoRoot);

  const members: Record<string, ClosureMember> = {};
  for (const { name, rel, manifest } of parsed) {
    const declared = declaredRuntimeEdges(manifest, extensions.get(name));
    const workspace: string[] = [];
    const external: Record<string, string> = {};
    for (const dep of Object.keys(declared).sort()) {
      if (names.has(dep)) workspace.push(dep);
      else external[dep] = declared[dep] as string;
    }
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

export function renderConsumerClosure(closure: ConsumerClosure): string {
  return `${JSON.stringify(closure, null, 2)}\n`;
}

export function checkConsumerClosureFresh(repoRoot: string): string {
  const want = renderConsumerClosure(emitConsumerClosure(repoRoot));
  const path = join(repoRoot, CONSUMER_CLOSURE_PATH);
  let have: string;
  try {
    have = readFileSync(path, "utf8");
  } catch (err) {
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
