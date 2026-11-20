/** The reactive, memoized StatePip binder every kolu surface reads. The fold
 *  itself is `bindStatePip` in `@kolu/solid-dockrow/rowValues`; this adds the
 *  ambient reads (the terminal's host and the attention mirror keyed by it)
 *  and the memo. */

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
