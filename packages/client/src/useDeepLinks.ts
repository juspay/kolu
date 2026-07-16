/** The deep-link router — the leaf that turns a `#/…` URL into a view change.
 *
 *  Four entry points feed ONE parser (`parseDeepLink`): the boot parse of
 *  `location.hash`, a live `hashchange`, — on Chromium PWAs — the
 *  `launchQueue` targetURL of a focus-existing launch, and the Code-tab
 *  preview bridge (`requestDeepLinkNavigation`). Every route lands on an
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
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  batch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { type DeepLink, type ParsedDeepLink, parseDeepLink } from "./deepLink";
import { setDeepLinkFocusIntent } from "./deepLinkFocusIntent";
import { openInCodeTab } from "./right-panel/openInCodeTab";
import { useRightPanel } from "./right-panel/useRightPanel";
import { openSettings } from "./settings/useSettingsOpen";
import { useSubPanel } from "./terminal/useSubPanel";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { activeHost, setActiveHost } from "./wire";

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

/** A `#/…` hash handed in from OUTSIDE the URL — today the Code-tab preview
 *  bridge (a deep link clicked inside the sandboxed iframe, which can't
 *  navigate the parent itself). `equals: false` so re-requesting the SAME hash
 *  re-routes (clicking the same dashboard pill twice must refocus both times —
 *  a plain `location.hash =` write would not re-fire `hashchange`). The hook's
 *  consumer feeds it through the exact pipeline a typed URL takes (reflect into
 *  the address bar when it differs — durability — else parse+navigate
 *  directly), so an invalid hash toasts identically. */
const [externalNavRequest, setExternalNavRequest] = createSignal<string | null>(
  null,
  { equals: false },
);

/** Request a deep-link navigation from outside the URL (the preview bridge). */
export function requestDeepLinkNavigation(hash: string): void {
  setExternalNavRequest(hash);
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
   *  `anchorMeta` is the metadata of the tile that OWNS the right panel — the
   *  parent tile for a sub-terminal, else the target itself. The right panel is
   *  per-TILE (`useRightPanel` keys off the active tile), so a `code`/`inspector`
   *  route on a split addresses the parent tile's panel, and `code` resolves its
   *  path against THAT tile's repo (`anchorMeta.git.repoRoot`, which the settle
   *  gate has already proven present) — never the split's, which the panel can't
   *  represent. A null repoRoot at a `code` enact is an internal invariant break
   *  (crash loudly), not a reachable "no repo" path (that toasts from the
   *  backstop). */
  function enact(
    route: TerminalRoute,
    meta: TerminalMeta,
    anchorMeta: TerminalMeta,
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
      .with({ kind: "inspector" }, () => {
        // `showInspector` only selects the tab — `reveal` is the separate
        // visibility action, so a collapsed desktop panel / closed touch drawer
        // needs both to actually surface the Inspector.
        rightPanel.showInspector();
        rightPanel.reveal();
      })
      .with({ kind: "code" }, (r) => {
        const repoRoot = anchorMeta.git?.repoRoot;
        if (!repoRoot)
          throw new Error(
            "deep-link: code route enacted without a sensed repoRoot",
          );
        openInCodeTab({
          ref: { path: r.path, startLine: r.line, endLine: r.line },
          repoRoot,
          cwd: anchorMeta.cwd,
          targetMode: "browse",
          // A deep-link path is explicit (GitHub-style exact), never a bare
          // terminal-printed basename — resolve it exactly or fail loud.
          allowBasenameFallback: false,
        });
      })
      .exhaustive();
  }

  /** Switch to the link's host first (switch-then-focus — the id must route
   *  against ITS host, never whatever padi is active), then arm the settle
   *  effect — ATOMICALLY, so the effect never runs against a half-updated
   *  (new pending, old host) state. Also record the target as the deep-link
   *  focus intent, so a COLD-BOOT session restore picks it as the active tile
   *  instead of racing the settle effect for the `activeId` write (see
   *  `deepLinkFocusIntent`). */
  function routeToTerminal(route: TerminalRoute): void {
    setActiveHost(decodeHostKey(route.host));
    setDeepLinkFocusIntent(route.terminalId);
    setPending(route);
  }

  /** Route a parsed link. Host/settings act immediately; a terminal target
   *  defers. `none` is silent (no route present); `invalid` toasts + stays home
   *  (never silently ignores a new link shape).
   *
   *  Batched, and clears any still-armed terminal route FIRST: a newer
   *  navigation always supersedes an older pending one, so a stale route can't
   *  enact or toast after the user has moved on (a later host/settings switch,
   *  or a second link). */
  function navigate(link: ParsedDeepLink): void {
    batch(() => {
      setPending(null);
      match(link)
        .with({ kind: "none" }, () => {})
        .with({ kind: "invalid" }, ({ reason }) =>
          toast.error(`That link doesn't point anywhere kolu knows: ${reason}`),
        )
        .with({ kind: "settings" }, () => openSettings())
        .with({ kind: "host" }, ({ host }) =>
          setActiveHost(decodeHostKey(host)),
        )
        // terminal · code · inspector all target a terminal — one handler.
        .with(
          { kind: "terminal" },
          { kind: "code" },
          { kind: "inspector" },
          (l) => routeToTerminal(l),
        )
        .exhaustive();
    });
  }

  /** Resolve a route's target record AND the tile that OWNS its right panel —
   *  the parent tile for a sub-terminal, else the target itself. `null` until
   *  both records have composed. The ONE definition of the anchor relationship,
   *  so the settle effect, the backstop, and enact can't spell it three
   *  different ways. */
  function resolveRoute(
    route: TerminalRoute,
  ): { meta: TerminalMeta; anchorMeta: TerminalMeta } | null {
    const meta = store.getMetadata(route.terminalId);
    if (!meta) return null;
    const anchorId = meta.parentId ?? route.terminalId;
    const anchorMeta =
      anchorId === route.terminalId ? meta : store.getMetadata(anchorId);
    if (!anchorMeta) return null;
    return { meta, anchorMeta };
  }

  /** A `code` route still waiting on (or lacking) its owning tile's repo root —
   *  the git sensor is a THIRD async fact, settled INDEPENDENTLY of membership,
   *  and `git` is `null` both for "no repo" and "not sensed yet". The one place
   *  this hedge is spelled (see the LEDGER note below), read by both the settle
   *  gate (wait) and the backstop (message). */
  function codeRouteAwaitingRepo(
    route: TerminalRoute,
    anchorMeta: TerminalMeta,
  ): boolean {
    return route.kind === "code" && !anchorMeta.git?.repoRoot;
  }

  // The settle-then-verdict effect (CodeTab's `pendingOpen` precedent, over
  // terminal membership). Waits for the active host's list to settle, then
  // enacts or toasts "gone" — a bookmark never toasts mid-cold-boot because the
  // list is still `pending`.
  //
  // LEDGER (deferred): `codeRouteAwaitingRepo`'s `git == null` conflates "git
  // not sensed yet" with "terminal has no repo" because `git` is
  // `GitInfoSchema.nullable()` in terminal-vocab/src/schema.ts — the ONE
  // snapshot field that doesn't model its async resolution as a discriminated
  // union the way its siblings `pr` (PrResultSchema) and `agent` do. The ideal
  // fix aligns git's schema shape with them — `{ kind: "sensing" } | { kind:
  // "none" } | { kind: "repo"; info }` — so a code route enacts only on the
  // `repo` arm and toasts immediately on `none`. That is a cross-package + wire
  // migration; deferred. Until then the backstop hedges the no-repo case with a
  // git-specific message instead of the host-unreachable one.
  createEffect(() => {
    const route = pending();
    if (!route) return;
    // Only act while the ACTIVE host IS the route's host. `setActiveHost`
    // re-windows the list sub, so a mismatch means either the switch hasn't
    // landed (never happens — `routeToTerminal` batches host+pending) or the
    // user has since navigated AWAY (a manual host-chip switch). Treat a
    // mismatch as SUPERSESSION: clear the route so it can't enact if the user
    // switches back, and — because the 8s backstop tracks `pending` — clearing
    // it disposes that timer too, so no stale toast fires in the new host's view.
    if (encodeHostKey(activeHost()) !== route.host) {
      setPending(null);
      return;
    }
    if (store.listSub.pending()) return; // membership not settled — wait
    const listError = store.listSub.error();
    if (listError) {
      // The list stream faulted — `pending()` is false but the value is stale
      // or absent, so we can't honestly say "gone". Fail the link loudly rather
      // than invent a gone-verdict from a broken subscription — and surface the
      // real error, not a generic message.
      setPending(null);
      toast.error(
        `Couldn't load this host's terminals to resolve the link: ${listError.message}`,
      );
      return;
    }
    const id = route.terminalId;
    const inList = (store.listSub() ?? []).some((t) => t.id === id);
    if (!inList) {
      setPending(null);
      // Name what the link pointed at (the host) — the host-gone path already
      // names its host via wire.ts's reconcile toast, so the two agree.
      toast.error(
        `That terminal is no longer on "${route.host}" — it was closed or never existed. Staying on that host.`,
      );
      return;
    }
    const resolved = resolveRoute(route);
    if (!resolved) return; // a record hasn't composed yet — wait
    // `code` waits on its owning tile's repo root (a fresh terminal / cold-boot
    // window before the git watcher resolves) rather than toasting a false
    // "not a git repository"; the effect re-runs when the git fact lands
    // (getMetadata is reactive), bounded by the 8s backstop.
    if (codeRouteAwaitingRepo(route, resolved.anchorMeta)) return;
    setPending(null);
    enact(route, resolved.meta, resolved.anchorMeta);
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
      // Same anchor + repo-readiness facts the settle gate reads, so the
      // message can't drift from the gate's own verdict.
      const resolved = resolveRoute(route);
      if (resolved && codeRouteAwaitingRepo(route, resolved.anchorMeta)) {
        toast.error(
          "Couldn't open that file — that terminal doesn't appear to be in a git repository.",
        );
      } else {
        toast.error("Couldn't reach the host for that link in time.");
      }
    }, MEMBERSHIP_BOUND_MS);
    onCleanup(() => clearTimeout(timer));
  });

  /** Route a hash delivered from OUTSIDE the address bar (a PWA launch, the
   *  preview bridge): reflect it into the bar when it differs — durability, and
   *  the `hashchange` listener does the rest — else parse+navigate directly (an
   *  identical hash fires no event, and a repeated request must still
   *  re-route). */
  function navigateFromExternal(hash: string): void {
    if (hash && hash !== window.location.hash) {
      window.location.hash = hash;
      return;
    }
    navigate(parseDeepLink(hash));
  }

  // (d) the preview bridge — a kolu deep link clicked inside the Code-tab
  // preview iframe (see `requestDeepLinkNavigation`). The sandbox can't
  // navigate the parent, so the bridge posts the hash here; it takes the same
  // external pipeline as a PWA launch, so an invalid hash toasts exactly as a
  // typed URL would.
  createEffect(() => {
    const hash = externalNavRequest();
    if (hash === null) return;
    navigateFromExternal(hash);
  });

  onMount(() => {
    // (c) PWA launch (Chromium): a focus-existing launch hands the URL here,
    // WITHOUT navigating an already-open window. Reflect its hash into the
    // address bar (durability — a later reload re-navigates), letting the
    // `hashchange` listener act; navigate directly only when the hash is
    // identical/empty (no event would fire).
    //
    // Registered BEFORE the boot parse: on a COLD installed launch the browser
    // both loads the target URL (so `location.hash` is set) AND queues the same
    // LaunchParams, which `setConsumer` drains synchronously here — so running
    // the boot parse unconditionally would route the same hash TWICE (a double
    // toast on an invalid link). `launchHandled` records that the queued launch
    // already covered the initial navigation, so the boot parse runs only when
    // it didn't (a normal load, or a browser without `launchQueue`).
    let launchHandled = false;
    const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    lq?.setConsumer((params) => {
      launchHandled = true;
      if (!params.targetURL) return;
      let hash: string;
      try {
        hash = new URL(params.targetURL).hash;
      } catch {
        // A malformed launch URL is a real anomaly, not a no-op — surface it
        // loudly like every other failure path here, rather than dropping the
        // launch with no user-visible trace.
        toast.error("Couldn't open that link — the launch URL was malformed.");
        return;
      }
      navigateFromExternal(hash);
    });
    // (a) boot parse — a bookmark opened cold (skipped if the launch consumer
    // already handled this load's initial launch).
    if (!launchHandled) navigate(parseDeepLink(window.location.hash));
  });

  // (b) live in-app navigation — a `#/…` link clicked while kolu is open. The
  // hash is left in place after a handled route (durability); we never strip it.
  makeEventListener(window, "hashchange", () =>
    navigate(parseDeepLink(window.location.hash)),
  );
}
