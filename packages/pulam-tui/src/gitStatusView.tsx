/**
 * The OpenTUI/Solid view for `pulam-tui git-status` — R4.7.
 *
 * A LIVE git-status board: working tree (staged · modified · untracked) and
 * branch (name · ahead/behind), repainting the instant the repo changes. The
 * `subscribeRepoChange` `{seq}` pulse re-runs `git.getStatus` — the exact
 * procedure-plus-pulse loop kolu's Code tab depends on, proven here over
 * `stdioLink` before kolu composes the same surface.
 *
 * The DECISIONS about the data (grouping, tones) live in the pure
 * `gitStatusRender.ts` (`projectGitStatus`), unit-tested under Node; this
 * module maps a tone to a colour and lays out cells, nothing more. Liveness is
 * SolidJS-canonical — `createSignal` updated by the data layer's sink, the
 * `seq` counter in the title is the liveness proof (it increments on each repo
 * change), and a 1s clock ticks beside it.
 *
 * `.tsx`, loaded only under Bun, imported dynamically by `bin.ts` ONLY when
 * stdout is a TTY (the `--json` path never touches the renderer).
 */

import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import {
  type GitStatusHandle,
  type GitStatusUpdate,
  snapshotGitStatus,
  startGitStatus,
} from "./gitStatus.ts";
import {
  fileCell,
  projectGitStatus,
  statusGlyph,
  type GitStatusView,
} from "./gitStatusRender.ts";
import { HEADER, SUBTLE, TITLE, TONE_COLOR } from "./palette.ts";
import { runTui } from "./runtime.tsx";

/** One file row: the status glyph (toned by its group) + the path. The path
 *  fills the terminal's remaining width so long paths stay readable. */
function FileRow(props: {
  file: { path: string; status: string; oldPath?: string };
  tone: string;
  termWidth: () => number;
}) {
  const pathWidth = () => Math.max(20, props.termWidth() - 4);
  return (
    <box flexDirection="row">
      <text
        fg={
          TONE_COLOR[props.tone as keyof typeof TONE_COLOR] ?? TONE_COLOR.plain
        }
      >
        {`  ${statusGlyph(props.file.status as never)}  `}
      </text>
      <text
        fg={
          TONE_COLOR[props.tone as keyof typeof TONE_COLOR] ?? TONE_COLOR.plain
        }
      >
        {fileCell(props.file.path, pathWidth())}
      </text>
    </box>
  );
}

/** One section: a header (label + count) and its file rows. */
function Section(props: {
  section: {
    label: string;
    tone: string;
    files: { path: string; status: string; oldPath?: string }[];
  };
  termWidth: () => number;
}) {
  const count = () => props.section.files.length;
  return (
    <box flexDirection="column" marginTop={1}>
      <text
        fg={TONE_COLOR[props.section.tone as keyof typeof TONE_COLOR] ?? HEADER}
      >
        {`${props.section.label} (${count()})`}
      </text>
      <For each={props.section.files}>
        {(file) => (
          <FileRow
            file={file}
            tone={props.section.tone}
            termWidth={props.termWidth}
          />
        )}
      </For>
    </box>
  );
}

/** The whole board. Pure paint over the projected `view` plus the clock and
 *  `seq` accessor — exported so the headless Bun render test drives it
 *  directly. */
export function GitStatusBoard(props: {
  view: () => GitStatusView;
  clock: () => string;
}) {
  const dims = useTerminalDimensions();
  const termWidth = () => dims().width;
  const v = () => props.view();
  return (
    <box flexDirection="column" padding={1}>
      <text fg={TITLE}>
        {`git status  ·  ${v().repoName}${v().branch ? `  ·  ${v().branch}` : ""}  ·  ${props.clock()}  ·  ⟳ live  ·  seq ${v().seq}  ·  Ctrl-C to quit`}
      </text>
      {v().error !== null ? (
        <text fg={TONE_COLOR.fail}>{`\n${v().error}`}</text>
      ) : v().sections.length === 0 ? (
        <text fg={TONE_COLOR.muted}>
          {"\nworking tree clean — no staged, modified, or untracked files"}
        </text>
      ) : (
        <For each={v().sections}>
          {(section) => <Section section={section} termWidth={termWidth} />}
        </For>
      )}
      {v().branchComparison !== null && (
        <box flexDirection="row" marginTop={1}>
          <text fg={SUBTLE}>
            {`vs ${v().branchComparison?.ref}  ·  ${v().branchComparison?.fileCount} file${v().branchComparison?.fileCount === 1 ? "" : "s"}`}
          </text>
        </box>
      )}
    </box>
  );
}

/** Run the git-status board in the alt-screen until Ctrl-C. Reads the awareness
 *  collection once for the branch name, starts the pulse-then-requery loop, and
 *  paints the live view. Resolves once the renderer has torn down. */
export async function runGitStatusTui(args: {
  client: import("./connect.ts").ArivuClient;
  repoPath: string;
}): Promise<void> {
  const [update, setUpdate] = createSignal<GitStatusUpdate>({
    local: null,
    branch: null,
    seq: 0,
    error: null,
  });
  const [branch, setBranch] = createSignal<string | null>(null);

  let gitStatus: GitStatusHandle | undefined;

  function App() {
    const [clock, setClock] = createSignal(new Date());
    onMount(() => {
      const id = setInterval(() => setClock(new Date()), 1000);
      onCleanup(() => clearInterval(id));
    });

    // The view is projected from the latest update + branch name. The `seq`
    // counter in the title is the liveness proof — it increments on each repo
    // change, proving the pulse-then-requery loop is alive.
    const view = createMemo(() =>
      projectGitStatus(
        update().local,
        update().branch,
        branch(),
        args.repoPath,
        update().seq,
        update().error,
      ),
    );

    return (
      <GitStatusBoard view={view} clock={() => clock().toLocaleTimeString()} />
    );
  }

  // Start the data layer after importing the view (the view is Bun-only; the
  // data layer is transport-only and runs under Node too). The branch name is
  // read once from the awareness collection.
  const snap = await snapshotGitStatus(args.client, args.repoPath).catch(
    () => ({
      branch: null,
      local: null,
      branchMode: null,
    }),
  );
  setBranch(snap.branch);
  if (snap.local !== null) {
    setUpdate({
      local: snap.local,
      branch: snap.branchMode,
      seq: 0,
      error: null,
    });
  }

  gitStatus = startGitStatus({
    client: args.client,
    repoPath: args.repoPath,
    sink: { onStatus: setUpdate },
    log: () => {},
  });

  try {
    await runTui(() => <App />);
  } finally {
    gitStatus.dispose();
  }
}
