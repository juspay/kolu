import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import type { Accessor, Setter } from "solid-js";
import { persistedPref } from "../persistedPref.ts";

/** Build the per-tab ACTIVE host pref over a chosen storage backend.
 *
 *  This owns the pref CONTRACT — its key, default, and the canonical wire codec — in ONE
 *  place, so production (`wire.ts`) and the boot-survival tests construct the SAME pref.
 *  Without it the contract was copied at three sites, and a test wiring `persistedPref`
 *  itself could pass against a stale copy while production drifted (a parser/serializer
 *  change would leave the survive-relaunch test green yet the app broken). Only the
 *  storage backend varies — chosen from the launch context by `activeHostStorage`.
 *
 *  The persisted value is the CANONICAL wire string (`encodeHostKey`/`decodeHostKey` — NOT
 *  the default `JSON.stringify`, which would write `{"kind":"local"}` instead of `"local"`),
 *  defaulting to the unremovable LOCAL default. */
export function activeHostPref(
  storage: Storage,
): [Accessor<HostKey>, Setter<HostKey>] {
  return persistedPref<HostKey>({
    name: "kolu-active-host",
    fallback: LOCAL_HOST,
    parse: (raw) => decodeHostKey(raw),
    serialize: encodeHostKey,
    storage,
    // Surface a corrupt/invalid stored host rather than silently collapsing to the local
    // default — otherwise "the stored active host was garbage" reads identically to "this
    // context has always been local." Resetting to LOCAL_HOST is benign, so a warn is the
    // right level (matches useDaemonStatus's reattachAnnouncedAt pref).
    // caught-error-must-not-collapse.
    onInvalid: (err, raw) =>
      console.warn(
        `[wire] stored active-host "${raw}" is invalid; resetting to the local default:`,
        err,
      ),
  });
}
