/**
 * WHO ASKED for a file watch — the labels padi hands kolu-git and kolu-io,
 * which know nothing about terminals or streams. The one place their format is
 * spelled, so the diagnostics answer names every asker the same way.
 *
 * A Conductor work is named by its BRANCH: padi cannot see a work id (it stops
 * at kolu-server), and a work is keyed `(host, repo, branch)`, so the
 * `pullRequest` and `branchCheckout` streams' branch identifies it without
 * widening the wire.
 */

export const askerLabel = {
  /** A terminal's git sensor (HEAD, config, or `.git` appearing in its cwd). */
  terminal: (id: string): string => `terminal ${id}`,
  /** A client's Code-tab repo pulse. */
  repoChangeStream: "stream subscribeRepoChange",
  /** A client's open-file pulse. */
  fileChangeStream: (filePath: string): string =>
    `stream subscribeFileChange (${filePath})`,
  /** A branch's pull-request watch — how a Conductor work follows its PR. */
  pullRequestStream: (branch: string): string =>
    `stream pullRequest (branch ${branch})`,
  /** A branch's checkout watch — how a Conductor work follows its folder. */
  branchCheckoutStream: (branch: string): string =>
    `stream branchCheckout (branch ${branch})`,
} as const;
