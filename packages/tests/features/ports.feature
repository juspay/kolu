Feature: Ports section (PRT1)
  The Inspector answers "what is this terminal serving?". padi's port sensor
  scans the host every 5 seconds — plus an immediate off-schedule pass whenever
  a terminal produces output or runs a command — joins each listening TCP socket
  to the terminal subtree that holds it, and the port rides `TerminalSnapshot`
  onto the wire like every other terminal fact.

  This scenario is the one proof no client-side mock can give: it drives the
  WHOLE real path (a real listener in a real PTY → /proc join → snapshot → padi
  surface → the reconcile-backed store → the section), and it is the reason the
  scenario spawns an actual server rather than injecting a port.

  A port bound to 0.0.0.0 on the kolu server's own host already answers on the
  name in the address bar, so its chip opens directly — no forward involved.
  Loopback-bound ports get an inert "needs a forward" affordance that PRT2
  activates; nothing here forwards anything.

  Background:
    Given the terminal is ready

  Scenario: A spawned wildcard listener appears as an openable chip
    When I start a listener on port 8123 bound to all interfaces
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show an openable port chip for 8123
    Then the open link for port 8123 should point at the page's own host
    And there should be no page errors

  Scenario: A loopback-only listener is listed but waits for a forward
    When I start a listener on port 8124 bound to loopback only
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show port 8124 as needing a forward
    And there should be no page errors

  Scenario: A dev server in a SPLIT shows up on the tile
    # The case that made the feature invisible on a real deployment: people run
    # dev servers in a split. Each pane is its own PTY with its own process
    # subtree, so the scanner attributes the port to the SPLIT — and a section
    # that read only the main pane showed nothing at all, which is the common
    # case rather than an edge one. The Inspector reads the whole tile, exactly
    # as the Attach section already does.
    When I create a sub-terminal via command palette
    And I start a listener on port 8126 in the split terminal
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show an openable port chip for 8126
    And there should be no page errors

  Scenario: A port leaves the section when its server dies
    # The baseline tick's other job — port DEATH, which PRT2's auto-cancel rides
    # on. Ctrl+C ends the listener; the next scan re-samples the whole set, so
    # the chip goes away without anything having to publish a removal.
    When I start a listener on port 8125 bound to all interfaces
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show an openable port chip for 8125
    When I stop the listener
    Then the inspector should stop showing port 8125
    And there should be no page errors
