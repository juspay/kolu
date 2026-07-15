/** The deep-link router — the leaf that turns a `#/…` URL into a view change.
 *
 *  Three entry points feed ONE parser (`parseDeepLink`): the boot parse of
 *  `location.hash`, a live `hashchange`, and — on Chromium PWAs — the
 *  `launchQueue` targetURL of a focus-existing launch. Every route lands on an
 *  EXISTING view action (host switch, tile focus, right panel, settings). The
 *  router adds addressability, never a new capability.
 *
 *  VIEW-ONLY BY LAW (step 6's negative pin): no handler here calls a mutating
 *  client verb — it never creates a terminal, kills one, writes a file, or sends
 *  keys. The URL is a COMMAND CHANNEL into client state, which stays the sole
 *  authority for "current view"; a route is a request the store may REFUSE (a
 *  gone target), not a fact it must mirror.
 *
 *  The cold-boot membership race (step 4b): a bookmark fires before the target
 *  host's terminal list has loaded, so a "gone" verdict at that instant would
 *  toast every bookmark spuriously. We defer the verdict until the active host's
 *  terminal membership SETTLES (`listSub.pending()` false), bounded by a timeout —
 *  the same settle-then-verdict shape `CodeTab`'s `pendingOpen` effect uses for
 *  the file list, applied here to terminal membership. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { type DeepLink, type ParsedDeepLink, parseDeepLink } from "./deepLink";
import { openInCodeTab } from "./right-panel/openInCodeTab";
import { useRightPanel } from "./right-panel/useRightPanel";
import { setSettingsOpen } from "./settings/useSettingsOpen";
import { useSubPanel } from "./terminal/useSubPanel";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { setActiveHost } from "./wire";

/** How long a terminal deep link waits for the target host's membership to
 *  settle before giving up loudly (step 4b) — covers a cold boot where the host
 *  is still connecting when the link fires. */
const MEMBERSHIP_BOUND_MS = 8000;

/** The route families that target a specific terminal (terminal · code ·
 *  inspector) — the ones that must defer until membership settles. */
type TerminalRoute = Extract<DeepLink, { terminalId: TerminalId }>;

type TerminalMeta = NonNullable<
  ReturnType<ReturnType<typeof useTerminalStore>["getMetadata"]>
>;

/** Minimal `launchQueue` typing — Chromium PWA only (absent elsewhere, where the
 *  plain boot parse of the same URL covers the case). */
interface LaunchParams {
  readonly targetURL?: string;
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

export function useDeepLinks(): void {
  const store = useTerminalStore();
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();

  // The one terminal navigation the settle effect is watching (null = idle).
  const [pending, setPending] = createSignal<TerminalRoute | null>(null);

  /** Enact a terminal route once its target is known to exist. View-only:
   *  activate the tile, walk the split chain for a sub-terminal, open the
   *  requested right-panel tab. Calls NO mutating verb.
   *
   *  `repoRoot` carries the git repo root the settle gate has already PROVEN
   *  present for a `code` route (null for the terminal/inspector kinds, which
   *  never read it). It is passed in — not re-read from `meta.git` here — so the
   *  old "code route but no repoRoot" path is gone by construction rather than
   *  diverted into a silent `return`. */
  function enact(
    route: TerminalRoute,
    meta: TerminalMeta,
    repoRoot: string | null,
  ): void {
    const id = route.terminalId;
    const parentId = meta.parentId ?? null;
    if (parentId) {
      // A sub-terminal (split): the FULL chain — parent tile active, sub
      // selected, focus into the sub pane (the `useAdoptNewSplit` precedent).
      store.activate(parentId);
      subPanel.expandPanel(parentId);
      subPanel.setActiveSubTab(parentId, id);
    } else {
      store.activate(id);
    }
    match(route)
      .with({ kind: "terminal" }, () => {})
      .with({ kind: "inspector" }, () => rightPanel.showInspector())
      .with({ kind: "code" }, (r) => {
        // The settle effect only calls enact for a `code` route once
        // `git.repoRoot` is sensed, and hands it in here — a null is an
        // internal invariant break (crash loudly), never a reachable
        // "no repo" case (that path toasts from the backstop below).
        if (repoRoot === null)
          throw new Error(
            "deep-link: code route enacted without a sensed repoRoot",
          );
        openInCodeTab({
          ref: { path: r.path, startLine: r.line, endLine: r.line },
          repoRoot,
          cwd: meta.cwd,
          targetMode: "browse",
          // A deep-link path is explicit (GitHub-style exact), never a bare
          // terminal-printed basename — resolve it exactly or fail loud.
          allowBasenameFallback: false,
        });
      })
      .exhaustive();
  }

  /** Switch to the link's host first (switch-then-focus — the id must route
   *  against ITS host, never whatever padi is active), then defer to the settle
   *  effect. */
  function routeToTerminal(route: TerminalRoute): void {
    setActiveHost(decodeHostKey(route.host));
    setPending(route);
  }

  /** Route a parsed link. Host/settings act immediately; a terminal target
   *  defers. `none` is silent (no route present); `invalid` toasts + stays home
   *  (never silently ignores a new link shape). */
  function navigate(link: ParsedDeepLink): void {
    match(link)
      .with({ kind: "none" }, () => {})
      .with({ kind: "invalid" }, ({ reason }) =>
        toast.error(`That link doesn't point anywhere kolu knows: ${reason}`),
      )
      .with({ kind: "settings" }, () => setSettingsOpen(true))
      .with({ kind: "host" }, ({ host }) => setActiveHost(decodeHostKey(host)))
      .with({ kind: "terminal" }, (l) => routeToTerminal(l))
      .with({ kind: "code" }, (l) => routeToTerminal(l))
      .with({ kind: "inspector" }, (l) => routeToTerminal(l))
      .exhaustive();
  }

  // The settle-then-verdict effect (CodeTab's `pendingOpen` precedent, over
  // terminal membership). Waits for the active host's list to settle, then
  // enacts or toasts "gone" — a bookmark never toasts mid-cold-boot because the
  // list is still `pending`.
  createEffect(() => {
    const route = pending();
    if (!route) return;
    if (store.listSub.pending()) return; // membership not settled — wait
    const id = route.terminalId;
    const inList = (store.listSub() ?? []).some((t) => t.id === id);
    if (!inList) {
      setPending(null);
      toast.error(
        "That terminal is no longer here — it was closed or never existed. Staying on its host.",
      );
      return;
    }
    const meta = store.getMetadata(id);
    if (!meta) return; // in the list but its record hasn't composed yet — wait
    // A `/code` route needs the terminal's repo root — a THIRD async fact (the
    // git sensor) that settles INDEPENDENTLY of membership, and `git` is `null`
    // both for "no repo" and "not sensed yet". Wait for it too (the 8s backstop
    // still bounds the wait), so a real-repo terminal whose git hasn't sensed
    // yet — a fresh terminal, or the cold-boot window before the watcher
    // re-resolves — doesn't get a false "not a git repository". The effect
    // re-runs when the git fact lands (getMetadata is reactive).
    //
    // LEDGER (deferred): this `null` conflates "git not sensed yet" with
    // "terminal has no repo" because `git` is `GitInfoSchema.nullable()` in
    // terminal-vocab/src/schema.ts — the ONE snapshot field that doesn't model
    // its async resolution as a discriminated union the way its siblings `pr`
    // (PrResultSchema) and `agent` do. The ideal fix aligns git's schema shape
    // with them — `{ kind: "sensing" } | { kind: "none" } | { kind: "repo";
    // info }` — so the code route enacts only on the `repo` arm and toasts
    // immediately on `none`. That is a cross-package + wire migration; deferred.
    // Until then the backstop below hedges the no-repo case with a
    // git-specific message instead of the host-unreachable one.
    if (route.kind === "code" && !meta.git?.repoRoot) return;
    setPending(null);
    enact(route, meta, meta.git?.repoRoot ?? null);
  });

  // Bounded backstop: if the wait never resolves, give up loudly rather than
  // wait forever. Two DIFFERENT reasons land here, and the message must tell
  // them apart: (1) membership never settled — host unreachable / stuck warming
  // — the plain "couldn't reach the host" case; (2) a `code` route whose host
  // WAS reached and whose terminal exists, but whose `git` never resolved to a
  // repo root — because `git: null` is both "not sensed yet" and "no repo"
  // (see the settle-effect ledger), we can't prove which, so hedge with a
  // git-specific message rather than falsely blame the host. The git wording is
  // gated on `route.kind === "code"` so a terminal/inspector route that timed
  // out via the membership path never masquerades as a "no git repo".
  createEffect(() => {
    const route = pending();
    if (!route) return;
    const timer = setTimeout(() => {
      if (pending() !== route) return;
      setPending(null);
      const meta = store.getMetadata(route.terminalId);
      if (route.kind === "code" && meta && !meta.git?.repoRoot) {
        toast.error(
          "Couldn't open that file — that terminal doesn't appear to be in a git repository.",
        );
      } else {
        toast.error("Couldn't reach the host for that link in time.");
      }
    }, MEMBERSHIP_BOUND_MS);
    onCleanup(() => clearTimeout(timer));
  });

  onMount(() => {
    // (a) boot parse — a bookmark opened cold.
    navigate(parseDeepLink(window.location.hash));
    // (c) PWA launch (Chromium): a focus-existing launch hands the URL here,
    // WITHOUT navigating the already-open window. Reflect its hash into the
    // address bar (durability — a later reload re-navigates), letting the
    // `hashchange` listener act; navigate directly only when the hash is
    // identical/empty (no event would fire).
    const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    lq?.setConsumer((params) => {
      if (!params.targetURL) return;
      let hash: string;
      try {
        hash = new URL(params.targetURL).hash;
      } catch {
        return; // a malformed targetURL is not a route.
      }
      if (hash && hash !== window.location.hash) {
        window.location.hash = hash;
        return;
      }
      navigate(parseDeepLink(hash));
    });
  });

  // (b) live in-app navigation — a `#/…` link clicked while kolu is open. The
  // hash is left in place after a handled route (durability); we never strip it.
  makeEventListener(window, "hashchange", () =>
    navigate(parseDeepLink(window.location.hash)),
  );
}
