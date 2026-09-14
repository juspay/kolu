@xyne-mock
Feature: Xyne status detection
  When Xyne (`xyne`) is running in a terminal, the canvas tile chrome and
  the dock show its badge with the waiting state (Xyne's persisted
  transcript carries no live phase, so no busy/attention states derive).

  Requires KOLU_XYNE_DIR to point at a test-controlled directory and a fake
  binary so the foreground-basename check passes without a real Xyne
  install. Both are seeded by hooks.ts.

  Background:
    Given the terminal is ready

  Scenario: Tile chrome lights up with the Xyne badge
    When a Xyne session is mocked
    Then the tile chrome should show a Xyne indicator with state "waiting"
    And there should be no page errors

  Scenario: An idle Xyne that keeps repainting its cursor stops spinning
    # Xyne's OpenTUI renderer re-emits a cursor-park frame ~30x/s while
    # visually idle (no cell changes). Those bytes used to count as terminal
    # activity, so the waiting agent's post-turn window never closed and the
    # pip spun forever after Xyne stopped responding.
    When a Xyne session is mocked with an idle cursor repaint loop
    Then the tile chrome should show a Xyne indicator with state "waiting"
    And the tile title state pip should stop moving
    And there should be no page errors
