import { type ExecFileException, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  classifyReference,
  prefetchArgs,
  prefetchedTree,
} from "@juspay/agent-distro/profile/reference";
import { failureMessage } from "@kolu/agent-distro/failure";
import { parseProfileFile, profileFile } from "@kolu/agent-distro/profileFile";

export interface LockedProfile {
  readonly reference: string;
  readonly tree: string;
  readonly rev?: string;
}

export interface BuiltProfile {
  readonly path: string;
  readonly name: string;
  readonly description: string;
}

export function nixWords(stderr: string, fallback: string): string {
  const text = stderr.trim();
  const at = text.lastIndexOf("error:");
  const words = (at < 0 ? (text.split("\n").at(-1) ?? "") : text.slice(at))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  return words === "" ? fallback : words;
}

const NIX_TIMEOUT_MS = 15 * 60_000;

const NIX_MAX_BUFFER = 64 * 1024 * 1024;

export function nixFailure(
  what: string,
  run: { readonly stderr: string; readonly error: ExecFileException },
  timeoutMs: number,
): string {
  const { stderr, error } = run;
  const headline =
    error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
      ? `${what}: nix printed more than kolu reads`
      : error.killed === true
        ? `${what}: nix did not finish in ${Math.round(timeoutMs / 60_000)} minutes and was stopped`
        : typeof error.signal === "string"
          ? `${what}: nix was killed by ${error.signal}`
          : `${what}: ${nixWords(stderr, error.message)}`;
  return failureMessage(headline, stderr);
}

function runNix(args: readonly string[], what: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "nix",
      [...args],
      {
        timeout: NIX_TIMEOUT_MS,
        maxBuffer: NIX_MAX_BUFFER,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout);
        else
          reject(
            new Error(nixFailure(what, { stderr, error }, NIX_TIMEOUT_MS)),
          );
      },
    );
  });
}

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
