import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
import { client } from "../wire";
import { hostLabel } from "./hostChipTone";

export function removeHost(host: HostKey): UiAction {
  return client.hosts.remove({ host }).pipe(
    Effect.catch((err) =>
      Effect.sync(() => {
        toast.error(
          `Couldn't remove ${hostLabel(host)}: ${toError(err).message}`,
        );
      }),
    ),
  );
}
