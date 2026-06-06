@recording
Feature: Screencast recordings
  Each scenario is one marketing clip for kolu.dev/welcome. Run under
  KOLU_X11CAP (via `just record`) to capture it; the per-scenario recording
  module owns the flow and its display properties.

  Background:
    Given the terminal is ready

  Scenario: new-terminal-demo
    When I record "new-terminal-demo"
