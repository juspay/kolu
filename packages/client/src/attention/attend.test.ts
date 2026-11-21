/** ONE PATH FOR EVERY ALERT. Each case is what a person would notice: two
 *  things needing them ring once rather than twice, a thing they are already
 *  looking at makes no popup, alerts off is silence, and a popup that fails
 *  does not take the sound down with it. */

import { describe, expect, it } from "vitest";
import {
  type AttentionItem,
  type AttendChannels,
  createAttend,
} from "./attend";

const one = (tag: string, inFront = false): AttentionItem => ({
  tag,
  title: `${tag} finished`,
  body: undefined,
  click: { kind: "conductor" },
  inFront,
});

function harness(alerts = true) {
  const sounds: number[] = [];
  const popups: AttentionItem[] = [];
  let throwOnPopup = false;
  const channels: AttendChannels = {
    alertsEnabled: () => alerts,
    sound: () => {
      sounds.push(sounds.length + 1);
    },
    popup: (item) => {
      if (throwOnPopup) throw new Error("no permission");
      popups.push(item);
    },
  };
  return {
    attend: createAttend(channels),
    sounds,
    popups,
    throwNextPopup: () => {
      throwOnPopup = true;
    },
    popupsWork: () => {
      throwOnPopup = false;
    },
  };
}

describe("the one path an alert takes", () => {
  it("plays one sound for two items and a popup for each, in order", () => {
    const { attend, sounds, popups } = harness();
    attend.raise([one("a"), one("b")]);
    expect(sounds).toHaveLength(1);
    expect(popups.map((item) => item.tag)).toEqual(["a", "b"]);
  });

  it("makes no popup for an item already in front of you, and still chimes", () => {
    const { attend, sounds, popups } = harness();
    attend.raise([one("a", true)]);
    expect(sounds).toHaveLength(1);
    expect(popups).toEqual([]);
  });

  it("is silent while alerts are off", () => {
    const { attend, sounds, popups } = harness(false);
    attend.raise([one("a")]);
    expect(sounds).toEqual([]);
    expect(popups).toEqual([]);
  });

  it("is silent when nothing is being raised", () => {
    const { attend, sounds } = harness();
    attend.raise([]);
    expect(sounds).toEqual([]);
  });

  it("survives a popup that throws, and the next raise still chimes", () => {
    const { attend, sounds, popups, throwNextPopup, popupsWork } = harness();
    throwNextPopup();
    expect(() => attend.raise([one("a")])).not.toThrow();
    expect(sounds).toHaveLength(1);
    expect(popups).toEqual([]);
    popupsWork();
    attend.raise([one("b")]);
    expect(sounds).toHaveLength(2);
    expect(popups.map((item) => item.tag)).toEqual(["b"]);
  });
});
