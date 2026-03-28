@demo
Feature: Demo recording
  Record a feature showcase driven by the tips system — each act
  demonstrates a feature that an ambient or contextual tip advertises.

  Scenario: Feature showcase via tips
    # Setup: clean tip state, cd to repo for git sidebar status
    Given the terminal is ready
    And tips state is cleared
    And frame capture is started

    # Act 1: Enter the repo (triggers git branch + repo name in sidebar)
    When I reload the page
    And I wait 1 second
    When I cd to the project root
    And I wait 2 seconds

    # Act 2: Run a command
    When I announce "Terminal"
    And I run "ls --color"
    And I wait 2 seconds

    # Act 3: Create more terminals (Mission Control tip fires at 3+)
    When I create a terminal
    And I cd to the project root
    And I announce "Multiple terminals"
    And I run "git log --oneline -5"
    And I wait 1 second
    When I create a terminal
    And I cd to the project root
    And I announce "Git context in sidebar"
    And I run "git status --short"
    And I wait 3 seconds

    # Act 4: Mission Control — bird's eye view of all terminals
    When I announce "Mission Control"
    And I wait 1 second
    When I press the Mission Control shortcut
    And I wait 3 seconds
    When I press Escape
    And I wait 1 second

    # Act 5: Theme randomization (Mod+J — advertised by amb-random-theme tip)
    When I announce "Random theme"
    And I wait 1 second
    When I press the random theme shortcut
    And I wait 2 seconds

    # Act 6: Sub-panel split (Ctrl+` — advertised by amb-sub tip)
    When I announce "Sub-panel split"
    And I wait 1 second
    When I create a sub-terminal via command palette
    And I wait 1 second
    When I run "echo 'sub-panel ready!'" in the sub-terminal
    And I wait 2 seconds

    # Act 7: Quick terminal switch (Mod+1 — advertised by sidebar-switch tip)
    When I press the switch to terminal 1 shortcut
    And I wait 1 second
    When I announce "Keyboard switching"
    And I wait 2 seconds

    # Act 8: Command palette theme browsing (Mod+K → Theme)
    When I announce "Theme palette"
    And I wait 1 second
    When I open the command palette
    And I wait 1 second
    When I type "Theme" in the palette
    And I select "Theme" in the palette
    And I wait 2 seconds
    When I press Escape
    And I wait 1 second

    Then frame capture is stopped
