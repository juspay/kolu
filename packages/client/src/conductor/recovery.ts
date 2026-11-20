import type {
  ConductorStoreKey,
  ConductorUnreadable,
} from "kolu-common/conductor";

export interface RecoveryOffer {
  readonly backupLabel: string | null;
  readonly emptyLabel: string;
  readonly emptyCopy: string;
}

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
  transcript: {
    backupLabel: "Restore the newest backup that reads",
    emptyLabel: "Start with an empty transcript",
  },
};

const keptAsideSentence = (unreadable: ConductorUnreadable): string =>
  `kolu keeps what it could not read in ${unreadable.keepsAt} — nothing is deleted — and the Conductor comes up with that record empty.`;

export function recoveryOffer(unreadable: ConductorUnreadable): RecoveryOffer {
  const offer = OFFERS[unreadable.key];
  return {
    backupLabel: unreadable.inBackups ? offer.backupLabel : null,
    emptyLabel: offer.emptyLabel,
    emptyCopy: keptAsideSentence(unreadable),
  };
}
