/**
 * Old session file under new padi — a previous-shape session persist blob
 * read by current code must restore (via backfill) or refuse by name, never
 * collapse to a silent empty session.
 *
 * Two seams, both pinned:
 *   1. The on-disk conf store (`openPadiStateStores`) returns the raw blob —
 *      conf does not re-validate session shape on read. A previous-shape
 *      payload is therefore still PRESENT after open (not wiped).
 *   2. The recovery path (`backfillSavedSession` + a `SavedSessionSchema`
 *      decode) — the same composition `importSession` uses — brings a known
 *      previous shape up to current, and THROWS on irrecoverable garbage
 *      (fail-fast).
 *
 * Mutate-to-prove: drop `backfillSavedSession` and the pre-discriminant blob
 * fails the decode (missing `state` / `location` / …); a test that only checked
 * "store returns something" would still pass — the decode pin is the bite.
 *
 * The decode is `Schema.decodeUnknownSync`, zod `.parse`'s successor. It matters
 * to THIS file that the swap is exact: `activeTerminalId` carries a KEY-level
 * decoding default (PLAN #17), so a blob that OMITS the key still backfills to
 * `null` — which is the previous shape planted below — while an in-process
 * caller that SPELLED `activeTerminalId: undefined` would now be rejected.
 * `backfillSavedSession` spreads only keys that are present and never writes an
 * explicit `undefined`, so the named-recovery law holds unchanged.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  pinPreviousShapeRecovery,
  plantYesterdayDaemon,
} from "@kolu/surface-daemon/upgrade-window.testlib";
import { requirePadiStateStores as openPadiStateStores } from "../session/stateStore.ts";
import { backfillSavedSession, SavedSessionSchema } from "../vocab.ts";
import { padiYesterdayDaemonOptions } from "./yesterdayDaemon.fixture.testlib.ts";

/** `SavedSessionSchema.parse`'s Effect successor — compiled once, exactly as the
 *  production readers bind theirs (padi-B1 §6). */
const decodeSavedSession = Schema.decodeUnknownSync(SavedSessionSchema);

/** A pre-discriminant, pre-location, pre-remoteUrl session — the shape a
 *  session saved before those schema bumps would have on disk. Every field
 *  the backfills cover is ABSENT; every field the current schema still
 *  requires and backfill does not invent is present (so the pin is about
 *  the named recovery path, not about inventing a full historical ladder). */
function previousShapeSession() {
  return {
    terminals: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        cwd: "/home/user/project",
        // Full git minus remoteUrl (pre-#1244) — the one field backfillRemoteUrl
        // adds. Other git fields are current so the pin bites on the backfills
        // that actually exist (state / location / remoteUrl / pr / restoreTarget).
        git: {
          repoRoot: "/home/user/project",
          repoName: "project",
          worktreePath: "/home/user/project",
          branch: "main",
          isWorktree: false,
          mainRepoRoot: "/home/user/project",
          // remoteUrl ABSENT — backfillRemoteUrl fills null
        },
        // no location (pre-#1398); no state (pre-sleeping-terminals discriminant);
        // no pr / restoreTarget (pre-awareness cutover).
        lastActivityAt: 42,
        themeName: "nord",
      },
    ],
    // activeTerminalId deliberately omitted — pre-field blob; schema defaults it.
    savedAt: 1_700_000_000_000,
  };
}

describe("old session file under new padi (upgrade-window)", () => {
  it("openPadiStateStores keeps a previous-shape session present (never silently empty)", async () => {
    const d = await plantYesterdayDaemon(
      padiYesterdayDaemonOptions({
        session: previousShapeSession(),
        withSocket: false,
        gate: { kind: "absent" },
      }),
    );
    try {
      if (d.state.kind !== "planted") throw new Error("expected planted state");
      const stores = openPadiStateStores(d.state.stateRoot);
      const session = stores.session.get();
      // PRESENT — conf does not wipe unknown shapes. A silent-empty regression
      // would return null here and the restore card would vanish.
      expect(session).not.toBeNull();
      expect(session?.terminals).toHaveLength(1);
      expect(session?.terminals[0]?.id).toBe(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );
      // Still previous-shape on the raw read (no auto-migration on open).
      expect(session?.terminals[0]).not.toHaveProperty("state");
      expect(session?.terminals[0]).not.toHaveProperty("location");
    } finally {
      await d.dispose();
    }
  });

  it("backfillSavedSession + parse RESTORES a known previous shape (named recovery)", () => {
    pinPreviousShapeRecovery({
      previous: previousShapeSession(),
      irrecoverable: { terminals: "not-an-array", savedAt: "nope" },
      recover: backfillSavedSession,
      parse: (value) => decodeSavedSession(value),
      assertRecovered: (recovered) => {
        expect(recovered.terminals).toHaveLength(1);
        expect(recovered.terminals[0]).toMatchObject({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          state: "active",
          location: { kind: "local" },
          cwd: "/home/user/project",
        });
        expect(recovered.activeTerminalId).toBeNull();
        expect(recovered.savedAt).toBe(1_700_000_000_000);
      },
    });
  });

  it("irrecoverable garbage REFUSES by name (throws) — never collapses to empty", () => {
    const garbage = {
      terminals: "not-an-array",
      savedAt: "nope",
    };
    // backfill leaves non-array terminals untouched; parse then throws.
    expect(() => decodeSavedSession(backfillSavedSession(garbage))).toThrow();

    // Planting via the real conf store does not invent a valid empty session —
    // the raw value stays, and any consumer that validates (importSession,
    // restore card) hits the throw above.
    const stateRoot = mkdtempSync(join(tmpdir(), "old-sess-garbage-"));
    const stores = openPadiStateStores(stateRoot);
    stores.conf.set("session", garbage as never);
    // conf returns the raw garbage; it is NOT silently replaced with null /
    // defaults. (An empty-collapse regression would make get() return null.)
    const raw = stores.session.get() as unknown;
    expect(raw).toEqual(garbage);
  });
});
