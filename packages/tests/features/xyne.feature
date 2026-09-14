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
