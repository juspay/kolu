// @vitest-environment happy-dom
/**
 * #1793 — the Kaval (& Padi) info dialog must not leak CONNECTED-ERA FACTS over a
 * DEAD channel. When a host is unreachable (ssh timed out, "retrying … attempt 11")
 * the daemon `status` FREEZES at its last-read value — stale-but-truthy — while the
 * channel that would refresh it is gone (`live === false`). Every field that names a
 * fact ("contract v5.2", the unix socket path, build commit, uptime, memory) is then
 * a claim the dead channel can no longer confirm, and must read "unknown"/"—", NOT
 * the retained value.
 *
 * This is the REPRODUCTION-FIRST red test (brief DIALOG1): it renders each dialog with
 * exactly that stale-but-truthy + not-live state and asserts NO connected-era fact
 * survives. It documents REALITY, not the brief's claim:
 *   - KavalInfoDialog LEAKS today — the header contract badge and the socket row read
 *     `props.status` RAW, bypassing the `toKavalPresence(status, live)` fold that every
 *     other field goes through. These two assertions are RED at this commit.
 *   - PadiInfoDialog does NOT leak — its connected-era facts already route through
 *     `toPadiPresence`/`connected()` (floored on `live`). Its assertions are GREEN;
 *     they pin Padi as the already-correct reference the fix generalizes from.
 *   - RunningDaemonsSection's not-live copy presumes a benign "connecting" cause and
 *     has NO failed/unreachable arm — over a hard ssh failure it misleads. RED today.
 *
 * Rendered through `solid-js/web`'s `render` into a happy-dom body (the surface pkg's
 * `HostStatusPip.test.tsx` idiom); the dialog content mounts via a `Portal` into
 * `document.body`, so assertions read `document.body.textContent`.
 */

import type { DaemonStatus, PadiIdentity } from "@kolu/padi/surface";
import type { PadiLink } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import KavalInfoDialog from "../kaval/KavalInfoDialog";
import PadiInfoDialog from "../padi/PadiInfoDialog";
import RunningDaemonsSection from "../ui/RunningDaemonsSection";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

/** Mount a node into a fresh container on the happy-dom body; the dialog's own
 *  content Portals into `document.body`. Returns the whole body's text. */
function mountBodyText(node: () => unknown): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  // biome-ignore lint/suspicious/noExplicitAny: render's JSX element type
  const dispose = render(node as any, container);
  disposers.push(dispose, () => container.remove());
  return document.body.textContent ?? "";
}

// ── The stale-but-truthy connected-era facts a dead channel retains ──
const KAVAL_CONTRACT = "5.2";
const KAVAL_SOCKET = "/run/user/1000/kaval/kaval.sock";

/** A kaval `status` frozen at its last CONNECTED read — the exact shape a host's
 *  `daemonStatus` collection retains once the ssh channel dies (it stops updating
 *  but keeps its last value). Truthy in every connected-era field. */
const STALE_KAVAL: DaemonStatus = {
  state: "connected",
  contractVersion: KAVAL_CONTRACT,
  startedAt: 1_700_000_000_000,
  socketPath: KAVAL_SOCKET,
  identity: { staleKey: "zest-kaval", navigableCommit: "7deb397" },
  lifetime: { kind: "forever" },
};

const PADI_CONTRACT = "9.9";
const STALE_PADI_LINK: PadiLink = "connected";
const STALE_PADI_IDENTITY: PadiIdentity = {
  commit: "deadbee",
  surfaceVersion: PADI_CONTRACT,
  startedAt: 1_700_000_000_000,
  lifetime: { kind: "forever" },
};

describe("#1793 dialogs must not leak connected-era facts over a dead channel", () => {
  it("KavalInfoDialog leaks the contract badge + socket while not live (RED)", () => {
    const text = mountBodyText(() => (
      <KavalInfoDialog
        open={true}
        onOpenChange={() => {}}
        status={STALE_KAVAL}
        live={false}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    // Sanity — the dead channel IS honestly reflected in the fields that fold:
    // the status pill reads "unknown", build/lifetime blank to "—".
    expect(text).toContain("unknown");

    // The two leaks (#1793): connected-era facts painted over a dead channel.
    // RED at this commit — both currently render off `props.status` raw.
    expect(text).not.toContain(`contract v${KAVAL_CONTRACT}`);
    expect(text).not.toContain(KAVAL_SOCKET);
  });

  it("PadiInfoDialog does NOT leak its contract badge while not live (GREEN — reference)", () => {
    const text = mountBodyText(() => (
      <PadiInfoDialog
        open={true}
        onOpenChange={() => {}}
        link={STALE_PADI_LINK}
        live={false}
        identity={STALE_PADI_IDENTITY}
        startedAt={1_700_000_000_000}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    // Padi already routes its contract version through `toPadiPresence`/`connected()`,
    // which folds to non-connected when `!live` — so no connected-era fact renders.
    // This passes today; it pins the correct behavior the Kaval fix must reach.
    expect(text).not.toContain(`contract v${PADI_CONTRACT}`);
  });

  it("RunningDaemonsSection's not-live copy presumes 'connecting', has no failed/unreachable arm (RED)", () => {
    // The section receives only a `live` boolean — it cannot tell a booting/connecting
    // channel apart from a hard ssh FAILURE (unreachable, attempt 11). Its not-live
    // copy names only benign transient causes ("padi is connecting, or … too old to
    // report"), so over a dead host it asserts a cause it cannot know. The fix must
    // carry the real cause; today the copy has no honest word for failure.
    const text = mountBodyText(() => (
      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost={null}
        live={false}
        boundHostRows={[]}
        localScanRows={[]}
        renderRow={() => null}
      />
    )).toLowerCase();

    // RED at this commit — the copy contains none of these; it only says "connecting".
    expect(text).toMatch(
      /unreachable|failed|can['’]?t reach|cannot reach|disconnected/,
    );
  });
});
