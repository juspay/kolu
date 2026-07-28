import type { KavalProcessRss, ProcessRss } from "kolu-common/surface";
import { match, P } from "ts-pattern";
import { formatMBCompact } from "../ui/memory";

/** Process-memory state → compact host-chip tooltip text. The mixed-version
 * kaval gate window intentionally stays quiet here: the dialog owns the full
 * restart instruction, while the chip merely refuses to show a false number. */
export function formatProcessMemoryText(
  m: ProcessRss | KavalProcessRss | undefined,
): string {
  return match(m)
    .with({ status: "ok" }, (d) => `RSS ${formatMBCompact(d.rssBytes)}`)
    .with({ status: "error" }, () => "memory poll failed")
    .with({ status: "gate-format-unsupported" }, () => "memory unavailable")
    .with({ status: "absent" }, () => "memory unavailable")
    .with(P.nullish, () => "memory unavailable")
    .exhaustive();
}
