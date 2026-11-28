import type { AttentionClick } from "../attentionNotify";

/** ONE THING THAT WANTS THE HUMAN'S ATTENTION — what every source hands
 *  over, and all it hands over. */
export interface AttentionItem {
  /** The OS notification's replace key. */
  readonly tag: string;
  readonly title: string;
  readonly body: string | undefined;
  /** Where a click on the notification goes. */
  readonly click: AttentionClick;
  /** Is the place this item lives already in front of the human? */
  readonly inFront: boolean;
}

/** The ways of reaching the human. */
export interface AttendChannels {
  sound(): void;
  popup(item: AttentionItem): void;
}

export interface Attend {
  /** Reach the human about these items: one chime for the lot, and an OS
   *  notification for each one that is not already in front of them.
   *
   *  `alertsEnabled` is the master switch AS OF THE READING that raised them:
   *  raising happens in an effect's imperative phase, where reading the
   *  preference would be a strict read, so the source reads it in its compute
   *  phase and the rule over it stays here. */
  raise(items: ReadonlyArray<AttentionItem>, alertsEnabled: boolean): void;
}

/** THE ONE PATH EVERY ALERT TAKES. Sources — the terminals' engine and the
 *  Conductor's bell — only say WHAT wants the human, whether it is already in
 *  front of them and whether alerts are on; the switch, the sound and the
 *  popups are decided here, once, and nowhere else. A throw from a channel is
 *  surfaced and does not escape: a popup the browser refused must not take
 *  down the effect that raised it. */
export function createAttend(channels: AttendChannels): Attend {
  return {
    raise(items, alertsEnabled) {
      if (items.length === 0 || !alertsEnabled) return;
      try {
        channels.sound();
        for (const item of items) if (!item.inFront) channels.popup(item);
      } catch (err) {
        console.error("attention: delivery failed", err);
      }
    },
  };
}
