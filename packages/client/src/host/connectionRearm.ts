import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  type Accessor,
  createEffect,
  createRoot,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

/** Detect a membership RE-JOIN of the active host: `true` iff it is present now but was
 *  absent on the previous frame. Pure so the re-arm trigger is unit-pinnable. */
export function isRejoin(present: boolean, prevPresent: boolean): boolean {
  return present && !prevPresent;
}

/** Re-arm a per-entry cell subscription on a membership RE-JOIN (d1).
 *
 *  The server's `forwardStream` ends a per-entry stream TYPED the instant its key leaves
 *  membership — CORRECTLY, since a re-add mints a NEW session and the captured forward must
 *  never un-orphan onto it. But `useEntry(activeHost)` does not re-key on a SAME-key re-join
 *  (only on an activeHost switch), so a host that flaps membership while the transport is
 *  still LIVE (a transient remove+re-add) leaves the connection cell stranded at its last
 *  phase (e.g. `building`) — un-floored by C' (which only bites when the transport is dead).
 *
 *  This rebuilds the subscription whenever the active host CHANGES or RE-JOINS membership: a
 *  generation bumps on each re-join, and a keyed effect disposes the prior subscription and
 *  opens a fresh one (a new server-side forwardStream) against the current session. `open`
 *  subscribes in the CURRENT reactive owner and returns its value accessor. Must run inside a
 *  reactive owner. */
export function createRejoinKeyedSub<T>(
  activeHost: Accessor<HostKey>,
  memberKeys: () => readonly HostKey[],
  open: (host: HostKey) => Accessor<T | undefined>,
): Accessor<T | undefined> {
  const [gen, setGen] = createSignal(0);
  let prevPresent = true;
  createEffect(() => {
    const enc = encodeHostKey(activeHost());
    const present = memberKeys().some((k) => encodeHostKey(k) === enc);
    if (isRejoin(present, prevPresent)) setGen((g) => g + 1);
    prevPresent = present;
  });

  const [value, setValue] = createSignal<T | undefined>();
  createEffect(
    on([() => encodeHostKey(activeHost()), gen], () => {
      const host = activeHost();
      const dispose = createRoot((d) => {
        const read = open(host);
        createEffect(() => {
          const v = read();
          setValue(() => v);
        });
        return d;
      });
      onCleanup(dispose);
    }),
  );
  return value;
}
