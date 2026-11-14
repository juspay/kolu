/** The ONE renamed-bash trick, written once.
 *
 *  A fake agent binary is a COPY of `bash` under the agent's own basename —
 *  not a symlink, not a wrapper script. The kernel's `/proc/<pid>/comm`
 *  (Linux) and sysctl KERN_PROC_PATHNAME (darwin) both reflect the execve
 *  basename, so a bash copy launched as `.../bin/codex -c "…"` shows up with
 *  comm="codex" — the single input padi's foreground sensor gets — without the
 *  real CLI being installed. A symlink would resolve back to `bash`, and a
 *  script's comm is the interpreter's.
 *
 *  `/bin/sleep` tempts as a simpler stub but fails on nixpkgs: coreutils ships
 *  as a multi-call binary that inspects argv[0] and errors with "unknown
 *  program 'codex'" when renamed. Bash is single-purpose and copies cleanly.
 *
 *  The directory's lifecycle belongs to the CALLER (where it lives, when it is
 *  removed); this only fills it. */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Copy `bash` into `dir` once per name. Returns the absolute paths keyed by
 *  the name they were staged under. `bash` is resolved once per call; repeated
 *  names are simply copied again, so callers may pass a registry-derived list
 *  without de-duplicating it. */
export function stageRenamedBash(
  dir: string,
  names: readonly string[],
): Record<string, string> {
  const bash = execSync("command -v bash", { encoding: "utf8" }).trim();
  const bins: Record<string, string> = {};
  for (const name of names) {
    const target = path.join(dir, name);
    fs.copyFileSync(bash, target);
    fs.chmodSync(target, 0o755);
    bins[name] = target;
  }
  return bins;
}
