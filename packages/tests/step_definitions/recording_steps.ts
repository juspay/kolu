import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world";
import { getRecording } from "../screencast/recordings";
import { applyDisplay } from "../screencast/recordings/display";
import { setActiveTheme } from "../screencast/recordings/helpers";

// Dispatcher: run a named recording. The engine (KOLU_X11CAP, in hooks.ts)
// handles the Xvfb/app-mode/x11grab/transcode around this step; here we apply
// the recording's theme + display properties and drive its flow.
When("I record {string}", async function (this: KoluWorld, name: string) {
  const recording = getRecording(name);
  setActiveTheme(recording.theme);
  await applyDisplay(this, recording.display);
  await recording.drive(this);
});
