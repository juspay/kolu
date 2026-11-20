import { When } from "@cucumber/cucumber";
import { getRecording } from "../screencast/recordings";
import { applyDisplay } from "../screencast/recordings/display";
import { setActiveTheme } from "../screencast/recordings/helpers";
import type { KoluWorld } from "../support/world";

When(
  "I record {string}",
  { timeout: 360_000 },
  async function (this: KoluWorld, name: string) {
    const recording = getRecording(name);
    setActiveTheme(recording.theme);
    await applyDisplay(this, recording.display);
    await recording.drive(this);
  },
);
