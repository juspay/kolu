/** The single "add a pool host" action, shared by the desktop `+` popover
 *  (`AddHostAffordance` in `HostSelectorStrip.tsx`) and the mobile in-sheet add
 *  section (`MobileHostRow.tsx`). The two surfaces differ only in their
 *  CONTAINER — an anchored popover vs. a full-width sheet section — so the add
 *  MECHANISM lives here once rather than being hand-rolled twice:
 *
 *    · parse the ssh-target string (`parseHostInput` is TOTAL — "local" just
 *      resolves to the already-member Local variant; `hosts.add`'s own
 *      rejection is the honest single error surface);
 *    · `client.hosts.add` it into the runtime pool;
 *    · jump the canvas to the new host once it JOINS membership
 *      (`requestActivateOnJoin` — a bare `setActiveHost` here races the
 *      reconcile and bounces back to local);
 *    · surface any failure LOUD via toast (never a silent no-op).
 *
 *  `onAdded` is the caller's own UI cleanup (clear the field, collapse the
 *  popover / section) run only on success — kept out of here because it's the
 *  one thing that genuinely differs per container. */

import { parseHostInput } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import { client, requestActivateOnJoin } from "../wire";

export function addHost(raw: string, onAdded?: () => void): void {
  const trimmed = raw.trim();
  if (trimmed === "") return;
  const host = parseHostInput(trimmed);
  client.hosts
    .add({ host })
    .then(() => {
      // Register the activate-on-join intent FIRST — it's the shared mechanism
      // completing the add. `onAdded` is the caller's OWN presentation cleanup
      // (clear the field, collapse the popover / section); running it after
      // means presentation can't interpose between a successful add and the
      // canvas jumping to the new host.
      requestActivateOnJoin(host);
      onAdded?.();
    })
    .catch((err: Error) =>
      toast.error(`Couldn't add ${trimmed}: ${err.message}`),
    );
}
