/** The reactive, memoized StatePip binder every kolu surface reads — dock row,
 *  touch row, split row, needs-you strip, tile title, workspace card, rail.
 *
 *  The FOLD itself (`bindStatePip`, and the paint / glyph / motion decisions
 *  under it) lives in `@kolu/solid-dockrow/rowValues`, beside the row it paints,
 *  so a fleet mirror rendering kolu's row paints the identical pip rather than
 *  re-deriving one. What is left here is the part that is kolu's alone: the
 *  ambient reads — which host the terminal is on, and the shared attention
 *  mirror keyed by it — and the memo that keeps the fold from re-running once
 *  per JSX prop.
 *
 *  `encHost` is the host the terminal lives on: the attention mirror is keyed by
 *  host, and a reader that threw the key away had to scan every host's arrays
 *  for the id — which made correctness rest on ids never colliding across hosts,
 *  and made any host's ~1 s activity tick invalidate every pip memo in the dock
 *  instead of only that host's. Every call site already knows its host. */

import type {
  DockRowBucket,
  StatePipBind,
} from "@kolu/solid-dockrow/rowValues";
import { bindStatePip } from "@kolu/solid-dockrow/rowValues";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { useAttentionFacts } from "../attention/useAttentionFacts";

export function useStatePip(
  encHost: Accessor<string>,
  id: Accessor<TerminalId>,
  meta: Accessor<TerminalMetadata>,
  unread: Accessor<boolean>,
  pipBucket?: Accessor<DockRowBucket | undefined>,
): Accessor<StatePipBind> {
  const facts = useAttentionFacts();
  return createMemo(() =>
    bindStatePip({
      meta: meta(),
      attention: facts.attentionOf(encHost(), id()),
      unread: unread(),
      pipBucket: pipBucket?.(),
    }),
  );
}
