/**
 * Host isolation — the GUARD that makes "a dev/test process touches the production
 * daemon" *unconstructible* (juspay/kolu#1334). The role STORAGE primitives it
 * builds on (selfRole, the marker read/write) live in `kaval` (the lowest kolu
 * daemon both padi and kaval reach) and are re-exported here so padi callers have a
 * single import surface.
 *
 *   - **Lock 1 — {@link resolveBoundStateRoot}**: a *binder* (kolu-server boot,
 *     padi `daemonMain`) that would resolve production's state-root without BEING
 *     production fails fast, before it binds/spawns/adopts anything. The DEFAULT
 *     root is production *by definition* — refused clocklessly, no marker needed.
 */

import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  persistentRoleMarkerPath,
  readPersistentRoleResult,
  selfRole,
} from "kaval";
import { defaultPadiStateRoot, resolvePadiStateRoot } from "./stateRoot.ts";

// Re-export the storage primitives so padi callers (daemonMain, the assembly, the
// tests) reach role storage + the guard through one module.
export {
  type DaemonRole,
  ephemeralRolePath,
  KOLU_ROLE_ENV,
  persistentRoleMarkerPath,
  readPersistentRoleResult,
  type RoleRead,
  ROLE_MARKER_FILE,
  selfRole,
  stampPersistentRole,
  writeEphemeralRole,
  writePersistentProductionMarker,
} from "kaval";

// ── Canonical (realpath) root identity — Lock 1's fail-closed compare ──

/** A path canonicalized down to its deepest EXISTING ancestor (juspay/kolu#1334, F3):
 *  `real` is `realpath(deepest-existing-ancestor) + the still-absent suffix`; `error`
 *  is any NON-ENOENT realpath failure (EACCES/ELOOP/EIO) at some level — the path's
 *  identity can't be established, so the caller fails closed. There is no `absent`
 *  case: even a leaf that doesn't exist yet resolves through its (possibly SYMLINKED)
 *  existing ancestor, which is exactly the identity that matters. */
type CanonRoot = { kind: "canonical"; real: string } | { kind: "error" };

/** Walk up from `p`'s leaf until a realpath succeeds, then re-append the unresolved
 *  suffix — the F3 canonicalization. A leaf-only realpath ENOENTs when the leaf is
 *  absent and forces a LEXICAL fallback; but BOTH the default padi leaf and an alias
 *  leaf can be absent beneath an already-existing SYMLINKED ancestor, so lexical says
 *  "differ" and creating the alias leaf creates the real production root. Resolving the
 *  deepest existing ancestor collapses the symlinked parent to its real target on BOTH
 *  sides, so genuinely-absent-but-aliased leaves compare EQUAL and the bind is refused.
 *  A non-ENOENT error at any level → `error` (fail closed, never lexical). */
function canonicalRootSync(p: string): CanonRoot {
  let current = resolve(p);
  const suffix: string[] = [];
  for (;;) {
    try {
      return {
        kind: "canonical",
        real: join(realpathSync(current), ...suffix),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return { kind: "error" };
      }
      const parent = dirname(current);
      if (parent === current) return { kind: "error" }; // exhausted to fs root
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Do `a` and `b` name the SAME root by canonical filesystem identity (F3)? A purely
 * LEXICAL compare (`resolve(a) === resolve(b)`) is bypassable by a symlink alias:
 * `dev-root → ~/.local/state/padi` is lexically distinct from the default root yet
 * opens the exact same production files, so a dev binder would be let onto it. Each
 * side is canonicalized to its deepest EXISTING ancestor + unresolved suffix
 * ({@link canonicalRootSync}), so a symlinked ancestor resolves even when the leaf is
 * absent. FAIL-CLOSED: a non-ENOENT identity error on EITHER side → `true` (the caller
 * REFUSES) rather than reopen the aliasing hole this helper exists to close.
 */
export function sameRootIdentity(a: string, b: string): boolean {
  const ca = canonicalRootSync(a);
  const cb = canonicalRootSync(b);
  if (ca.kind === "error" || cb.kind === "error") return true; // fail closed
  return ca.real === cb.real;
}

// ── Lock 1 — the bound-state-root resolver + its refusal ────────────────────

/** The fatal error a non-production binder raises when it would bind/spawn/adopt
 *  at a production state-root. A distinguished class the composition root logs
 *  `fatal` + `exit(1)` on, exactly like `SupervisorConflictError` — structurally
 *  unresolvable (retrying can't make the process become production). */
export class StateRootIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateRootIsolationError";
  }
}

/**
 * Resolve the state-root a BINDER (kolu-server boot, padi `daemonMain`) should
 * bind — the fail-closed twin of {@link resolvePadiStateRoot}, which stays the
 * read-only *client* resolver (it never binds/adopts/kills, so it may still
 * compute the default for a sensible connect error).
 *
 * The DEFAULT root is production BY DEFINITION, so a non-production binder is
 * refused there clocklessly — no marker consulted (A2). This alone closes the
 * pre-fix unmarked-production window, the marker-unreadable arm, and the
 * standalone-kaval no-manifest case. An explicitly-supplied RELOCATED root that
 * carries a persistent `production` marker is refused too (A3c) — the
 * spawn-onto-prod-root-while-down hole. A production binder resolves normally.
 */
export function resolveBoundStateRoot(override?: string): string {
  // Single-source the override/env/default DERIVATION through the read-only client
  // resolver — this resolver adds ONLY the refusal POLICY on top, so a change to how
  // the root is located (env-var rename, an added precedence rule) lands in one place.
  const wasExplicit = Boolean(override ?? process.env.KOLU_PADI_STATE_DIR);
  const root = resolvePadiStateRoot(override);
  const production = selfRole() === "production";
  if (wasExplicit) {
    if (!production) {
      // Canonical (realpath) identity, not a lexical string compare — a symlink alias
      // to the default/production root is lexically distinct but opens the same files
      // (F3). Fail-closed if identity can't be established (see `sameRootIdentity`).
      if (sameRootIdentity(root, defaultPadiStateRoot())) {
        throw defaultRootRefusal(root);
      }
      // An UNREADABLE persistent marker on an explicit root is refused too (F7): we
      // cannot prove the root is not a relocated production root, so fail closed
      // rather than read a corrupt/EACCES marker as "unmarked → dev may bind".
      const persistent = readPersistentRoleResult(root);
      if (persistent.kind === "unreadable") throw markedRootRefusal(root);
      if (persistent.kind === "role" && persistent.role === "production") {
        throw markedRootRefusal(root);
      }
    }
    return root;
  }
  // No override: production binds its default; a non-production binder that would
  // silently inherit production's default root is refused (the #1334 bare-launch
  // hole — the padi twin of state.ts's KOLU_STATE_DIR refusal).
  if (production) return root;
  throw bareLaunchRefusal(root);
}

function bareLaunchRefusal(defaultRoot: string): StateRootIsolationError {
  return new StateRootIsolationError(
    `refusing to bind the padi state-root: this is not a production launch ` +
      `(KOLU_ROLE is unset) and no KOLU_PADI_STATE_DIR is set, so it would ` +
      `silently adopt PRODUCTION's default state-root (${defaultRoot}) and could ` +
      `steal or SIGTERM the live kolu's terminals. Set KOLU_PADI_STATE_DIR=<dir> ` +
      `to an isolated per-workspace path (the \`just server\` / \`pnpm dev\` ` +
      `entrypoints already do). Only the production kolu wrapper sets KOLU_ROLE.`,
  );
}

function defaultRootRefusal(root: string): StateRootIsolationError {
  return new StateRootIsolationError(
    `refusing to bind the padi state-root ${root}: it is production's default ` +
      `root and this is not a production launch (KOLU_ROLE unset). Binding here ` +
      `would clobber the live kolu's session state. Point KOLU_PADI_STATE_DIR at ` +
      `an isolated path instead.`,
  );
}

function markedRootRefusal(root: string): StateRootIsolationError {
  return new StateRootIsolationError(
    `refusing to bind the padi state-root ${root}: it carries a production ` +
      `marker (${persistentRoleMarkerPath(root)}) and this is not a production ` +
      `launch. A production kolu owns this relocated root; binding a dev/test ` +
      `instance here would clobber its state. Use a different KOLU_PADI_STATE_DIR, ` +
      `or — if this root is genuinely no longer production — delete the marker ` +
      `file explicitly.`,
  );
}
