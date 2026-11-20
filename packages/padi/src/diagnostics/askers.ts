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
} as const;
