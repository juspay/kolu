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

/** The consumed-once stamp — `navigate` marks the CURRENT history entry's
 *  command handled; the traversal gate reads it. Writer and reader are spelled
 *  here once, both against the one constant, so a key rename can't silently
 *  desync them (the reader going always-false would resurrect the traversal
 *  re-route this gate exists to close). */
const ROUTED_STAMP = { koluRouted: true } as const;
function stampEntryRouted(): void {
  history.replaceState(ROUTED_STAMP, "");
}
function entryAlreadyRouted(): boolean {
  const state = history.state as Partial<typeof ROUTED_STAMP> | null;
  return state?.koluRouted === true;
}

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
 *  re-routes (clicking the same dashboard pill twice must refocus both times).
 *  The hook consumes it through `navigateFromExternal` — the same pipeline as
 *  a PWA launch — so an invalid hash toasts exactly as a typed URL would. The
 *  setter IS the public request API (`requestDeepLinkNavigation`) — the house
 *  convention for module-singleton seams (`setActiveHost` is likewise a raw
 *  exported setter), so there is no single-caller wrapper to drift. */
const [externalNavRequest, requestDeepLinkNavigation] = createSignal<
  string | null
>(null, { equals: false });

export { requestDeepLinkNavigation };

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

  /** Disarm an IN-FLIGHT terminal route: the armed command AND its hydration
   *  focus intent — `routeToTerminal` arms them together, so any non-enacted
   *  termination must disarm them together, or the stale intent teleports
   *  later through cold-boot hydration (`useSessionRestore` prefers it when it
   *  seeds). Two termination families land here: SUPERSESSION (a newer
   *  command, a history traversal, a manual host switch — the user moved on)
   *  and a FAULT VERDICT (list-stream error, terminal gone, backstop timeout —
   *  the router gave up and toasted; a command declared failed must not be
   *  half-honored by a later hydration). An already-ENACTED intent
   *  deliberately survives (`pending` is null then): hydration must keep
   *  preferring the view the user actually reached. Clearing `pending` also
   *  disposes the 8s backstop timer via its effect's onCleanup. */
  function disarmInFlightRoute(): void {
    if (pending() === null) return;
    // Batched HERE so the disarm-together contract holds structurally from
    // every call site (navigate's batch, the traversal gate, the settle
    // effect's arms, the backstop), not just the batched ones.
    batch(() => {
      setPending(null);
      setDeepLinkFocusIntent(null);
    });
  }

  /** Route a parsed link. Host/settings act immediately; a terminal target
   *  defers. `none` is silent (no route present); `invalid` toasts + stays home
   *  (never silently ignores a new link shape).
   *
   *  Batched, and supersedes any still-armed terminal route FIRST: a newer
   *  navigation always supersedes an older in-flight one, so a stale route
   *  can't enact, toast, or steer hydration after the user has moved on (a
   *  later host/settings switch, or a second link). */
  function navigate(link: ParsedDeepLink): void {
    batch(() => {
      disarmInFlightRoute();
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
    // COMMANDS ARE CONSUMED ONCE PER HISTORY ENTRY: mark this entry's command
    // handled, so a later back/forward traversal RESTORING it does not
    // re-route (the `hashchange` gate below) — mouse-back must revert the URL
    // silently, never teleport the view to an old link (DL3). Uniform for
    // every verdict incl. `invalid` (traversing onto a bad-link entry must not
    // re-toast) and `none` (harmless). A same-URL `replaceState` — the hash
    // stays in the bar (durability), no entry is added, and a RELOAD still
    // re-routes because the boot parse never reads this gate.
    stampEntryRouted();
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
    // user has since navigated AWAY (a manual host-chip switch). That is a
    // SUPERSESSION — disarm the command AND its hydration intent via the one
    // named spelling, so neither the enact, the backstop toast, nor a later
    // hydration can act on a route the user walked away from.
    if (encodeHostKey(activeHost()) !== route.host) {
      disarmInFlightRoute();
      return;
    }
    if (store.listSub.pending()) return; // membership not settled — wait
    const listError = store.listSub.error();
    if (listError) {
      // The list stream faulted — `pending()` is false but the value is stale
      // or absent, so we can't honestly say "gone". Fail the link loudly rather
      // than invent a gone-verdict from a broken subscription — and surface the
      // real error, not a generic message. A FAULT VERDICT disarms the pair:
      // a command declared failed must not steer a later hydration.
      disarmInFlightRoute();
      toast.error(
        `Couldn't load this host's terminals to resolve the link: ${listError.message}`,
      );
      return;
    }
    const id = route.terminalId;
    const inList = (store.listSub() ?? []).some((t) => t.id === id);
    if (!inList) {
      disarmInFlightRoute(); // fault verdict — disarm command + intent together
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
    // Bare on purpose — the ONLY non-disarming clear: an ENACTED route's
    // intent survives so cold-boot hydration keeps the reached view.
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
      disarmInFlightRoute(); // fault verdict — disarm command + intent together
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
   *  preview bridge). Reflect it into the bar with `replaceState` — the hash
   *  stays durable (copyable; reload re-navigates) but NO history entry is
   *  pushed, so mouse-back never replays a stale teleport: deep-link routing
   *  must not record history that ordinary in-app navigation doesn't (a
   *  `location.hash =` write would push one per routed link). `replaceState`
   *  fires no `hashchange`, so route explicitly — always, which also keeps a
   *  repeated same-hash request re-routing. */
  function navigateFromExternal(hash: string): void {
    if (hash && hash !== window.location.hash) {
      history.replaceState(null, "", hash);
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
    // WITHOUT navigating an already-open window. `navigateFromExternal`
    // reflects the hash into the address bar (durability — a later reload
    // re-navigates) without pushing a history entry, and routes directly.
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
  //
  // THE TRAVERSAL GATE (DL3): `hashchange` also fires when the browser RESTORES
  // an old hash during a back/forward traversal — and routing that replay is
  // the "mouse-back teleports to a previous link's terminal" bug (reproduced on
  // the deployed build: every hash-bearing entry was a live teleport). A
  // traversal lands on an entry whose command `navigate` already consumed — its
  // state carries `koluRouted` — so skip it: the URL reverts silently and the
  // view stays put. A FRESH navigation (a typed hash, an in-page `#/…` anchor,
  // a script push) creates a NEW entry with null state and routes exactly as
  // before. Entries from before this fix self-heal: their first traversal
  // routes once (unstamped) and `navigate` stamps them.
  makeEventListener(window, "hashchange", () => {
    if (entryAlreadyRouted()) {
      // A traversal is the user MOVING ON — disarm any in-flight route,
      // exactly as `navigate` does for every fresh command (the helper's doc
      // carries the delayed-teleport mechanics this closes).
      disarmInFlightRoute();
      return;
    }
    navigate(parseDeepLink(window.location.hash));
  });
}
