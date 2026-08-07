/** Atomic "force-cycle this host's connector" verb — shared by the host-down
 *  canvas recovery button and the diagnostics popover's retry row so deadline
 *  reset + toast wording cannot drift. */

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import { resetBootDeadline } from "../kaval/bootDeadline";
import type { UiAction } from "../runAction";
import { client } from "../wire";
import { hostLabel } from "./hostChipTone";

export function reconnectHost(host: HostKey): UiAction {
  return client.hosts.reconnect({ host }).pipe(
    Effect.tap(() => Effect.sync(() => resetBootDeadline(encodeHostKey(host)))),
    Effect.catch((err) =>
      Effect.sync(() => {
        toast.error(
          `Couldn't reconnect ${hostLabel(host)}: ${toError(err).message}`,
        );
      }),
    ),
  );
}
