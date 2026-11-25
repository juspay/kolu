/** A WORK'S WORKTREE, ONCE — the Right panel's own Work section (branch and
 *  repo chips, the pull request and its checks, odu's readout, the directory),
 *  about the folder the work keeps on its own record.
 *
 *  It is the Right panel's section, not a copy: the section takes what it is
 *  about (`WorkSubject`), and this hands over the work's. Every fact in it is
 *  the WORK's, and none is read off a member terminal:
 *
 *  - the branch is the work's key, the repository the root git said for it
 *    (`rootOf`). A key whose root git has not said draws no repository part
 *    — the section's own "before git said" — rather than guess one off the
 *    folder the work was opened in;
 *  - the folder is git's last answer for that key (`Work.worktree`), and it
 *    is a linked worktree exactly when it is not that root;
 *  - the pull request is the work's own (`./workPr.ts`). With no live
 *    reading, the line under the title and the Pull request part say the one
 *    the timeline recorded.
 *
 *  A work whose folder git has not been asked about yet says so, in one line;
 *  so does a work whose branch is checked out nowhere on its host.
 *
 *  Drawn only for a work in progress: a finished one reads the copies kolu
 *  kept, and has no worktree to describe. */

import { Option } from "effect";
import { decodeHostKey } from "kolu-common/hostKey";
import { hostOf, rootOf, type Work } from "kolu-work";
import { type Component, createMemo, Match, Show, Switch } from "solid-js";
import { useOduLink } from "../right-panel/useOduLink";
import WorkSection, { type WorkSubject } from "../right-panel/WorkSection";
import { WORKTREE_ABSENT, WORKTREE_UNREAD } from "./workFile";
import type { WorkPr } from "./workPr";
import { repoName } from "./workReadings";

/** The folder git named, as the section's subject. */
const At: Component<{
  work: Work;
  path: string;
  pr: Option.Option<WorkPr>;
}> = (props) => {
  const hostKey = createMemo(() => decodeHostKey(hostOf(props.work)));
  const odu = useOduLink(hostKey);
  const subject = (): WorkSubject => {
    const key = props.work.key;
    return {
      host: hostKey(),
      git:
        key.kind === "branch"
          ? Option.match(rootOf(key), {
              onNone: () => null,
              onSome: (root) => ({
                repoName: repoName(root),
                branch: key.branch,
                isWorktree: props.path !== root,
                repoRoot: props.path,
                mainRepoRoot: root,
              }),
            })
          : null,
      pr: Option.match(props.pr, {
        onNone: () => null,
        onSome: (value) => ({ kind: "ok" as const, value }),
      }),
      checkout: props.path,
      directory: props.path,
    };
  };
  return <WorkSection subject={subject()} odu={odu} />;
};

/** One line, where a folder would be. */
const Line: Component<{ testid: string; words: string }> = (props) => (
  <p data-testid={props.testid} class="m-0 font-mono text-[0.62rem] text-fg-3">
    {props.words}
  </p>
);

const WorkWorktree: Component<{
  work: Work;
  /** The work's own PR, live (`useWorkPr`). */
  pr: Option.Option<WorkPr>;
}> = (props) => (
  <Show when={props.work.state.kind === "open"}>
    <section data-testid="work-worktree" class="mb-2">
      <Switch>
        <Match
          when={
            props.work.worktree.kind === "at" ? props.work.worktree : undefined
          }
        >
          {(at) => <At work={props.work} path={at().path} pr={props.pr} />}
        </Match>
        <Match when={props.work.worktree.kind === "absent"}>
          <Line testid="work-worktree-absent" words={WORKTREE_ABSENT} />
        </Match>
        <Match when={props.work.worktree.kind === "unread"}>
          <Line testid="work-worktree-unread" words={WORKTREE_UNREAD} />
        </Match>
      </Switch>
    </section>
  </Show>
);

export default WorkWorktree;
