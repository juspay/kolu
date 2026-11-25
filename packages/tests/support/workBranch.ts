/** THE BRANCH A SCENARIO'S WORK IS ON — its title, lowercased, with every run
 *  of anything but a letter or a digit one `-`. The fixture conductor opens a
 *  work on this branch (`acp-fixture-agent.ts`), and the steps check it out
 *  in the scenario's repo, as a person's checkout would be: kolu asks git
 *  where the work's branch is checked out, and that folder is the work's. */
export const workBranchOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
