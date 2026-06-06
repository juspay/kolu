import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world";
import { getRecording } from "../screencast/recordings";
import { applyDisplay } from "../screencast/recordings/display";

// Dispatcher: run a named recording. The engine (KOLU_X11CAP, in hooks.ts)
// handles the Xvfb/app-mode/x11grab/transcode around this step; here we just
// apply the recording's display properties and drive its flow.
When("I record {string}", async function (this: KoluWorld, name: string) {
  const recording = getRecording(name);
  await applyDisplay(this, recording.display);
  await recording.drive(this);
});
