// @vitest-environment happy-dom
/**
 * #1793 — the Kaval (& Padi) info dialog must not leak CONNECTED-ERA FACTS over a
 * DEAD channel. When a host is unreachable (ssh timed out, "retrying … attempt 11")
 * the daemon status FREEZES at its last-read value — stale-but-truthy — while the
 * channel that would refresh it is gone (`live === false`).
 *
 * This started as the reproduction-first RED test (brief DIALOG1). The FIX makes the
 * dialogs PRESENCE-ONLY: each takes a discriminated `KavalPresence`/`PadiPresence`
 * (folded at the call site on this host's liveness) as its SOLE daemon input — there
 * is no raw `status`/`link`/`identity` at the render site, so a connected-era fact can
 * only be read off the `connected` arm, which the fold yields only over a live link.
 * "render a fact while not live" is now a TYPE error, not a review catch (the type-level
 * pin lives in `daemonPresentation.test-d.ts` / `padiPresentation`).
 *
 * These render tests are the behavioral half: they drive each dialog through the REAL
 * fold (`toKavalPresence(staleStatus, live=false)` → `unknown`) and assert no fact
 * survives — GREEN now, RED before the fix. The RunningDaemonsSection case pins the
 * second defect: a not-live scan names its real cause off the discriminated `DaemonScan`
 * (a hard `failed` host reads its failure, never a guessed "connecting").
 *
 * Rendered through `solid-js/web`'s `render` into a happy-dom body (the surface pkg's
 * `HostStatusPip.test.tsx` idiom); dialog content mounts via a `Portal` into
 * `document.body`, so assertions read `document.body.textContent`.
 */

import type { DaemonStatus, PadiIdentity } from "@kolu/padi/surface";
import type { PadiLink } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { toKavalPresence } from "../kaval/daemonPresentation";
import KavalInfoDialog from "../kaval/KavalInfoDialog";
import { kavalAttention } from "../kaval/kavalCurrency";
import PadiInfoDialog from "../padi/PadiInfoDialog";
import { toPadiPresence } from "../padi/padiPresentation";
import RunningDaemonsSection from "../ui/RunningDaemonsSection";
import { HOST_DOWN_COPY } from "./hostDownCopy";

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
 *  `daemonStatus` collection retains once the ssh channel dies. Truthy in every
 *  connected-era field. */
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
  it("KavalInfoDialog: a stale status folded with live=false leaks NO contract badge or socket", () => {
    // Drive the dialog exactly as the call site does: fold the stale status on a DEAD
    // channel → `unknown`. There is no raw `status` prop to read the facts off of.
    const presence = toKavalPresence(STALE_KAVAL, false);
    const attention = kavalAttention(undefined, STALE_KAVAL, false);
    const text = mountBodyText(() => (
      <KavalInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        attention={attention}
        restartInFlight={false}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    // The dead channel IS honestly reflected: the status pill reads "unknown".
    expect(text).toContain("unknown");
    // …and NO connected-era fact survives (both were RED before the presence-only fix).
    expect(text).not.toContain(`contract v${KAVAL_CONTRACT}`);
    expect(text).not.toContain(KAVAL_SOCKET);
  });

  it("KavalInfoDialog: offers NO 'Restart kaval' AFFORDANCE (nor its promise copy) over a dead channel", () => {
    // The OTHER axis of #1793: the fix made stale FACTS unspellable while not-live, but the
    // Restart *affordance* was still offered on an `unknown` presence — an action a dead
    // channel can't carry out. Affordances are a total function of the presence sum (SK5):
    // an enabled Restart is offered ONLY on a live-confirmed state (connected|down), never
    // on `unknown`. RED before the affordance fix — the button + its copy both rendered.
    const presence = toKavalPresence(STALE_KAVAL, false);
    const attention = kavalAttention(undefined, STALE_KAVAL, false);
    const text = mountBodyText(() => (
      <KavalInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        attention={attention}
        restartInFlight={false}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    // No enabled Restart verb, and no "captures the session" promise, over a dead channel.
    expect(text).not.toContain("Restart kaval");
    expect(text.toLowerCase()).not.toContain("captures the session");
  });

  it("PadiInfoDialog: a stale link+identity folded with live=false leaks NO contract badge", () => {
    const presence = toPadiPresence(
      STALE_PADI_LINK,
      false,
      STALE_PADI_IDENTITY,
    );
    const text = mountBodyText(() => (
      <PadiInfoDialog
        open={true}
        onOpenChange={() => {}}
        presence={presence}
        startedAt={1_700_000_000_000}
        triggerRef={() => undefined}
        hostLabel="zest"
      />
    ));

    expect(text).toContain("unknown");
    expect(text).not.toContain(`contract v${PADI_CONTRACT}`);
  });

  it("RunningDaemonsSection: a FAILED host's copy names the failure, never 'connecting' (the #1793 second defect)", () => {
    // The section now receives a discriminated `DaemonScan`, not a bare boolean, so a
    // hard ssh failure reads its real cause (the matching HOST_DOWN_COPY title) instead
    // of the old guessed "padi is connecting".
    const text = mountBodyText(() => (
      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost={null}
        scan={{ kind: "failed", cause: "cross-supervisor" }}
        boundHostRows={[]}
        localScanRows={[]}
        localScanLive={true}
        renderRow={() => null}
      />
    ));

    expect(text).toContain(HOST_DOWN_COPY["cross-supervisor"].title);
    expect(text.toLowerCase()).not.toContain("is connecting");
  });

  it("RunningDaemonsSection: a not-live LOCAL scan reads 'unavailable', never its retained rows (codex F3)", () => {
    // Under a remote binding the local-machine scan rides the browser↔kolu-server ws, which
    // retains its rows across a transport drop. With localScanLive=false the block must read
    // "unavailable" — never expose the stale socket/PID as current, never a silent zero.
    const STALE_LOCAL_SOCKET = "/run/user/1000/padi-stale/padi.sock";
    const text = mountBodyText(() => (
      <RunningDaemonsSection
        noun="padi"
        testidPrefix="padi"
        boundHost="zest"
        scan={{ kind: "no-frame" }}
        boundHostRows={[]}
        localScanRows={[STALE_LOCAL_SOCKET]}
        localScanLive={false}
        renderRow={(row) => <span>{row}</span>}
      />
    ));

    expect(text.toLowerCase()).toContain("unavailable");
    expect(text).not.toContain(STALE_LOCAL_SOCKET);
  });
});
