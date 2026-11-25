/** The deep-link router — the leaf that turns a `#/…` URL into a view change.
 *
 *  Four entry points feed ONE parser (`parseDeepLink`): the boot parse of
 *  `location.hash`, a live `hashchange`, — on Chromium PWAs — the
 *  `launchQueue` targetURL of a focus-existing launch, and the Code-tab
 *  preview bridge (`requestDeepLinkNavigation`). Every route lands on an
 *  EXISTING view action (host switch, tile focus, right panel, settings, a
 *  work's card in the Conductor — `showWork`, the one route to a work). The
 *  router adds addressability, never a new capability.
 *
 *  VIEW-ONLY BY LAW (step 6's negative pin): no handler here calls a mutating
 *  client verb — it never creates a terminal, kills one, writes a file, or sends
 *  keys. The URL is a COMMAND CHANNEL into client state, which stays the sole
 *  authority for "current view"; a route is a request the store may REFUSE (a
 *  gone target), not a fact it must mirror.
 *
 *  The cold-boot membership race (step 4b): a bookmark fires before the target
 *  host's terminal list has converged, so a "gone" verdict at that instant would
 *  toast every bookmark spuriously. We defer the verdict until the active host's
 *  terminal membership both SETTLES (`listSub.pending()` false) and is a COMPLETE
 *  census (`listIsAuthoritative()` — the route host's kaval reconciled, not merely
 *  a first frame; #1900), bounded by a timeout — the same settle-then-verdict shape
 *  `CodeTab`'s `pendingOpen` effect uses for the file list, applied here to
 *  terminal membership. A RELOAD does not re-run this at all: the boot parse honors
 *  the consumed-command stamp (like DL3's traversal gate), so session restore —
 *  not a boot re-enact — restores the reached view across refreshes. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { WorkId } from "kolu-work";
import { createEffect, createSignal, onSettled } from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { showWork } from "./conductor/workListing";
import { useWorkMap } from "./conductor/useWorks";
import { type DeepLink, type ParsedDeepLink, parseDeepLink } from "./deepLink";
import { setDeepLinkFocusIntent } from "./deepLinkFocusIntent";
import { selectHostTab } from "./host/selectHostTab";
import { listIsAuthoritative } from "./kaval/useDaemonStatus";
import { openInCodeTab } from "./right-panel/openInCodeTab";
import { useRightPanel } from "./right-panel/useRightPanel";
import { openSettings } from "./settings/useSettingsOpen";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { activeHost } from "./wire";

/** How long a deep link waits for what it names to arrive before giving up
 *  loudly (step 4b) — a terminal's host settling its membership, a work
 *  reaching the works mirror — which covers a cold boot where the host is
 *  still connecting when the link fires. A picked work kept across a reload
 *  waits for its work by the same bound (`conductor/WorkColumn.tsx`). */
export const MEMBERSHIP_BOUND_MS = 8000;

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

/** The target terminal's facts a settle verdict carries into the effect phase:
 *  PLAIN VALUES read in the compute phase, never the live metadata record —
 *  reads in the effect phase are untracked, so a record handed across the
 *  boundary would be a snapshot the effect could not re-subscribe to. */
type TargetFacts = {
  readonly gitKind: TerminalMeta["git"]["kind"];
  readonly cwd: TerminalMeta["cwd"];
};

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
  const rightPanel = useRightPanel();

  // The ARM the settle gate and the 8s backstop watch: the terminal route this
  // router was last pointed at. Only ever SET (`routeToTerminal`) — a verdict
  // records itself in `armedRoute` below instead of clearing this, because the
  // gate's own compute reads it and an effect that writes a source it reads
  // re-runs on its own write, settling twice for one verdict. A stale value
  // only re-triggers a compute that answers `wait`.
  const [routeArm, armRoute] = createSignal<TerminalRoute | null>(null);
  // WHETHER THAT ARM IS STILL IN FLIGHT, as a plain variable: the authority for
  // the imperative guards that run in the turn a write is made (a command's
  // supersession check, the backstop's "is this still my route?") — a setter's
  // value only lands on the next microtask, so a signal would answer about the
  // previous state there — AND for the gate's own compute, which must see a
  // resolution without this router writing what it reads. Null = idle. Written
  // by `routeToTerminal`, `disarmInFlightRoute` and the settle gate's enact arm.
  let armedRoute: TerminalRoute | null = null;

  /** A LINK TO A WORK, until the works mirror has it. A work id that reads as
   *  a work key may still name nothing here — it finished and was let go, or
   *  it was never on this kolu — and a link that silently lands on nothing is
   *  the defect a terminal link's "gone" toast exists to prevent. The works
   *  arrive one record at a time, so absence is a verdict only after the same
   *  bound a terminal route waits for its host.
   *
   *  The link carries a SEQUENCE, and the two effects below record the link
   *  they ANSWERED in a plain variable rather than clearing the signal. An
   *  effect that cleared the signal its own compute reads would re-run on its
   *  own write — two flushes for one verdict — which is exactly what the
   *  `armedRoute` mirror above avoids for a terminal route. A re-click is a new
   *  sequence, so the same work can be linked twice. */
  type WorkLink = { work: WorkId; seq: number };
  let workLinkSeq = 0;
  const [workLink, setWorkLink] = createSignal<WorkLink | null>(null);
  /** The newest work link already answered — it arrived, or its bound expired. */
  let answeredWorkSeq = 0;
  function routeToWork(work: WorkId): void {
    setWorkLink({ work, seq: ++workLinkSeq });
  }
  const workMap = useWorkMap();
  // The link LANDED: its work reached the mirror, so the bound below has
  // nothing left to answer.
  createEffect(
    () => {
      const link = workLink();
      return link !== null &&
        link.seq > answeredWorkSeq &&
        workMap().has(link.work)
        ? link.seq
        : 0;
    },
    (arrived) => {
      if (arrived > 0) answeredWorkSeq = arrived;
    },
  );
  createEffect(
    () => {
      const link = workLink();
      return link !== null && link.seq > answeredWorkSeq ? link : null;
    },
    (link) => {
      if (link === null) return;
      // Started once per link, not again with every record that arrives: this
      // compute answers the LINK, which does not change while it waits.
      const timer = setTimeout(() => {
        // The work may have landed since — the arrival above marks the link
        // answered without disturbing this one's source, so check at expiry
        // (the terminal backstop's `armedRoute !== route` guard, same reason).
        if (link.seq <= answeredWorkSeq) return;
        answeredWorkSeq = link.seq;
        toast.error(
          "That piece of work isn't in kolu — it may have finished and been let go.",
        );
      }, MEMBERSHIP_BOUND_MS);
      return () => clearTimeout(timer);
    },
  );

  /** Enact a terminal route once its target is known to exist. View-only:
   *  focus the terminal through the shared landing verb, then open the requested
   *  right-panel tab. Calls NO mutating verb.
   *
   *  `target` carries the TARGET terminal's own facts — a split addresses its OWN
   *  panel content and resolves its path against its OWN repo: a `code` route on
   *  a split opens the split's panel showing the split's repo. Every panel verb
   *  is NAMED with the route's terminal rather than left to read the focused
   *  pane, because the focus written a line earlier is only visible on the next
   *  flush. (Revealing stays a tile-wide act — `reveal` uncollapses the named
   *  pane's tile panel / opens the drawer.) A null repoRoot at a `code` enact is
   *  an internal invariant break (crash loudly), not a reachable "no repo" path
   *  (that toasts from the backstop). */
  function enact(route: TerminalRoute, target: TargetFacts): void {
    const id = route.terminalId;
    store.focusTerminal(id);
    match(route)
      .with({ kind: "terminal" }, () => {})
      .with({ kind: "inspector" }, () => {
        // `showInspector` only selects the tab — `reveal` is the separate
        // visibility action, so a collapsed desktop panel / closed touch drawer
        // needs both to actually surface the Inspector. Both are given the
        // route's terminal: the focus written a line above only lands on the
        // next flush, so a verb left to read the focused pane would act on the
        // pane the user was on before the link.
        rightPanel.showInspector(id);
        rightPanel.reveal(id);
      })
      .with({ kind: "code" }, (r) => {
        if (target.gitKind !== "repo")
          throw new Error(
            `deep-link: code route enacted on a terminal whose git is ${target.gitKind}`,
          );
        openInCodeTab({
          terminalId: id,
          ref: { path: r.path, startLine: r.line, endLine: r.line },
          cwd: target.cwd,
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
   *  (new arm, old host) state. The switch is `selectHostTab`, so a link
   *  followed while the Conductor is on screen lands on the terminal rather
   *  than behind the conversation. Also record the target as the deep-link
   *  focus intent, so a COLD-BOOT session restore picks it as the active tile
   *  instead of racing the settle effect for the `activeId` write (see
   *  `deepLinkFocusIntent`). */
  function routeToTerminal(route: TerminalRoute): void {
    selectHostTab(decodeHostKey(route.host));
    setDeepLinkFocusIntent(route.terminalId);
    armedRoute = route;
    armRoute(route);
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
   *  deliberately survives (`armedRoute` is null then): hydration must keep
   *  preferring the view the user actually reached. The 8s backstop timer is
   *  not cancelled here — its own "is this still my route?" guard answers for
   *  a disarmed route when it expires, which is what lets this run from the
   *  settle gate's effect phase without writing the arm the gate reads.
   *
   *  The guard asks the PLAIN MIRROR, never `routeArm()`: this runs from
   *  commands (navigate, the traversal gate) that may have armed the route in
   *  the same synchronous turn, and a setter's value is only visible on the
   *  next microtask — the signal would still read the previous state. */
  function disarmInFlightRoute(): void {
    if (armedRoute === null) return;
    armedRoute = null;
    setDeepLinkFocusIntent(null);
  }

  /** A terminal route's DISARMING resolution — a fault verdict (list error,
   *  terminal gone, backstop timeout) or the user switching host away: disarm the
   *  command + intent AND stamp THIS history entry consumed, so a later reload
   *  does not re-enact a command that already resolved. This is the terminal-route
   *  arm of the consumed-command stamp (#1900 R1): an IMMEDIATE verdict
   *  (settings/host/invalid/none) stamps at parse in `navigate`, and an ENACTED
   *  route stamps in the settle effect (keeping its focus intent) — a terminal
   *  route in flight stays UNSTAMPED so a mid-flight reload of a fresh link
   *  re-routes instead of dying stamped-but-un-enacted. NOT used by `navigate`'s
   *  leading supersession or the traversal gate: those don't resolve THIS entry's
   *  freshly-armed command (supersession's entry is the new command's; a traversal
   *  lands on an already-stamped entry), so they use the bare `disarmInFlightRoute`. */
  function disarmResolved(): void {
    disarmInFlightRoute();
    stampEntryRouted();
  }

  /** Route a parsed link. Host/settings act immediately; a terminal target
   *  defers. `none` is silent (no route present); `invalid` toasts + stays home
   *  (never silently ignores a new link shape).
   *
   *  Supersedes any still-armed terminal route FIRST: a newer navigation always
   *  supersedes an older in-flight one, so a stale route can't enact, toast, or
   *  steer hydration after the user has moved on (a later host/settings switch,
   *  or a second link). Its writes land together — consecutive setter calls
   *  share one microtask batch.
   *
   *  A COMMAND, not a derivation: it writes reactive state (the route arm) and
   *  decides from plain guards, so it must never run in a TRACKING scope —
   *  there, a read of the state it writes would subscribe the caller to the
   *  very signals navigate writes and the app would busy-loop re-routing after
   *  the first bridge-delivered link (reproduced deterministically on both CI
   *  platforms). All four delivery paths are untracked by construction: the
   *  preview bridge calls it from an effect's EFFECT phase, the PWA launch from
   *  `onSettled`, and the boot parse / `hashchange` gate from plain callbacks. */
  function navigate(link: ParsedDeepLink): void {
    // A terminal route DEFERS its consumed-command stamp to when it RESOLVES
    // (enact / a disarming verdict); an IMMEDIATE verdict resolves synchronously
    // here and stamps now. Stamping a terminal route at PARSE would kill a
    // mid-flight reload of a FRESH link — the entry would carry the stamp with
    // the command never enacted, so the boot gate skips it forever (re-pressing
    // Enter in the address bar is a reload too). #1900 R1.
    const deferStamp = "terminalId" in link;
    disarmInFlightRoute();
    match(link)
      .with({ kind: "none" }, () => {})
      .with({ kind: "invalid" }, ({ reason }) =>
        toast.error(`That link doesn't point anywhere kolu knows: ${reason}`),
      )
      .with({ kind: "settings" }, () => openSettings())
      // A work: the ONE route to a work, which every other face takes.
      .with({ kind: "work" }, ({ work, ask }) => {
        routeToWork(work);
        showWork(work, ask);
      })
      .with({ kind: "host" }, ({ host }) => selectHostTab(decodeHostKey(host)))
      // terminal · code · inspector all target a terminal — one handler.
      .with(
        { kind: "terminal" },
        { kind: "code" },
        { kind: "inspector" },
        (l) => routeToTerminal(l),
      )
      .exhaustive();
    // COMMANDS ARE CONSUMED ONCE PER HISTORY ENTRY: mark this entry's command
    // handled, so a later back/forward traversal RESTORING it does not re-route
    // (the `hashchange` gate below) AND a RELOAD does not re-enact it (the boot
    // gate) — the URL is a command channel, not a state mirror; mouse-back
    // reverts the URL silently and a refresh lets session restore own the view
    // (DL3 + #1900 R1). Uniform for every IMMEDIATE verdict incl. `invalid`
    // (traversing/reloading a bad-link entry must not re-toast) and `none`
    // (harmless). A terminal route stamps at RESOLUTION instead (`deferStamp`),
    // so a mid-flight reload of a fresh link re-routes. A same-URL `replaceState`:
    // the hash stays in the bar (durability), no entry is added.
    if (!deferStamp) stampEntryRouted();
  }

  /** A `code` route still waiting on its target's git context — the git sensor
   *  is a THIRD async fact, settled INDEPENDENTLY of membership. Only
   *  `unresolved` waits: `none` is an answer (the settle gate toasts it at once)
   *  and `repo` enacts. Read by both the settle gate (wait) and the backstop
   *  (message). */
  function codeRouteAwaitingRepo(
    route: TerminalRoute,
    gitKind: TerminalMeta["git"]["kind"],
  ): boolean {
    return route.kind === "code" && gitKind === "unresolved";
  }

  /** What the settle gate decided THIS run — every reactive fact already read,
   *  so the effect phase only acts. `wait` is the "nothing to do yet" answer. */
  type SettleVerdict =
    | { kind: "wait" }
    | { kind: "superseded" }
    | { kind: "listError"; message: string }
    | { kind: "gone"; host: string }
    | { kind: "noRepo" }
    | { kind: "enact"; route: TerminalRoute; target: TargetFacts };
  const WAIT: SettleVerdict = { kind: "wait" };

  // The settle-then-verdict effect (CodeTab's `pendingOpen` precedent, over
  // terminal membership). Its COMPUTE reads every membership fact and reaches a
  // verdict; its EFFECT enacts, disarms or toasts — a bookmark never toasts
  // mid-cold-boot because the list is still `pending`.
  createEffect(
    (): SettleVerdict => {
      const route = routeArm();
      // The arm is only ever set, so this answers for the route STILL in
      // flight: a resolved or disarmed one is idle the instant `armedRoute`
      // says so, without a write back into the source this compute reads.
      if (!route || route !== armedRoute) return WAIT;
      // Only act while the ACTIVE host IS the route's host. `setActiveHost`
      // re-windows the list sub, so a mismatch means either the switch hasn't
      // landed (never happens — `routeToTerminal` writes host+arm in one
      // update) or the user has since navigated AWAY (a manual host-chip
      // switch). That is a SUPERSESSION — the effect disarms the command AND its
      // hydration intent via the one named spelling, so neither the enact, the
      // backstop toast, nor a later hydration can act on a route the user
      // walked away from.
      if (encodeHostKey(activeHost()) !== route.host)
        return { kind: "superseded" };
      if (store.listSub.pending()) return WAIT; // membership not settled — wait
      const listError = store.listSub.error();
      // The list stream faulted — `pending()` is false but the value is stale
      // or absent, so we can't honestly say "gone". Fail the link loudly rather
      // than invent a gone-verdict from a broken subscription — and surface the
      // real error, not a generic message. A FAULT VERDICT disarms the pair (and
      // stamps): a command declared failed must not steer a later hydration.
      if (listError) return { kind: "listError", message: listError.message };
      const id = route.terminalId;
      const inList = (store.listSub() ?? []).some((t) => t.id === id);
      if (!inList) {
        // A settled snapshot lacking the id is "gone" ONLY once the list is a
        // COMPLETE census. `listIsAuthoritative()` is that fact (the route host's
        // kaval reconciled — not merely a first frame). Until it holds, the id is
        // merely NOT-YET-reconciled — a genuinely-fresh link resolved inside the
        // boot [connect, inventory-reconciled] window (the class the boot gate still
        // lets route) — so wait; the 8s backstop bounds it. This subscribes to the
        // census fact ONLY on the absent path (Solid control-flow = subscription),
        // never while present or pending. #1900 R2.
        if (!listIsAuthoritative()) return WAIT;
        return { kind: "gone", host: route.host };
      }
      // The route's TARGET is the panel's subject (the panel follows the focused
      // pane), so no containing-tile anchor is computed. `getMetadata` is
      // reactive: `undefined` means the record has not composed yet — wait. Its
      // fields are read HERE, in the tracked phase, and travel as plain values.
      const target = store.getMetadata(id);
      if (!target) return WAIT; // a record hasn't composed yet — wait
      const facts: TargetFacts = { gitKind: target.git.kind, cwd: target.cwd };
      // `code` waits on its target's repo root (a fresh terminal / cold-boot
      // window before the git watcher resolves) rather than toasting a false
      // "not a git repository"; this compute re-runs when the git fact lands
      // (getMetadata is reactive), bounded by the 8s backstop.
      if (codeRouteAwaitingRepo(route, facts.gitKind)) return WAIT;
      // The sensor answered: no repo. A verdict, not a wait — say so now.
      if (route.kind === "code" && facts.gitKind === "none")
        return { kind: "noRepo" };
      return { kind: "enact", route, target: facts };
    },
    (verdict) => {
      match(verdict)
        .with({ kind: "wait" }, () => {})
        .with({ kind: "superseded" }, () => {
          // The user switched host AWAY from the route's host (a manual
          // host-chip switch). A SUPERSESSION: disarm the command + intent AND
          // stamp the entry consumed, so a reload of the stale link doesn't
          // re-enact it and yank the tab back to a host the user walked away
          // from (#1900 R1).
          disarmResolved();
        })
        .with({ kind: "listError" }, ({ message }) => {
          disarmResolved();
          toast.error(
            `Couldn't load this host's terminals to resolve the link: ${message}`,
          );
        })
        .with({ kind: "gone" }, ({ host }) => {
          disarmResolved(); // fault verdict — disarm + intent + stamp together
          // Name what the link pointed at (the host) — the host-gone path already
          // names its host via wire.ts's reconcile toast, so the two agree.
          toast.error(
            `That terminal is no longer on "${host}" — it was closed or never existed. Staying on that host.`,
          );
        })
        .with({ kind: "noRepo" }, () => {
          disarmResolved();
          toast.error(
            "Couldn't open that file — that terminal isn't in a git repository.",
          );
        })
        .with({ kind: "enact" }, ({ route, target }) => {
          // The ONLY non-disarming resolution: an ENACTED route's intent survives
          // so cold-boot hydration keeps the reached view. Mark the route no
          // longer in flight FIRST (so a throwing enact can't leave the gate
          // armed into a retry loop), then enact, then stamp the entry consumed
          // — but ONLY after enact RETURNS. If a view seam in enact throws, the
          // entry is left UNSTAMPED and retryable on reload, never durably
          // stamped-but-un-enacted (the exact state #1900 R1 prevents). Never
          // `disarmResolved` here — that would clear the surviving intent.
          //
          // The enact itself runs at the settle that follows: it drives view seams
          // (focus, panel reveal, the Code tab) that consult reactive state, which
          // an effect callback is the wrong scope to read in.
          armedRoute = null;
          onSettled(() => {
            enact(route, target);
            stampEntryRouted();
          });
        })
        .exhaustive();
    },
  );

  // Bounded backstop: if the wait never resolves, give up loudly rather than
  // wait forever. Two DIFFERENT reasons land here, and the message must tell
  // them apart: (1) membership never settled — host unreachable / stuck warming
  // — the plain "couldn't reach the host" case; (2) a `code` route whose host
  // WAS reached and whose terminal exists, but whose `git` never resolved at
  // all (still `unresolved` — a `none` answer is toasted by the settle gate), so
  // name the git sensor rather than falsely blame the host. The git wording is
  // gated on `route.kind === "code"` so a terminal/inspector route that timed
  // out via the membership path never masquerades as a "no git repo".
  createEffect(
    () => routeArm(),
    (route) => {
      if (!route || route !== armedRoute) return;
      const timer = setTimeout(() => {
        if (armedRoute !== route) return;
        disarmResolved(); // fault verdict — disarm + intent + stamp together
        // Same target + repo-readiness facts the settle gate reads — read HERE
        // at expiry, because the question is what is true when the wait runs
        // out, not what was true when it started.
        const target = store.getMetadata(route.terminalId);
        if (target && codeRouteAwaitingRepo(route, target.git.kind)) {
          toast.error(
            "Couldn't open that file — that terminal's git repository never resolved.",
          );
        } else if (!listIsAuthoritative()) {
          // The wait expired with the list still non-authoritative: the host's
          // kaval never came up (or is wedged), so the membership never converged.
          // Name THAT — the host WAS reached, its daemon isn't running — rather than
          // a false "couldn't reach the host", mirroring the git hedge above (#1900 R4).
          toast.error(
            `Couldn't open that link — that host's daemon isn't running.`,
          );
        } else {
          toast.error("Couldn't reach the host for that link in time.");
        }
      }, MEMBERSHIP_BOUND_MS);
      return () => clearTimeout(timer);
    },
  );

  /** Route a hash delivered from OUTSIDE the address bar (a PWA launch, the
   *  preview bridge). Reflect it into the bar with `replaceState` — the hash
   *  stays durable (copyable; reload re-navigates) but NO history entry is
   *  pushed, so mouse-back never replays a stale teleport: deep-link routing
   *  must not record history that ordinary in-app navigation doesn't (a
   *  `location.hash =` write would push one per routed link). `replaceState`
   *  fires no `hashchange`, so route explicitly — always, which also keeps a
   *  repeated same-hash request re-routing. */
  function navigateFromExternal(hash: string): void {
    // An external request is a FRESH command (a preview-bridge re-click, a PWA
    // launch) — even for the SAME hash already in the bar (`equals: false`
    // re-route). Reset THIS entry's state before routing so the fresh terminal
    // command is UNSTAMPED until it resolves: a same-hash re-request must not
    // inherit the prior route's `koluRouted` stamp, or a mid-flight reload's boot
    // gate would skip it (#1900 R1). Unconditional for any non-empty hash (not
    // just a changed one) — `replaceState` keeps the hash durable, pushes no
    // history entry, and fires no `hashchange`, so we route explicitly below.
    if (hash) history.replaceState(null, "", hash);
    navigate(parseDeepLink(hash));
  }

  // (d) the preview bridge — a kolu deep link clicked inside the Code-tab
  // preview iframe (see `requestDeepLinkNavigation`). The sandbox can't
  // navigate the parent, so the bridge posts the hash here; it takes the same
  // external pipeline as a PWA launch, so an invalid hash toasts exactly as a
  // typed URL would.
  createEffect(
    () => externalNavRequest(),
    (hash) => {
      if (hash === null) return;
      // Routing is a COMMAND that consults current state (the settings drawer's
      // breakpoint, the active host, the works mirror) through the view seams it
      // calls. An effect callback is a strict-read window, so the command runs at
      // the settle that follows — the same scope the PWA-launch arm already uses,
      // and still this turn.
      onSettled(() => {
        navigateFromExternal(hash);
      });
    },
  );

  onSettled(() => {
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
    // (a) boot parse — a bookmark opened cold. Skipped when the launch consumer
    // already handled this load's launch, AND when THIS history entry's deep-link
    // command was already consumed: the `koluRouted` stamp SURVIVES a reload in
    // `history.state`, so a refresh restores a consumed entry — re-enacting it
    // would `setActiveHost` the tab to the stale link's host (clobbering the
    // persisted active host, any backend) and toast a false "gone", the reported
    // #1900 bug. The boot arm now honors the SAME consumed-command stamp DL3's
    // traversal gate reads; session restore owns view restoration across reloads.
    // A FRESH bookmark / notification (no stamp) still routes. #1900 R1.
    if (!launchHandled && !entryAlreadyRouted())
      navigate(parseDeepLink(window.location.hash));
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
