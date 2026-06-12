Feature: kaval daemon lifecycle (B2 — the door)
  The server is a client of a kaval daemon it spawns. When the daemon dies
  mid-session the canvas must say so honestly — an explicit degraded state,
  visibly distinct from "you have no terminals" (#1034's empty-canvas lie).

  Scenario: Killing kaval mid-session shows the honest degraded canvas
    Given the terminal is ready
    When the kaval daemon is killed
    Then the degraded canvas is shown
