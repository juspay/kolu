/** A WORK'S WORKTREE, ONCE — the Right panel's own Work section (branch and
 *  repo chips, the pull request and its checks, odu's readout, the directory),
 *  about the worktree the work keeps on its own record.
 *
 *  It is the Right panel's section, not a copy: the section takes what it is
 *  about (`WorkSubject`), and this hands over the work's.
 *
 *  - With a member terminal up IN that worktree (on its host, its own git
 *    reading naming the same top folder), the git facts and the pull request
 *    are LIVE, off that terminal's record. A member standing in another
 *    checkout speaks for that checkout, never for this work.
 *  - With none, they are what the record holds: the repository and branch
 *    from the work's key, and no live pull request — the line under the
 *    title and the Pull request part say the one the timeline recorded.
 *    Whether the folder is a linked worktree is not claimed. The directory
 *    and odu need only a host and a path, so they stay.
 *  - A work kolu has not read a worktree for yet says so, in one line.
 *
 *  Drawn only for a work in progress: a finished one reads the copies kolu
 *  kept, and has no worktree to describe. */

import { decodeHostKey } from "kolu-common/hostKey";
import type { Work } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";
import { useOduLink } from "../right-panel/useOduLink";
import WorkSection, { type WorkSubject } from "../right-panel/WorkSection";
import type { MemberLine } from "./workFacts";
import { memberInWorktree } from "./workFile";
import { repoName } from "./workReadings";

/** The read worktree, as the section's subject. */
const Read: Component<{
  work: Work;
  host: string;
  path: string;
  members: ReadonlyArray<MemberLine>;
}> = (props) => {
  const hostKey = createMemo(() => decodeHostKey(props.host));
  const odu = useOduLink(hostKey);
  /** The member standing IN THE WORK'S WORKTREE, by the one rule
   *  (`memberInWorktree`): the one whose record the live facts are read off.
   *  A member standing in another checkout speaks for that checkout, not for
   *  this work. */
  const live = createMemo(() =>
    memberInWorktree(props.host, props.path, props.members),
  );
  const subject = (): WorkSubject => {
    const key = props.work.key;
    const fact = live();
    return {
      host: hostKey(),
      git:
        fact !== null
          ? fact.git
          : key.kind === "branch"
            ? {
                repoName: repoName(key.repo),
                branch: key.branch,
                // No git reading says whether this folder is a linked
                // worktree, so nothing that depends on it is drawn.
                isWorktree: null,
                repoRoot: props.path,
                mainRepoRoot: key.repo,
              }
            : null,
      pr: fact?.pr ?? null,
      checkout: props.path,
      directory: props.path,
    };
  };
  return <WorkSection subject={subject()} odu={odu} />;
};

const WorkWorktree: Component<{
  work: Work;
  members: ReadonlyArray<MemberLine>;
}> = (props) => (
  <Show when={props.work.state.kind === "open"}>
    <section data-testid="work-worktree" class="mb-2">
      <Show
        when={
          props.work.worktree.kind === "read" ? props.work.worktree : undefined
        }
        fallback={
          <p
            data-testid="work-worktree-unread"
            class="m-0 font-mono text-[0.62rem] text-fg-3"
          >
            kolu has not read where this work is working yet.
          </p>
        }
      >
        {(at) => (
          <Read
            work={props.work}
            host={at().host}
            path={at().path}
            members={props.members}
          />
        )}
      </Show>
    </section>
  </Show>
);

export default WorkWorktree;
