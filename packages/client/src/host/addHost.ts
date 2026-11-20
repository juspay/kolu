import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { parseHostInput } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
import { client, requestActivateOnJoin } from "../wire";

export function addHost(raw: string, onAdded?: () => void): UiAction {
  const trimmed = raw.trim();
  if (trimmed === "") return Effect.void;
  const host = parseHostInput(trimmed);
  return client.hosts.add({ host }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        requestActivateOnJoin(host);
        onAdded?.();
      }),
    ),
    Effect.catch((err) =>
      Effect.sync(() => {
        toast.error(`Couldn't add ${trimmed}: ${toError(err).message}`);
      }),
    ),
  );
}
