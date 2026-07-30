Feature: Ports section and forwards (PRT1 + PRT2)
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
  A loopback-bound port on that same host needs a door, and PRT2 opens one on
  the first click: an in-process TCP relay from `0.0.0.0:<picked>` to
  `127.0.0.1:<port>`. That case runs end to end here, because both ends are on
  the machine the suite already has.

  The REMOTE-host case (an `ssh -L` child) is deliberately absent: it needs a
  real second box, and it is verified with the remote-host-testing harness
  rather than pretended at with a loopback stand-in that would exercise the
  wrong mechanism.

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

  Scenario: Clicking a loopback port forwards it and loads the page
    # PRT2's headline, on the one mechanism this harness can exercise for real:
    # the relay. A loopback listener is invisible from any other machine, so the
    # click has to open a door on 0.0.0.0 before there is anything to point a tab
    # at — and the proof is the listener's OWN body arriving in that tab, through
    # a port that is not the one the server bound.
    When I start a listener on port 8127 bound to loopback only
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show port 8127 as needing a forward
    When I click forward-and-open for port 8127
    Then the forwarded tab should load the listener's page
    And the inspector should show a forward badge for port 8127
    And the ports section should show port 8127 as forwarded
    And there should be no page errors

  Scenario: A dev server on the v6 loopback forwards to the v6 loopback
    # The production defect, end to end. `[::1]` and `127.0.0.1` are both
    # loopback and are NOT the same address, and the first cut of PRT2 folded
    # them into one `scope` and then dialled v4 for both. The unit suites pin
    # scanning and relay behavior independently; this scenario retains the
    # cross-package composition proof from listener discovery through the UI.
    When I start a listener on port 8129 bound to the v6 loopback only
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show port 8129 as needing a forward
    When I click forward-and-open for port 8129
    Then the forwarded tab should load the listener's page
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
