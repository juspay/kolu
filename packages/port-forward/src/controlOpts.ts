/**
 * The ssh connection-multiplexing (`ControlMaster`) options every ssh this
 * package spawns rides on. This is the whole integration story with kolu:
 * `ControlPath` is computed *deterministically* from a per-user runtime dir
 * and ssh's `%C` token, and `ControlMaster=auto` makes whoever connects first
 * the master — so a forward opened here and a kolu terminal mirror opened
 * elsewhere share ONE ssh connection with zero coordination code. The
 * convention IS the integration.
 *
 * The twin of this module is `packages/surface-remote/src/controlMaster.ts`
 * (kolu's own ssh multiplexing). The two MUST spell the same `ControlPath` or
 * kolu and a forward would each open their own master. They are deliberately
 * separate code — this package has zero kolu dependencies so it (and vazhi on
 * top of it) can stand alone — and `controlOpts.test.ts` pins the shared
 * constants against that file's source, so a drift fails a test rather than
 * silently doubling the ssh connections.
 *
 * One deliberate divergence from the twin: it degrades to "no multiplexing"
 * when the runtime dir is unusable, because there multiplexing is only a
 * speedup. Here the master is the *mechanism* (`ssh -O forward` has nothing to
 * talk to without one), so an unusable runtime dir CRASHES LOUDLY instead of
 * pretending a forward could be made.
 */

import { lstatSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** The app namespace for the control-socket dir. Must equal the `app` that
 *  `controlMaster.ts` passes to `getRuntimeSocketPath` (pinned by the drift
 *  test) — the directory component of the shared path. */
export const CONTROL_APP = "kolu-ssh";

/** ssh's `%C` token: a fixed-length host+port+user hash ssh expands at connect
 *  time. One path string serves every host while each host still gets its own
 *  socket, and the result stays well under the ~104-char `sun_path` limit. */
export const CONTROL_FILE = "%C";

/** How long a master we open lingers idle after its last channel closes.
 *  Matches the twin's `CONTROL_PERSIST` so a master is interchangeable
 *  whichever side opened it. NB a forward listener does NOT count as a live
 *  channel — an idle master reaps its forwards with it, which is why
 *  `sshForward.ts` holds an anchor session open for as long as it holds a
 *  forward. */
export const CONTROL_PERSIST = "10m";

/** The per-user runtime path for the control socket — `$XDG_RUNTIME_DIR/kolu-ssh/%C`
 *  on systemd Linux, else the `$TMPDIR`-independent `/tmp/kolu-ssh-$UID/%C`.
 *  The formula is `getRuntimeSocketPath` in `@kolu/surface/unix-socket`,
 *  restated here so this package stays dependency-free; `os.tmpdir()` is the
 *  wrong tool for a path two independent processes must agree on (it honours
 *  `$TMPDIR`, which differs by launch context). */
export function controlSocketPath(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg !== undefined && xdg !== "") {
    return join(xdg, CONTROL_APP, CONTROL_FILE);
  }
  const uid = process.getuid?.() ?? "shared";
  return join(`/tmp/${CONTROL_APP}-${uid}`, CONTROL_FILE);
}

/** Is `dir` a private, owner-only directory we own? Anyone who can reach the
 *  control socket can open channels on the live connection, so the directory
 *  is the security boundary. `lstatSync` (not `statSync`) so a symlink is
 *  judged as itself, never followed to a target whose path component an
 *  attacker still controls. True on platforms without uid semantics. */
function isPrivateOwnedDir(dir: string): boolean {
  const getuid = process.getuid?.bind(process);
  if (getuid === undefined) return true;
  const stat = lstatSync(dir);
  return (
    stat.isDirectory() && stat.uid === getuid() && (stat.mode & 0o077) === 0
  );
}

/** Memoized: the runtime dir and its ownership don't change under us, so the
 *  mkdir + lstat run once per process and every later render is pure. */
let memo: readonly string[] | undefined;

/** The `-o Key=Value` argv that puts an ssh command on the shared master,
 *  creating the owner-only control dir on first use. Throws — never degrades —
 *  when the dir can't be created, isn't owner-only, or the path contains
 *  whitespace (which would corrupt any word-split rendering of these opts).
 *  Without a control socket there is no `ssh -O forward` at all, so a caller
 *  must learn that here rather than from a confusing ssh error later. */
export function sshControlArgs(): readonly string[] {
  if (memo !== undefined) return memo;
  const path = controlSocketPath();
  if (/\s/.test(path)) {
    throw new Error(
      `port-forward: the ssh control path contains whitespace (${path}). Set XDG_RUNTIME_DIR to a whitespace-free directory.`,
    );
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is a no-op on a pre-existing dir, so VERIFY privacy rather
  // than assume it — a stable per-user path another local user could have
  // pre-created with loose perms must not host our connection.
  if (!isPrivateOwnedDir(dir)) {
    throw new Error(
      `port-forward: the ssh control directory ${dir} is not an owner-only directory owned by this user. Anyone who can reach it can open channels on the ssh connection; remove or fix it (chmod 700) and retry.`,
    );
  }
  memo = [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${path}`,
    "-o",
    `ControlPersist=${CONTROL_PERSIST}`,
  ];
  return memo;
}

/** Test-only: drop the memo so a test can re-drive `sshControlArgs()` after
 *  stubbing `$XDG_RUNTIME_DIR`. Not part of the package's public API. */
export function __resetControlMemo(): void {
  memo = undefined;
}
