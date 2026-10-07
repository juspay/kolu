Feature: Agents come with kolu
  Settings → Agents puts agent-distro's coding agents on the PATH of NEW
  terminals, for the chosen profile. A running terminal keeps what it started
  with, and every tile says which profile it got.

  Background:
    Given the terminal is ready

  Scenario: Settings offers the Agents section with the build's profiles
    When I click the settings button
    Then the settings popover should be visible
    And the Agents section should offer the "vanilla" and "juspay" profiles
    And there should be no page errors

  Scenario: Turning Agents on changes the next terminal, not the current one
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    When I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    And the terminal's claude should be the "vanilla" fixture
    And there should be no page errors

  Scenario: Switching profile reaches the next terminal, and off removes both
    When I click the settings button
    And I turn Agents on
    And I choose the "juspay" Agents profile
    Then padi should give new terminals the "juspay" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "juspay" agents chip
    And the terminal's claude should be the "juspay" fixture
    When I click the settings button
    And I turn Agents off
    Then padi should give new terminals no agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Clicking a tile's agents pill opens Settings at the Agents rows
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I click the focused tile's agents chip
    Then the settings popover should be visible
    And the Agents section should offer the "vanilla" and "juspay" profiles
    And there should be no page errors

  Scenario: Switching Agents says what happened, and the hint shows this machine's status
    When I click the settings button
    Then the Agents hint should say "Off. Pick a profile"
    When I choose the "juspay" Agents profile
    Then a toast should say "Agents: juspay for new terminals"
    And this machine's Agents status should say "ready · juspay"
    When I choose the "off" Agents profile
    Then a toast should say "Agents off for new terminals"
    And the Agents hint should say "Off. Pick a profile"
    And there should be no page errors

  Scenario: This machine's tab carries the agents mark while Agents are on, and it opens Settings
    Then the host tab should show no agents mark
    When I click the settings button
    And I choose the "vanilla" Agents profile
    Then the host tab's agents mark should be "ready"
    When I press Escape
    Then the settings popover should not be visible
    When I click the host tab's agents mark
    Then the settings popover should be visible
    When I choose the "off" Agents profile
    Then the host tab should show no agents mark
    And there should be no page errors

  Scenario: A terminal whose agents went stale restarts in place with the new ones
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I run 'cd "$(mktemp -d)" && cd "$(pwd -P)" && pwd -P > here && echo $$ > pid && export X=1'
    And I remember the focused tile
    And I click the settings button
    And I choose the "juspay" Agents profile
    Then padi should give new terminals the "juspay" agents
    When I press Escape
    Then the focused tile's agents chip should be stale with a Restart button
    When I click Restart on the focused tile
    Then a toast should say "Restarted with juspay"
    And the focused tile should paint a fresh screen without "export X=1"
    And the focused tile should be the one I remembered
    And the focused tile should show the "juspay" agents chip
    And the terminal's claude should be the "juspay" fixture
    When I run 'echo "v=${X:-unset} pid=$([ "$(cat pid)" != "$$" ] && echo changed) cwd=$([ "$(cat here)" = "$(pwd -P)" ] && echo same)"'
    Then the active terminal should show "v=unset pid=changed cwd=same"
    And there should be no page errors
