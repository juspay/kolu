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
 *  no re-layout. */

import { type Component, createMemo, Show } from "solid-js";
import { serverInfo, type WsStatus } from "../rpc/rpc";
import Tip from "./Tip";

const REPO_URL = "https://github.com/juspay/kolu";

/** WebSocket transport status → the `srv` liveness dot. */
const srvDot: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

/** Short-form a build id for display: a nix store hash's leading 7 chars, or a
 *  path basename capped at 12. The full id lives in the tooltip. */
function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  const hash = /^([a-z0-9]{7})/.exec(id);
  if (hash) return hash[1] as string;
  const tail = id.split("/").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

/** A commit cell: a GitHub link when the ref is a clean, navigable short SHA;
 *  plain text for a dirty / dev / absent ref (no broken `/commit/` link). */
const Commit: Component<{ sha: string | undefined }> = (props) => {
  const linkable = () => {
    const c = props.sha;
    return !!c && c !== "dev" && !c.includes("-dirty");
  };
  return (
    <Show
      when={linkable()}
      fallback={<span class="text-fg-2">{props.sha || "—"}</span>}
    >
      <a
        href={`${REPO_URL}/commit/${props.sha}`}
        target="_blank"
        rel="noopener noreferrer"
        class="text-fg-2 underline decoration-dotted underline-offset-2 hover:text-fg"
      >
        {props.sha}
      </a>
    </Show>
  );
};

const IdentityRail: Component<{ status: WsStatus }> = (props) => {
  // pty liveness in A2 mirrors the WebSocket link: the pty-host is in-process,
  // so it's alive iff the server is reachable. With the link down we can't know
  // the pty state, so the dot reads "unknown" (grey) rather than a false green.
  // Phase B derives connected | outdated | dead from the build comparison.
  const ptyDot = () =>
    props.status === "open"
      ? "bg-ok"
      : props.status === "connecting"
        ? "bg-warning animate-pulse"
        : "bg-fg-3/50";

  // srv and pty coincide when connected and the relayed pty commit equals the
  // server's own — the A2 acceptance signal that the plumbing agrees.
  const coincident = createMemo(() => {
    const i = serverInfo();
    return (
      props.status === "open" &&
      !!i?.ptyHost &&
      i.commit === i.ptyHost.navigableCommit
    );
  });

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
        <span class="text-[9px] uppercase tracking-wide text-fg-3">pty</span>
        <Tip label="Terminal host (in-process)">
          <span
            class={`inline-block h-[7px] w-[7px] rounded-full ${ptyDot()}`}
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
    </div>
  );
};

export default IdentityRail;
