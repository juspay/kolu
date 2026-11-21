/** THE PLATFORM CHANNELS an alert can reach a person through — a sound and an
 *  OS notification — and the master switch over both.
 *
 *  The ONLY file in the client that builds an `Audio` or calls the shared
 *  `notify` seam. `attention/attend.ts` owns WHEN and WHICH; this owns HOW,
 *  so the platform landmines (an autoplay-policy block, a refused permission)
 *  are handled in one place. */

import { notify } from "../attentionNotify";
import type { AttentionItem, AttendChannels } from "./attend";

export function attentionChannels(
  alertsEnabled: () => boolean,
): AttendChannels {
  return {
    alertsEnabled,
    sound() {
      const audio = new Audio("/sounds/notification.mp3");
      audio.play().catch((err: unknown) => {
        // An autoplay-policy block (no user gesture yet) or an unsupported codec is
        // EXPECTED and benign — but surface it (never a silent collapse) so a broken
        // sound channel is distinguishable from success. `debug` keeps the expected
        // autoplay-block out of the warning stream while still being observable.
        console.debug("attention: notification sound did not play", err);
      });
    },
    popup(item: AttentionItem) {
      void notify.show({
        tag: item.tag,
        title: item.title,
        body: item.body,
        icon: "/favicon.svg",
        data: item.click,
      });
    },
  };
}
