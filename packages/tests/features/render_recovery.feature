Feature: Render-stall recovery
  When a window is occluded, Chromium stops producing frames and xterm's single
  requestAnimationFrame-driven paint never fires — output keeps landing in the
  buffer but the screen stays on a stale frame until an input event forces a
  repaint. (The freeze PRs #1235 and #1273 did not fix.) Returning focus to the
  window must force a synchronous repaint to the latest output.

  Real OS occlusion can't be reproduced in a headless browser, so this stalls
  the focused terminal's render loop directly (swallowing the debounced/async
  refresh the way a parked rAF would, while letting the forced SYNCHRONOUS
  refresh through) and verifies the recovery path the fix wires to window focus.

  Background:
    Given the terminal is ready

  Scenario: Regaining window focus repaints a render-stalled terminal
    When I stall the focused terminal's render loop
    And I generate 30 lines of output
    Then the latest output is in the buffer but the screen has not repainted
    When the window regains focus
    Then the terminal force-repaints to the latest output
