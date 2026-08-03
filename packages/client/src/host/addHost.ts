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

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { parseHostInput } from "kolu-common/hostKey";
import { toast } from "solid-sonner";
import type { UiAction } from "../runAction";
import { client, requestActivateOnJoin } from "../wire";

/** The add-a-host program. Total — the one failure it can produce is the add's
 *  own, and it is toasted here, next to the operation it names. */
export function addHost(raw: string, onAdded?: () => void): UiAction {
  const trimmed = raw.trim();
  if (trimmed === "") return Effect.void;
  const host = parseHostInput(trimmed);
  return client.hosts.add({ host }).pipe(
    // The success continuation is a SEPARATE step from the recovery below, not a
    // trailing one, for the reason the old two-arg `.then(onFulfilled, onRejected)`
    // existed: the toast must report ONLY a `hosts.add` failure (the operation it
    // names). A recovery wrapped around both would also catch an exception thrown
    // by `requestActivateOnJoin` / `onAdded` and mislabel it "Couldn't add …"
    // though the add succeeded. Here that throw is a DEFECT inside an
    // `Effect.sync`, which the run edge reports loudly and this arm never sees.
    Effect.tap(() =>
      Effect.sync(() => {
        // Register the activate-on-join intent FIRST — it's the shared mechanism
        // completing the add. `onAdded` is the caller's OWN presentation cleanup;
        // running it after means presentation can't interpose between a
        // successful add and the canvas jumping to the new host.
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
