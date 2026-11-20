import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { ForwardOrigin, Forwards } from "kolu-common/surface";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { createMemo, createResource, createRoot, mapArray } from "solid-js";
import { toast } from "solid-sonner";
import { runActionPromise } from "../runAction";
import { app, client, hostKeys } from "../wire";

const sub = createRoot(() => app.cells.forwards.use());

function allForwards(): Forwards {
  return sub.value() ?? [];
}

const byHost = createRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (enc) => ({
      enc,
      read: createMemo(() =>
        allForwards().filter((f) => encodeHostKey(f.host) === enc),
      ),
    }),
  );
  const index = createMemo(
    () => new Map(roots().map(({ enc, read }) => [enc, read])),
  );
  return index;
});

export function forwardsForHost(host: HostKey): Forwards {
  const read = byHost().get(encodeHostKey(host));
  if (!read)
    throw new Error(
      `Forwards requested for non-member host ${encodeHostKey(host)}`,
    );
  return read();
}

export const doorLocalPorts = createRoot(() =>
  createMemo(() => new Set(allForwards().map((f) => f.localPort)), undefined, {
    equals: (a, b) => a.size === b.size && [...a].every((p) => b.has(p)),
  }),
);

export function createForward(input: {
  host: HostKey;
  port: number;
  origin: ForwardOrigin;
}) {
  return app.procedures.forwards.create(input);
}

export function cancelForward(key: string) {
  return app.procedures.forwards.cancel({ key });
}

const viewerHostQuery = createRoot(() =>
  createResource(() =>
    runActionPromise(
      client.hosts.viewer().pipe(
        Effect.map((r): HostKey | null => r.host),
        Effect.catch((err) =>
          Effect.sync((): HostKey | null => {
            toast.warning(`Viewer-host lookup failed: ${toError(err).message}`);
            return null;
          }),
        ),
      ),
    ),
  ),
);

export function viewerHost(): HostKey | null {
  const [data] = viewerHostQuery;
  return data() ?? null;
}
