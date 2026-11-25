/** THE LINE UNDER A WORK'S TITLE — where it is and what it is.
 *
 *  A branch work leads with its repository's monogram and name and its
 *  branch, painted in the colours the Dock and the Inspector give the same
 *  two words: `identityColor` is a function of the word alone, so the same
 *  repository and branch wear the same hue wherever kolu draws them. Then the
 *  host, the mode and the PR as words (`workSubtitleParts`), and, while the
 *  work's own PR reading carries the PR live (`./workPr.ts`), the Dock's PR
 *  pip — its state, its checks dot, and a tooltip naming every check. The pip
 *  can only be the work's: it takes a {@link WorkPr}, which nothing but the
 *  work's own reading makes, and its number is the one the words name.
 *
 *  It is drawn inside faces whose own press is a button laid under the text,
 *  so the two links on it (the PR number and the pip) take their presses and
 *  nothing else does. */

import { PrPip } from "@kolu/solid-dockrow";
import { identityColor } from "@kolu/solid-dockrow/rowValues";
import { Option } from "effect";
import type { Work } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";
import RepoMonogram from "../ui/RepoMonogram";
import PrText from "./PrText";
import type { WorkPr } from "./workPr";
import { workHost, workSubtitleParts } from "./workReadings";

const WorkSubtitle: Component<{
  work: Work;
  /** The work's own PR, live (`useWorkPr`). */
  pr: Option.Option<WorkPr>;
}> = (props) => {
  const parts = createMemo(() =>
    workSubtitleParts(props.work, workHost(props.work)),
  );
  const branch = () => {
    const where = parts().where;
    return where.kind === "branch" ? where : undefined;
  };
  return (
    <span
      data-testid="work-subtitle"
      class="flex min-w-0 flex-1 items-center gap-1"
    >
      <Show when={branch()?.repo || undefined}>
        {(repo) => (
          <RepoMonogram
            group={repo()}
            color={identityColor(repo())}
            size="xs"
            data-testid="work-repo-monogram"
          />
        )}
      </Show>
      <span class="min-w-0 truncate">
        <Show when={branch()} fallback="watching">
          {(where) => (
            <>
              <Show when={where().repo !== ""}>{where().repo} · </Show>
              <span
                data-testid="work-branch"
                class="annotation-ink"
                style={{ "--annotation-color": identityColor(where().branch) }}
              >
                {where().branch}
              </span>
            </>
          )}
        </Show>
        <Show when={parts().rest.length > 0}>
          {" · "}
          <PrText work={props.work} text={parts().rest.join(" · ")} />
        </Show>
      </span>
      <Show when={Option.getOrUndefined(props.pr)}>
        {(pr) => (
          <span class="pointer-events-auto relative flex">
            <PrPip pr={pr()} />
          </span>
        )}
      </Show>
    </span>
  );
};

export default WorkSubtitle;
