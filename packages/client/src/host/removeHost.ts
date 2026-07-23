/** The single "remove a pool host" action — shared by the chip's hover ✕ and
 *  the diagnostics popover's confirm step so error wording can't drift. */

import type { HostKey } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import { client } from "../wire";
import { hostLabel } from "./hostChipTone";

export function removeHost(host: HostKey): void {
  client.hosts
    .remove({ host })
    .catch((err: Error) =>
      toast.error(`Couldn't remove ${hostLabel(host)}: ${err.message}`),
    );
}
