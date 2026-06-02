/** IdentityRail — the consolidated "which kolu am I running" chrome readout
 *  (R-4 A2). Replaces the standalone WebSocket dot with a two-column
 *  `srv · pty` rail: `srv` is the server you're connected to (its commit + the
 *  WebSocket liveness dot), `pty` is the pty-host serving your terminals (its
 *  commit + the closure-hash build, sourced from the contract's
 *  `system.version.identity` relayed via `server.info`).
 *
 *  In A2 the pty-host is in-process, so the two columns coincide — an
 *  `≡ in-process` tag links them, and the match is the acceptance signal that
 *  the identity plumbing works end to end. Phase B gives `pty` a separate
 *  surviving process; only then can its column diverge (outdated / dead). Those
 *  branches are intentionally absent here — nothing can diverge from itself —
 *  and land with B's read-site `staleKey !== currentBuildId()` derivation, with
 *  no re-layout.
 *
 *  The rail renders `srv` and `client`: the `pty` column and `≡ in-process`
 *  tag are commented out below (a no-op duplicate of `srv` while the pty-host
 *  is in-process) and a follow-up PR uncomments them once the pty-host lands as
 *  a separate, divergeable process.
 *
 *  The `client` column is the commit this browser's JS was built from
 *  (`__KOLU_COMMIT__`, baked in at build time). Surfacing it next to `srv`
 *  makes a stale client — an old bundle served from browser cache against a
 *  freshly deployed server — visible at a glance: when both refs are clean and
 *  disagree the column flags `≠ srv` (a mismatch; the two hashes prove
 *  difference, not which is newer). */

import { type Component, Show } from "solid-js";
import { serverInfo, type WsStatus } from "../rpc/rpc";
import Commit from "./Commit";
import { clientIsStale } from "./commitRef";
import Tip from "./Tip";

/** WebSocket transport status → the `srv` liveness dot. */
const srvDot: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

// --- pty column (remote-terminals, Phase B) -------------------------------
// The `srv · pty` rail collapses to `srv`-only until the pty-host is a real
// surviving process whose commit can diverge from the server's. The pty
// column, its divider, and the `≡ in-process` coincidence tag — plus the
// helpers they need — are kept here verbatim so a future PR can uncomment.
//
// /** Short-form a build id for display: a nix store hash's leading 7 chars, or
//  *  a path basename capped at 12. The full id lives in the tooltip. */
// function shortId(id: string | null | undefined): string {
//   if (!id) return "—";
//   const hash = /^([a-z0-9]{7})/.exec(id);
//   if (hash) return hash[1] as string;
//   const tail = id.split("/").pop() ?? id;
//   return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
// }
//
// /** pty-host liveness dot in A2: mirrors the WebSocket status but with a
//  *  different "closed" value — grey ("unknown") rather than red, because with
//  *  the link down we can't claim pty state. Phase B replaces "closed" with a
//  *  real daemon-state derivation (connected | outdated | dead). */
// const ptyDot: Record<WsStatus, string> = {
//   open: "bg-ok",
//   connecting: "bg-warning animate-pulse",
//   closed: "bg-fg-3/50", // link down → pty state unknown, not dead
// };
// --------------------------------------------------------------------------

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // srv and pty coincide when connected and the relayed pty commit equals the
  // server's own — the A2 acceptance signal that the plumbing agrees. A plain
  // function (single consumer, per solidjs.md); still reactive inside <Show>.
  // Restore alongside the pty column below.
  // const coincident = () => {
  //   const i = serverInfo();
  //   return (
  //     props.status === "open" &&
  //     !!i?.ptyHost &&
  //     i.commit === i.ptyHost.navigableCommit
  //   );
  // };

  // A genuinely outdated client — old bundle from browser cache against a
  // freshly deployed server. Derivation lives in `commitRef` (unit-tested).
  const stale = () => clientIsStale(serverInfo()?.commit, __KOLU_COMMIT__);

  return (
    <div class="inline-flex items-stretch rounded-lg border border-edge bg-surface-2/60 p-0.5 font-mono text-xs">
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">srv</span>
        <Tip label="Server connection">
          <span
            data-ws-status={props.status}
            class={`inline-block h-[7px] w-[7px] rounded-full ${srvDot[props.status]}`}
          />
        </Tip>
        <Commit sha={serverInfo()?.commit} />
      </span>
      <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">client</span>
        <Tip label="This browser's JS build (baked in at build time)">
          <Commit sha={__KOLU_COMMIT__} />
        </Tip>
        <Show when={stale()}>
          <Tip label="This client build doesn't match the server — reload to pick up the server's version.">
            <span class="self-center rounded-full border border-warning/40 px-1.5 text-[9px] leading-4 text-warning">
              ≠ srv
            </span>
          </Tip>
        </Show>
      </span>
      {/* pty column + `≡ in-process` tag — hidden until the pty-host is a
          separate process (remote-terminals Phase B). Uncomment with the
          helpers and `Show` import above.

      <span class="mx-0.5 h-4 w-px self-center bg-edge-bright/70" />
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5">
        <span class="text-[9px] uppercase tracking-wide text-fg-3">pty</span>
        <Tip label="Terminal host (in-process)">
          <span
            class={`inline-block h-[7px] w-[7px] rounded-full ${ptyDot[props.status]}`}
          />
        </Tip>
        <Commit sha={serverInfo()?.ptyHost?.navigableCommit} />
        <Show when={serverInfo()?.ptyHost?.staleKey}>
          {(key) => (
            <Tip
              label={`build ${key()} — @kolu/pty-host closure hash (staleness key)`}
            >
              <span class="cursor-help border-b border-dotted border-fg-3/50 text-[10px] text-fg-3">
                {shortId(key())}
              </span>
            </Tip>
          )}
        </Show>
      </span>
      <Show when={coincident()}>
        <Tip label="srv and pty are the same process in A2">
          <span class="ml-1 self-center rounded-full border border-accent/40 px-1.5 text-[9px] leading-4 text-accent">
            ≡ in-process
          </span>
        </Tip>
      </Show>
      */}
    </div>
  );
};

export default IdentityRail;
