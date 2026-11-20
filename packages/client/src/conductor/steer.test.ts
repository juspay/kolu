import { describe, expect, it } from "vitest";
import { formatKeybind } from "../input/keyboard";
import { sendsAsSteer, STEER_KEYBIND, steerOnOffer } from "./steer";

describe("when steering is on offer", () => {
  it("needs both the cell's word and a turn to steer into", () => {
    expect(steerOnOffer({ steers: true, phase: "working" })).toBe(true);
    expect(steerOnOffer({ steers: true, phase: "asking" })).toBe(true);
    expect(steerOnOffer({ steers: true, phase: "idle" })).toBe(false);
    expect(steerOnOffer({ steers: false, phase: "working" })).toBe(false);
    expect(steerOnOffer({ steers: true, phase: "starting" })).toBe(false);
    expect(steerOnOffer({ steers: false, phase: "offline" })).toBe(false);
  });
});

describe("what Alt does to a send", () => {
  it("steers only with the chord AND the offer", () => {
    expect(sendsAsSteer(true, true)).toBe(true);
  });

  it("is a plain send off the offer — never a dead key", () => {
    expect(sendsAsSteer(true, false)).toBe(false);
  });

  it("leaves a plain Enter alone", () => {
    expect(sendsAsSteer(false, true)).toBe(false);
    expect(sendsAsSteer(false, false)).toBe(false);
  });
});

describe("the chord as the hint prints it", () => {
  it("is the platform's own spelling, like every other shortcut", () => {
    expect(formatKeybind(STEER_KEYBIND, false)).toBe("Alt+Enter");
    expect(formatKeybind(STEER_KEYBIND, true)).toBe("⌥Enter");
  });
});
