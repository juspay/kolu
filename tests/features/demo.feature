@demo
Feature: Demo recording
  Record a feature showcase driven by the tips system — each act
  demonstrates a feature that an ambient or contextual tip advertises.

  Scenario: Feature showcase via tips
    # Setup: clean tip state so toasts fire fresh
    Given the terminal is ready
    And tips state is cleared
    And frame capture is started

    # Act 1: First terminal + startup tip
    # (startup tip fires 1s after first terminal — shows a random ambient tip)
    When I reload the page
    And I wait 2 seconds

    # Act 2: Run a command to show terminal in action
    When I run "echo 'Welcome to kolu! 🚀'"
    And I wait 2 seconds

    # Act 3: Create more terminals (Mission Control tip fires at 3+)
    When I create a terminal
    And I run "ls --color /etc"
    And I wait 1 second
    When I create a terminal
    And I run "uname -a"
    And I wait 3 seconds

    # Act 4: Mission Control — bird's eye view of all terminals
    When I press the Mission Control shortcut
    And I wait 3 seconds
    When I press Escape
    And I wait 1 second

    # Act 5: Theme randomization (Mod+J — advertised by amb-random-theme tip)
    When I press the random theme shortcut
    And I wait 2 seconds

    # Act 6: Sub-panel split (Ctrl+` — advertised by amb-sub tip)
    When I create a sub-terminal via command palette
    And I wait 1 second
    When I run "echo 'sub-panel split!'" in the sub-terminal
    And I wait 2 seconds

    # Act 7: Quick terminal switch (Mod+1 — advertised by sidebar-switch tip)
    When I press the switch to terminal 1 shortcut
    And I wait 2 seconds

    # Act 8: Command palette theme browsing (Mod+K → Theme)
    When I open the command palette
    And I wait 1 second
    When I type "Theme" in the palette
    And I select "Theme" in the palette
    And I wait 2 seconds
    When I press Escape
    And I wait 1 second

    Then frame capture is stopped
