// @vitest-environment happy-dom
/**
 * juspay/kolu#2057 — ONE DOCK ROW PER TERMINAL, EVEN IN ONE REPOSITORY.
 *
 * The issue reports two terminals in the same project converging: same title,
 * same subtitle, same status pip, and an alert on one lighting both. Its
 * investigation notes suspect a Dock-side keying leak — a projection keyed by
 * project where it should be keyed by terminal id.
 *
 * This file pins that it isn't. It drives the exact composition `DockRow`
 * performs — `buildTerminalDisplayInfos` → `pairDisplayRow` → `annotationLine` /
 * `rowSubline` / `bindStatePip` / `dockRowAttrs` — over TWO terminals that share
 * a repository, a branch and a worktree (so every project-level key they have is
 * identical), then moves ONE terminal's agent metadata and unread flag and reads
 * both rendered rows back.
 *
 * It is GREEN on master: the Dock's per-row derivation is already
 * terminal-keyed. That is the point — it is the sabotage anchor that keeps the
 * derivation terminal-keyed, while the actual convergence (two terminals handed
 * the SAME agent session by a directory-keyed match) is reproduced and fixed
 * upstream in `padi/src/terminalWorkspace/agentSessionOwnership.test.ts`.
 */

import {
  activeArm,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { AgentInfo, TerminalId } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { createMemo, For } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { TerminalAttention } from "@kolu/padi-client/attention";
import { annotationLine } from "../../intent/text";
import { bindStatePip } from "@kolu/solid-dockrow/rowValues";
import {
  buildTerminalDisplayInfos,
  pairDisplayRow,
} from "../../terminal/terminalDisplay";
import { dockRowAttrs, rowSubline } from "@kolu/solid-dockrow/rowValues";
import { isActiveRow } from "./activeRow";

const ALICE = "terminal-alice" as TerminalId;
const BOB = "terminal-bob" as TerminalId;

/** ONE repository, ONE branch, ONE worktree — every project-level fact these
 *  two terminals have is identical, which is the condition the issue says hides
 *  the bug when you use different projects. */
const GIT: GitInfo = {
  repoRoot: "/home/dev/proj",
  repoName: "proj",
  worktreePath: "/home/dev/proj",
  branch: "main",
  isWorktree: false,
  mainRepoRoot: "/home/dev/proj",
  remoteUrl: null,
};

function metaWith(agent: AgentInfo | null, intent?: string): TerminalMetadata {
  return {
    state: "active",
    cwd: "/home/dev/proj",
    git: GIT,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    ...(intent === undefined ? {} : { intent }),
  } as TerminalMetadata;
}

function agentInfo(
  state: AgentInfo["state"],
  summary: string | null,
): AgentInfo {
  return {
    kind: "codex",
    state,
    sessionId: `session-for-${summary ?? "none"}`,
    startedAt: 0,
    summary,
  } as AgentInfo;
}

/** What a rendered row says about itself — the four things the issue names. */
interface RowReading {
  title: string;
  subline: string;
  pip: string | null;
  unread: boolean;
}

function readRow(host: HTMLElement, id: TerminalId): RowReading {
  const row = host.querySelector<HTMLElement>(`[data-terminal-id="${id}"]`);
  if (!row) throw new Error(`no dock row rendered for ${id}`);
  return {
    title: row.querySelector('[data-role="title"]')?.textContent ?? "",
    subline: row.querySelector('[data-role="subline"]')?.textContent ?? "",
    pip: row.getAttribute("data-pip"),
    unread: row.hasAttribute("data-unread"),
  };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = "";
});

/** Render both rows the way `DockRow` builds them — same leaf functions, same
 *  order — over a reactive metadata store and a reactive unread set.
 *
 *  This covers BOTH dock surfaces the issue's acceptance criteria name. The
 *  expanded cards row (`Dock.tsx`'s `DockRow`) and the collapsed rail / mobile
 *  row (`DockList.tsx`'s `DockListRow`) are separate components by design, but
 *  they share the three things under test here by construction — the row data
 *  (`createDockRowData(props.id)`), the unread read (`store.isUnread(props.id)`,
 *  spelled identically in `DockRow`, `DockListRow` and the rail chip), and the
 *  attribute contract (`dockRowAttrs`). All three are keyed on the row's own
 *  terminal id, so a project-keyed leak could not reach one surface without the
 *  other. */
function renderDock() {
  const [meta, setMeta] = createStore<Record<TerminalId, TerminalMetadata>>({
    [ALICE]: metaWith(agentInfo("thinking", "Refactor the parser")),
    [BOB]: metaWith(agentInfo("thinking", "Update the changelog")),
  });
  const [unread, setUnread] = createStore<Record<TerminalId, boolean>>({
    [ALICE]: false,
    [BOB]: false,
  });
  // The attention class is a per-terminal fact in production too (the pip's
  // colour comes off `attentionOf(host, id)`, never re-derived from metadata),
  // so the fixture keys it by terminal exactly as the mirror does.
  const [attention, setAttention] = createStore<
    Record<TerminalId, TerminalAttention>
  >({
    [ALICE]: { klass: "working", live: false },
    [BOB]: { klass: "working", live: false },
  });

  const ids = [ALICE, BOB];
  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      ids,
      (id) => meta[id],
      () => [],
    ),
  );

  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => (
      <For each={ids}>
        {(id) => {
          const combined = createMemo(() =>
            pairDisplayRow(displayInfos().get(id), meta[id]),
          );
          const pip = createMemo(() => {
            const c = combined();
            if (!c) return null;
            return bindStatePip({
              meta: c.meta,
              attention: attention[id] ?? { klass: "working", live: false },
              unread: unread[id] ?? false,
            });
          });
          return (
            <div
              {...dockRowAttrs({
                id,
                bucket: "working",
                agentState: activeArm(meta[id])?.agent?.state,
                asking: pip()?.asking ?? false,
                unread: unread[id] ?? false,
                active: isActiveRow(id),
              })}
              data-pip={pip()?.variant}
            >
              <span data-role="title">
                {annotationLine(
                  combined()?.meta.intent,
                  combined()?.info.key.label ?? "",
                )}
              </span>
              <span data-role="subline">
                {combined()
                  ? rowSubline(combined()?.meta as TerminalMetadata).text
                  : ""}
              </span>
            </div>
          );
        }}
      </For>
    ),
    host,
  );
  cleanup = () => {
    dispose();
    host.remove();
  };
  return { host, setMeta, setUnread, setAttention };
}

describe("dock rows in one repository stay independent", () => {
  it("moves only the changed terminal's title, subtitle and status", () => {
    const { host, setMeta, setAttention } = renderDock();
    const bobBefore = readRow(host, BOB);

    // Alice's harness finishes its turn, renames its task and gains an intent —
    // every field the Dock's primary line and sub-line read.
    setMeta(ALICE, metaWith(agentInfo("awaiting_user", "Ship it?"), "Rewrite"));
    setAttention(ALICE, { klass: "asking", live: false });

    const aliceAfter = readRow(host, ALICE);
    expect(aliceAfter.title).toBe("Rewrite");
    expect(aliceAfter.subline).toBe("Ship it?");
    expect(aliceAfter.pip).toBe("awaiting");

    expect(readRow(host, BOB)).toEqual(bobBefore);
    expect(bobBefore.subline).toBe("Update the changelog");
  });

  it("lights the alert indicator on only the terminal that was marked", () => {
    const { host, setUnread } = renderDock();
    setUnread(ALICE, true);

    expect(readRow(host, ALICE).unread).toBe(true);
    expect(readRow(host, BOB).unread).toBe(false);
  });
});
