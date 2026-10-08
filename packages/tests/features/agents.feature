Feature: Agents come with kolu
  The welcome card asks once, at first run, which coding agents new terminals
  get; Settings → Agents is the same choice later. The choice puts
  agent-distro's coding agents on the PATH of NEW terminals, for the chosen
  profile. A running terminal keeps what it started with, and every tile says
  which profile it got. The suite starts every scenario never chosen, as a
  fresh install does.

  Scenario: Settings offers the Agents section with the build's profiles
    Given the terminal is ready
    When I click the settings button
    Then the settings popover should be visible
    And the Agents section should offer the "vanilla" and "juspay" profiles
    And there should be no page errors

  Scenario: Turning Agents on changes the next terminal, not the current one
    Given the terminal is ready
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
    Given the terminal is ready
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
    Given the terminal is ready
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
    Given the terminal is ready
    When I click the settings button
    Then the Agents hint should explain Off
    When I choose the "juspay" Agents profile
    Then a toast should say new terminals get the "juspay" agents
    And this machine's Agents status should be ready
    When I turn Agents off
    Then a toast should say agents are off
    And the Agents hint should explain Off
    And there should be no page errors

  Scenario: This machine's tab carries the agents mark while Agents are on, and it opens Settings
    Given the terminal is ready
    Then the host tab should show no agents mark
    When I click the settings button
    And I choose the "vanilla" Agents profile
    Then the host tab's agents mark should be "ready"
    When I press Escape
    Then the settings popover should not be visible
    When I click the host tab's agents mark
    Then the settings popover should be visible
    When I turn Agents off
    Then the host tab should show no agents mark
    And there should be no page errors

  Scenario: A terminal whose agents went stale restarts in place with the new ones
    Given the terminal is ready
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
    Then a toast should say the terminal restarted with the "juspay" agents
    And the focused tile should paint a fresh screen without "export X=1"
    And the focused tile should be the one I remembered
    And the focused tile should show the "juspay" agents chip
    And the terminal's claude should be the "juspay" fixture
    When I run 'echo "v=${X:-unset} pid=$([ "$(cat pid)" != "$$" ] && echo changed) cwd=$([ "$(cat here)" = "$(pwd -P)" ] && echo same)"'
    Then the active terminal should show "v=unset pid=changed cwd=same"
    And there should be no page errors

  Scenario: The first run asks which agents first, and Enter picks the default
    When I open the app
    Then the welcome card's first row should ask which agents I want
    And the first-run agents choice should have nothing chosen
    And keyboard focus should be on the first-run "vanilla" segment
    And the first-run step should say what "vanilla" means
    When I press Enter
    Then a toast should say new terminals get the "vanilla" agents
    And padi should give new terminals the "vanilla" agents
    And the welcome card should not ask about agents
    And the welcome card's done line should say agents are "vanilla"
    When I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I click the settings button
    Then the Agents control in Settings should show "vanilla" chosen
    And this machine's Agents status should be ready
    And there should be no page errors

  Scenario: The first run can pick Off from the keyboard
    When I open the app
    Then keyboard focus should be on the first-run "vanilla" segment
    When I press ArrowLeft
    Then keyboard focus should be on the first-run "off" segment
    And the first-run step should say what "off" means
    When I press ArrowLeft
    Then keyboard focus should be on the first-run "juspay" segment
    And the first-run step should say what "juspay" means
    When I press ArrowRight
    Then keyboard focus should be on the first-run "off" segment
    When I press Enter
    Then a toast should say agents are off
    And the welcome card should not ask about agents
    And the welcome card's done line should say agents are "off"
    When I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Once chosen, the first-run step never shows again and Settings shows the choice
    When I open the app
    And I choose the "juspay" first-run agents
    Then padi should give new terminals the "juspay" agents
    And the welcome card should not ask about agents
    When I start watching for the first-run step
    And I reload the page
    Then the welcome card's done line should say agents are "juspay"
    And the welcome card should not ask about agents
    And the first-run step should never have shown since
    When I click the settings button
    Then the Agents control in Settings should show "juspay" chosen
    And there should be no page errors

  Scenario: Ignoring the step opens a terminal without agents, and the Tutorial still asks
    When I open the app
    Then keyboard focus should be on the first-run "vanilla" segment
    When I create a terminal
    Then the focused tile should show no agents chip
    When I click the settings button
    Then the Agents control in Settings should have nothing chosen
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should ask which agents I want
    When I choose the "vanilla" first-run agents
    Then padi should give new terminals the "vanilla" agents
    And the Tutorial should not ask about agents
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should not ask about agents
    And the welcome card's done line should say agents are "vanilla"
    And there should be no page errors
