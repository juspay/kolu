import { Effect } from "effect";
import type { Logger } from "@kolu/log";
import { reactiveFamily, source } from "@kolu/surface/reactor";

export type PushedPadiCell = "newTerminalPolicy" | "agentDistro";

export type PadiCellClient<C extends PushedPadiCell, T> = {
  surface: Record<C, { set(value: T): Effect.Effect<unknown, unknown> }>;
};

export interface PadiCellPushSession {
  onState(cb: (state: { phase: string }) => void): () => void;
  currentState(): { phase: string };
  currentClient(): Promise<unknown> | null;
}

type LiveLink<T> = { sent?: { readonly value: T } };

export interface PadiCellPushPool<S extends PadiCellPushSession> {
  hosts(): string[];
  getSession(host: string): S | undefined;
  subscribe(onChange: () => void): () => void;
}

export interface PadiCellPusher {
  republish(): void;
}

export function installPadiCellPusher<
  C extends PushedPadiCell,
  T,
  S extends PadiCellPushSession,
>(deps: {
  cell: C;
  pool: PadiCellPushPool<S>;
  getValue: () => T;
  equals: (a: T, b: T) => boolean;
  onPushed?: (host: string) => void;
  log: Logger;
}): PadiCellPusher {
  const { cell, pool, getValue, equals, log } = deps;
  const links = new Map<string, LiveLink<T>>();

  const pushTo = (host: string, link: LiveLink<T>): void => {
    const session = pool.getSession(host);
    if (session === undefined) return;
    if (session.currentState().phase !== "connected") return;
    const client = session.currentClient();
    if (client === null) {
      log.error(
        { host, cell },
        `padi is connected but has no client — ${cell} not pushed`,
      );
      return;
    }
    void client
      .then(async (raw) => {
        const c = raw as PadiCellClient<C, T>;
        const value = getValue();
        if (link.sent !== undefined && equals(link.sent.value, value)) return;
        if (links.get(host) === link) link.sent = { value };
        await Effect.runPromise(c.surface[cell].set(value)).catch(
          (err: unknown) => {
            link.sent = undefined;
            throw err;
          },
        );
        deps.onPushed?.(host);
      })
      .catch((err: unknown) =>
        log.error({ err, host, cell }, `${cell} push to padi failed`),
      );
  };

  const family = reactiveFamily<string, { phase: string }>({
    members: source(
      (emit) => pool.subscribe(() => emit(pool.hosts())),
      pool.hosts(),
    ),
    attach: (host, set) => pool.getSession(host)?.onState(set),
    onEvict: (host) => {
      links.delete(host);
    },
  });

  const scanForConnects = (): void => {
    for (const host of family.keys()) {
      if (family.get(host)?.phase === "connected") {
        if (!links.has(host)) {
          const link: LiveLink<T> = {};
          links.set(host, link);
          pushTo(host, link);
        }
      } else {
        links.delete(host);
      }
    }
  };

  family.subscribe(scanForConnects);
  scanForConnects();

  return {
    republish: () => {
      for (const [host, link] of [...links]) pushTo(host, link);
    },
  };
}
