/** WHAT A PICKED WORK'S TERMINALS VIEW DRAWS, AND WHAT IT CONNECTS — the
 *  rules, apart from the panes that follow them.
 *
 *  A picked work's middle is one of two views: **Terminals**, a live pane per
 *  terminal, and **Details**, the record behind the face. One or two
 *  terminals stack; three or more, or a window too narrow for two panes to
 *  be read, become one pane with a tab per terminal.
 *
 *  A PANE IS CONNECTED ONLY WHILE IT IS ON SCREEN. Each connected pane holds
 *  a read of its terminal's screen open on the host, so a pane that cannot be
 *  seen — the Conductor behind a host tab, the Details view in front, a tab
 *  behind another — must not hold one. */

/** Which of the picked work's two views is in front. */
export type PickedView = "terminals" | "details";

/** How the Terminals view lays out its panes. */
export type PaneLayout = "stack" | "tabs";

/** The most terminals that stack; one more and they become tabs. */
export const MOST_STACKED = 2;

/** THE VIEW IN FRONT: the one a person chose for this pick, else Terminals
 *  while a terminal of the work is up — there is something live to watch —
 *  and Details while none is. */
export function pickedView(
  chosen: PickedView | undefined,
  anyUp: boolean,
): PickedView {
  return chosen ?? (anyUp ? "terminals" : "details");
}

/** Stacked, or tabbed: tabs for more than {@link MOST_STACKED} terminals,
 *  and for any number on a window too narrow to give each its own pane. */
export function paneLayout(count: number, narrow: boolean): PaneLayout {
  return narrow || count > MOST_STACKED ? "tabs" : "stack";
}

/** THE FRONT TAB: the one a person pressed while it is still one of the
 *  work's terminals, else the first. `undefined` for a work with none. */
export function frontPane(
  refs: readonly string[],
  chosen: string | undefined,
): string | undefined {
  return chosen !== undefined && refs.includes(chosen) ? chosen : refs[0];
}

/** THE PANES THAT HOLD A CONNECTION — every terminal whose pane is on screen,
 *  and none while the Terminals view itself is not: the Conductor is the
 *  shown view, the work is picked, Terminals is in front, and, when tabbed,
 *  only the front tab. */
export function connectedPanes(at: {
  shown: boolean;
  picked: boolean;
  view: PickedView;
  layout: PaneLayout;
  refs: readonly string[];
  front: string | undefined;
}): readonly string[] {
  if (!at.shown || !at.picked || at.view !== "terminals") return [];
  if (at.layout === "stack") return at.refs;
  return at.front === undefined ? [] : [at.front];
}
