import { makeEventListener } from "@solid-primitives/event-listener";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { WorkId } from "kolu-work";
import {
  batch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { showWork } from "./conductor/workListing";
import { useWorkMap } from "./conductor/useWorks";
import { type DeepLink, type ParsedDeepLink, parseDeepLink } from "./deepLink";
import { setDeepLinkFocusIntent } from "./deepLinkFocusIntent";
import { listIsAuthoritative } from "./kaval/useDaemonStatus";
import { openInCodeTab } from "./right-panel/openInCodeTab";
import { useRightPanel } from "./right-panel/useRightPanel";
import { openSettings } from "./settings/useSettingsOpen";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { activeHost, setActiveHost } from "./wire";

const DEEP_LINK_RESOLVE_BOUND_MS = 8000;

const ROUTED_STAMP = { koluRouted: true } as const;
function stampEntryRouted(): void {
  history.replaceState(ROUTED_STAMP, "");
}
function entryAlreadyRouted(): boolean {
  const state = history.state as Partial<typeof ROUTED_STAMP> | null;
  return state?.koluRouted === true;
}

type TerminalRoute = Extract<DeepLink, { terminalId: TerminalId }>;

type TerminalMeta = NonNullable<
  ReturnType<ReturnType<typeof useTerminalStore>["getMetadata"]>
>;

interface LaunchParams {
  readonly targetURL?: string;
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

let navigateExternal: ((hash: string) => void) | null = null;

export function requestDeepLinkNavigation(hash: string): void {
  navigateExternal?.(hash);
}

export function useDeepLinks(): void {
  const store = useTerminalStore();
  const rightPanel = useRightPanel();

  const [pending, setPending] = createSignal<TerminalRoute | null>(null);

  const [pendingWork, setPendingWork] = createSignal<WorkId | null>(null);
  const workMap = useWorkMap();
  createEffect(() => {
    const id = pendingWork();
    if (id !== null && workMap().has(id)) setPendingWork(null);
  });
  createEffect(() => {
    if (pendingWork() === null) return;
    const timer = setTimeout(() => {
      setPendingWork(null);
      toast.error(
        "That piece of work isn't in kolu — it may have finished and been let go.",
      );
    }, DEEP_LINK_RESOLVE_BOUND_MS);
    onCleanup(() => clearTimeout(timer));
  });

  function enact(route: TerminalRoute, meta: TerminalMeta): void {
    const id = route.terminalId;
    store.focusTerminal(id);
    match(route)
      .with({ kind: "terminal" }, () => {})
      .with({ kind: "inspector" }, () => {
        rightPanel.showInspector();
        rightPanel.reveal();
      })
      .with({ kind: "code" }, (r) => {
        if (meta.git.kind !== "repo")
          throw new Error(
            `deep-link: code route enacted on a terminal whose git is ${meta.git.kind}`,
          );
        openInCodeTab({
          terminalId: id,
          ref: { path: r.path, startLine: r.line, endLine: r.line },
          cwd: meta.cwd,
          targetMode: "browse",
          allowBasenameFallback: false,
        });
      })
      .exhaustive();
  }

  function routeToTerminal(route: TerminalRoute): void {
    setActiveHost(decodeHostKey(route.host));
    setDeepLinkFocusIntent(route.terminalId);
    setPending(route);
  }

  type RouteVerdict =
    | { kind: "superseded" }
    | { kind: "immediate" }
    | { kind: "faulted" }
    | { kind: "enacted"; route: TerminalRoute; meta: TerminalMeta };

  function resolveRoute(verdict: RouteVerdict): void {
    if (pending() !== null)
      batch(() => {
        setPending(null);
        if (verdict.kind !== "enacted") setDeepLinkFocusIntent(null);
      });
    match(verdict)
      .with({ kind: "superseded" }, () => {})
      .with({ kind: "immediate" }, { kind: "faulted" }, () =>
        stampEntryRouted(),
      )
      .with({ kind: "enacted" }, (v) => {
        enact(v.route, v.meta);
        stampEntryRouted();
      })
      .exhaustive();
  }

  function navigate(link: ParsedDeepLink): void {
    const deferStamp = "terminalId" in link;
    batch(() => {
      resolveRoute({ kind: "superseded" });
      match(link)
        .with({ kind: "none" }, () => {})
        .with({ kind: "invalid" }, ({ reason }) =>
          toast.error(`That link doesn't point anywhere kolu knows: ${reason}`),
        )
        .with({ kind: "settings" }, () => openSettings())
        .with({ kind: "work" }, ({ work, ask }) => {
          setPendingWork(work);
          showWork(work, ask);
        })
        .with({ kind: "host" }, ({ host }) =>
          setActiveHost(decodeHostKey(host)),
        )
        .with(
          { kind: "terminal" },
          { kind: "code" },
          { kind: "inspector" },
          (l) => routeToTerminal(l),
        )
        .exhaustive();
    });
    if (!deferStamp) resolveRoute({ kind: "immediate" });
  }

  function codeRouteAwaitingRepo(
    route: TerminalRoute,
    meta: TerminalMeta,
  ): boolean {
    return route.kind === "code" && meta.git.kind === "unresolved";
  }

  createEffect(() => {
    const route = pending();
    if (!route) return;
    if (encodeHostKey(activeHost()) !== route.host) {
      resolveRoute({ kind: "faulted" });
      return;
    }
    if (store.listSub.pending()) return;
    const listError = store.listSub.error();
    if (listError) {
      resolveRoute({ kind: "faulted" });
      toast.error(
        `Couldn't load this host's terminals to resolve the link: ${listError.message}`,
      );
      return;
    }
    const id = route.terminalId;
    const inList = (store.listSub() ?? []).some((t) => t.id === id);
    if (!inList) {
      if (!listIsAuthoritative()) return;
      resolveRoute({ kind: "faulted" });
      toast.error(
        `That terminal is no longer on "${route.host}" — it was closed or never existed. Staying on that host.`,
      );
      return;
    }
    const target = store.getMetadata(route.terminalId);
    if (!target) return;
    if (codeRouteAwaitingRepo(route, target)) return;
    if (route.kind === "code" && target.git.kind === "none") {
      resolveRoute({ kind: "faulted" });
      toast.error(
        "Couldn't open that file — that terminal isn't in a git repository.",
      );
      return;
    }
    resolveRoute({ kind: "enacted", route, meta: target });
  });

  createEffect(() => {
    const route = pending();
    if (!route) return;
    const timer = setTimeout(() => {
      if (pending() !== route) return;
      resolveRoute({ kind: "faulted" });
      const target = store.getMetadata(route.terminalId);
      if (target && codeRouteAwaitingRepo(route, target)) {
        toast.error(
          "Couldn't open that file — that terminal's git repository never resolved.",
        );
      } else if (!listIsAuthoritative()) {
        toast.error(
          `Couldn't open that link — that host's daemon isn't running.`,
        );
      } else {
        toast.error("Couldn't reach the host for that link in time.");
      }
    }, DEEP_LINK_RESOLVE_BOUND_MS);
    onCleanup(() => clearTimeout(timer));
  });

  function navigateFromExternal(hash: string): void {
    if (hash) history.replaceState(null, "", hash);
    navigate(parseDeepLink(hash));
  }

  navigateExternal = navigateFromExternal;
  onCleanup(() => {
    navigateExternal = null;
  });

  onMount(() => {
    let launchHandled = false;
    const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
    lq?.setConsumer((params) => {
      launchHandled = true;
      if (!params.targetURL) return;
      let hash: string;
      try {
        hash = new URL(params.targetURL).hash;
      } catch {
        toast.error("Couldn't open that link — the launch URL was malformed.");
        return;
      }
      navigateFromExternal(hash);
    });
    if (!launchHandled && !entryAlreadyRouted())
      navigate(parseDeepLink(window.location.hash));
  });

  makeEventListener(window, "hashchange", () => {
    if (entryAlreadyRouted()) {
      resolveRoute({ kind: "superseded" });
      return;
    }
    navigate(parseDeepLink(window.location.hash));
  });
}
