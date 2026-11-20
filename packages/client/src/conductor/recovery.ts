/** WHAT THE TWO BUTTONS UNDER AN UNREADABLE RECORD SAY — one table, per
 *  record, so the panel holds no prose of its own and a test can read the
 *  whole offer without mounting anything.
 *
 *  The sentence a person reads is the SERVER's (`state().refusal`): it says
 *  what happened. This is the other half — what kolu can do about it — and it
 *  is the client's because it is button copy, drawn off the record the server
 *  named (`state().unreadable.key`).
 *
 *  Two offers, never three, and never "edit the file": restore the newest
 *  backup that reads, or start with that record empty and the unreadable one
 *  kept aside.
 */

import type {
  ConductorStoreKey,
  ConductorUnreadable,
} from "kolu-common/conductor";

export interface RecoveryOffer {
  /** The backup button's label, or `null` where there is no backup to offer.
   *
   *  The transcript is the one: kolu's state-backup ring snapshots
   *  `config.json` and nothing else (the rows are most of the conversation's
   *  bytes and move on every keystroke), so there is no saved copy of that
   *  file anywhere and a button promising one would be a lie a person finds
   *  out about by pressing it. The server refuses it in the same words if it
   *  is ever asked. */
  readonly backupLabel: string | null;
  /** The empty button's label — what the Conductor STARTS WITH, said as the
   *  outcome rather than as the loss ("Start with no works", not "Discard
   *  works"), because nothing is discarded: the unreadable value is kept. */
  readonly emptyLabel: string;
  /** The confirm step's copy. It NAMES the file the unreadable value is kept
   *  in — the directory and the name it is given — because a confirm that
   *  says "nothing is deleted" without saying where it went is asking for
   *  trust rather than giving a fact. */
  readonly emptyCopy: string;
}

/** Each record's two offers — the BUTTON LABELS, which are the browser's own
 *  English, and nothing else. `conductor` is the conversation's own record —
 *  the session id and the fleet it remembered — which is why its empty arm
 *  says "a fresh conversation": the rows are the transcript's, and they stay
 *  where they are.
 *
 *  Whether a record is IN THE BACKUPS is the host's fact, not a label: a
 *  `backupLabel` is offered only where the refusal says there is one to
 *  restore. */
const OFFERS: Record<
  ConductorStoreKey,
  { backupLabel: string; emptyLabel: string }
> = {
  works: {
    backupLabel: "Restore the newest backup that reads",
    emptyLabel: "Start with no works",
  },
  members: {
    backupLabel: "Restore the newest backup that reads",
    emptyLabel: "Start with no remembered terminals",
  },
  conductor: {
    backupLabel: "Restore the newest backup that reads",
    emptyLabel: "Start a fresh conversation",
  },
  memory: {
    backupLabel: "Restore the newest backup that reads",
    emptyLabel: "Start with nothing remembered",
  },
  transcript: {
    backupLabel: "Restore the newest backup that reads",
    emptyLabel: "Start with an empty transcript",
  },
};

/** The offer for the record kolu could not read. */
export function recoveryOffer(unreadable: ConductorUnreadable): RecoveryOffer {
  const offer = OFFERS[unreadable.key];
  return {
    // A record the host keeps no backup of has no backup to offer, and the
    // refusal is what knows that — the browser never infers it from the key.
    backupLabel: unreadable.inBackups ? offer.backupLabel : null,
    emptyLabel: offer.emptyLabel,
    // WHERE IT GOES IS THE SERVER'S ANSWER, quoted. The path depends on the
    // host's state root and on a stamp only the writer mints, so a browser
    // that rebuilt it by string surgery was making a promise about a file
    // that might not exist (#2376 review).
    emptyCopy: `kolu keeps what it could not read in ${unreadable.keepsAt} — nothing is deleted — and the Conductor comes up with that record empty.`,
  };
}
