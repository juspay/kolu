import { When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world";
import { getRecording } from "../screencast/recordings";
import { applyDisplay } from "../screencast/recordings/display";
import { setActiveTheme } from "../screencast/recordings/helpers";

// Dispatcher: run a named recording. The engine (KOLU_X11CAP, in hooks.ts)
// handles the Xvfb/app-mode/x11grab/transcode around this step; here we apply
// the recording's theme + display properties and drive its flow.
//
// Long timeout: a recording drives a real flow — including waiting for a live
// agent to finish answering (dock → awaiting) — which far exceeds the harness's
// default per-step budget.
When(
  "I record {string}",
  { timeout: 240_000 },
  async function (this: KoluWorld, name: string) {
    const recording = getRecording(name);
    setActiveTheme(recording.theme);
    await applyDisplay(this, recording.display);
    await recording.drive(this);
  },
);
