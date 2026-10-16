Feature: Agents come with kolu
  Until agents are on, the welcome card asks for them; Turn on takes them with
  the profiles the step holds (none, or Juspay by one click), Not now leaves the
  question for later. Settings → Agents is a switch and a list: the switch puts
  agent-distro's coding agents on the PATH of NEW terminals, and the list stacks
  profiles over them, in order — empty is the agents as they ship, and a
  repository's own agent-distro.nix always composes last. A running terminal
  keeps what it started with, and every tile says what it got. What each
  MACHINE has lives in that machine's host details. The suite starts every
  scenario never chosen, as a fresh install does. (kolu-server builds each
  profile and delivers it with agent-distro's package; the suite's kolu-server
  is built from source and bakes no delivery, so with an empty list this
  machine serves its floor, and with any profile in the list padi has no set
  for that stack and new terminals get no agents. Profile delivery is
  unit-tested in kolu-server and padi.)

  Scenario: Settings offers the Agents switch, off until chosen
    Given the terminal is ready
    When I click the settings button
    Then the settings popover should be visible
    And the Agents switch in Settings should be off
    And the Agents hint should explain Off
    And the Agents row should name the agents it would bring
    And there should be no page errors

  Scenario: Turning Agents on reaches the next terminal, not the current one
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    Then a toast should say new terminals get the coding agents
    And the stored Agents profiles should be empty
    And padi should give new terminals the agents with no profiles
    And the Agents profile list should be empty
    And the Agents profile list should end with the repository row
    When I press Escape
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    When I create a terminal
    Then the focused tile's agents chip should show only the build it serves
    And the terminal's AI_PROFILE should be unset
    And the terminal's claude should be the fixture
    And the terminal's agent-distro should be the fixture picker
    And there should be no page errors

  Scenario: Adding Juspay and a reference of your own writes the stack, and padi has no agents for it
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the agents with no profiles
    When I add the Juspay profile
    Then the stored Agents profiles should be "github:juspay/skills"
    And a toast should say new terminals get the coding agents with "github:juspay/skills"
    And the "github:juspay/skills" profile row should be resolving
    And the Juspay profile should not be offered
    When I add the "github:me/my-profile" profile
    Then the stored Agents profiles should be "github:juspay/skills github:me/my-profile"
    And a toast should say new terminals get the coding agents with "github:juspay/skills github:me/my-profile"
    And the Agents profile rows should be "github:juspay/skills github:me/my-profile"
    And the "github:me/my-profile" profile row should be resolving
    And the Agents profile list should end with the repository row
    And padi should give new terminals no agents for "github:juspay/skills github:me/my-profile"
    And the host tab should show no agents mark
    When I press Escape
    And I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Reordering and removing rewrite the stack, and an empty list brings the agents back
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    And I add the Juspay profile
    And I add the "github:me/my-profile" profile
    Then the stored Agents profiles should be "github:juspay/skills github:me/my-profile"
    When I move the "github:me/my-profile" profile up
    Then the stored Agents profiles should be "github:me/my-profile github:juspay/skills"
    And the Agents profile rows should be "github:me/my-profile github:juspay/skills"
    When I move the "github:me/my-profile" profile down
    Then the stored Agents profiles should be "github:juspay/skills github:me/my-profile"
    When I remove the "github:juspay/skills" profile
    Then the stored Agents profiles should be "github:me/my-profile"
    And the Agents profile rows should be "github:me/my-profile"
    And the Juspay profile should be offered
    And padi should give new terminals no agents for "github:me/my-profile"
    When I remove the "github:me/my-profile" profile
    Then the stored Agents profiles should be empty
    And the Agents profile list should be empty
    And the Agents profile list should end with the repository row
    And padi should give new terminals the agents with no profiles
    When I press Escape
    And I create a terminal
    Then the focused tile's agents chip should show only the build it serves
    And the terminal's claude should be the fixture
    And there should be no page errors

  Scenario: Switching Agents says what happened, and off removes the agents from the next terminal
    Given the terminal is ready
    When I click the settings button
    Then the Agents hint should explain Off
    When I turn Agents on
    Then a toast should say new terminals get the coding agents
    And the Agents fleet line should say this machine is ready
    When I turn Agents off
    Then a toast should say agents are off
    And padi should give new terminals no agents
    And the Agents hint should explain Off
    And the Agents profile list should not show
    When I press Escape
    And I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Clicking a tile's agents pill opens Settings at the Agents rows
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the agents with no profiles
    When I press Escape
    And I create a terminal
    Then the focused tile's agents chip should show only the build it serves
    When I click the focused tile's agents chip
    Then the settings popover should be visible
    And the Agents switch in Settings should be on
    And the Agents profile list should be empty
    And there should be no page errors

  Scenario: This machine's tab carries the agents mark while Agents are on, and it opens its host details
    Given the terminal is ready
    Then the host tab should show no agents mark
    When I click the settings button
    And I turn Agents on
    Then the host tab's agents mark should be "ready"
    When I press Escape
    Then the settings popover should not be visible
    When I click the host tab's agents mark
    Then this machine's host details should show its agents section
    And the agents section should name no profiles with the build it serves
    And the agents section should offer to check for newer agents
    When I press Escape
    And I click the settings button
    And I turn Agents off
    Then the host tab should show no agents mark
    And there should be no page errors

  Scenario: A machine's name on the Agents fleet line opens its details, at a width with no host tabs
    Given the terminal is ready
    When I resize the viewport to 700x1200
    And I click the settings button
    And I turn Agents on
    Then the Agents fleet line should say this machine is ready
    And the host tab's agents mark should not be on screen
    When I click this machine's name on the Agents fleet line
    Then this machine's host details should show its agents section
    And the agents section names this machine by its hostname
    And there should be no page errors

  Scenario: A terminal whose agents went stale waits for agents to restart into, then restarts in place
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the agents with no profiles
    When I press Escape
    And I create a terminal
    Then the focused tile's agents chip should show only the build it serves
    When I run 'cd "$(mktemp -d)" && cd "$(pwd -P)" && pwd -P > here && echo $$ > pid && export X=1'
    And I remember the focused tile
    And I click the settings button
    And I add the Juspay profile
    Then padi should give new terminals no agents for "github:juspay/skills"
    When I press Escape
    Then the focused tile's agents chip should be stale without a Restart button
    When I click the settings button
    And I turn Agents off
    Then padi should give new terminals no agents
    When I press Escape
    Then the focused tile's agents chip should be stale with a Restart button
    When I click Restart on the focused tile
    Then a toast should say the terminal restarted as a plain shell
    And the focused tile should paint a fresh screen without "export X=1"
    And the focused tile should be the one I remembered
    And the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    When I run 'echo "v=${X:-unset} pid=$([ "$(cat pid)" != "$$" ] && echo changed) cwd=$([ "$(cat here)" = "$(pwd -P)" ] && echo same)"'
    Then the active terminal should show "v=unset pid=changed cwd=same"
    And there should be no page errors

  Scenario: The first run offers Juspay by one click, and Enter turns the agents on as they ship
    When I open the app
    Then the welcome card's first row should ask which agents I want
    And the first-run step should offer Juspay over an empty list
    And keyboard focus should be on the first-run Turn on button
    And the first-run step should say what kolu can bring
    When I press Enter
    Then a toast should say new terminals get the coding agents
    And the stored Agents profiles should be empty
    And padi should give new terminals the agents with no profiles
    And the welcome card should not ask about agents
    And the welcome card's done line should say agents are on
    When I create a terminal
    Then the focused tile's agents chip should show only the build it serves
    And the terminal's AI_PROFILE should be unset
    When I click the settings button
    Then the Agents switch in Settings should be on
    And the Agents profile list should be empty
    And the Agents fleet line should say this machine is ready
    And there should be no page errors

  Scenario: Juspay added in the first-run step is written only by Turn on
    When I open the app
    Then the welcome card's first row should ask which agents I want
    When I add the Juspay profile in the first-run step
    Then the first-run step's profile rows should be "github:juspay/skills"
    And Agents should still be off with no profiles
    When I press Enter
    Then a toast should say new terminals get the coding agents with "github:juspay/skills"
    And the stored Agents profiles should be "github:juspay/skills"
    And padi should give new terminals no agents for "github:juspay/skills"
    When I click the settings button
    Then the Agents switch in Settings should be on
    And the Agents profile rows should be "github:juspay/skills"
    And the "github:juspay/skills" profile row should be resolving
    And there should be no page errors

  Scenario: Not now leaves nothing chosen, and the next load asks again
    When I open the app
    Then the welcome card's first row should ask which agents I want
    When I press Not now on the first-run step
    Then the welcome card should not ask about agents
    And the welcome card's done line should not mention agents
    When I click the settings button
    Then the Agents switch in Settings should be off
    When I press Escape
    And I reload the page
    Then the welcome card's first row should ask which agents I want
    And there should be no page errors

  Scenario: Switching agents off brings the question back, without taking the keyboard
    When I open the app
    And I click the settings button
    And I turn Agents on
    Then padi should give new terminals the agents with no profiles
    When I turn Agents off
    Then a toast should say agents are off
    When I press Escape
    Then the welcome card's first row should ask which agents I want
    And the welcome card's done line should not mention agents
    When I reload the page
    Then the welcome card's first row should ask which agents I want
    And the first-run step should not have taken keyboard focus
    And the welcome card's done line should not mention agents
    When I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Once chosen, the first-run step never shows again and Settings shows the choice
    When I open the app
    And I turn agents on from the first-run step
    Then padi should give new terminals the agents with no profiles
    And the welcome card should not ask about agents
    When I start watching for the first-run step
    And I reload the page
    Then the welcome card's done line should say agents are on
    And the welcome card should not ask about agents
    And the first-run step should never have shown since
    When I click the settings button
    Then the Agents switch in Settings should be on
    And the Agents profile list should be empty
    And there should be no page errors

  Scenario: Ignoring the step opens a terminal without agents, and the Tutorial still asks
    When I open the app
    Then keyboard focus should be on the first-run Turn on button
    When I create a terminal
    Then the focused tile should show no agents chip
    When I click the settings button
    Then the Agents switch in Settings should be off
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should ask which agents I want
    When I turn agents on from the first-run step
    Then padi should give new terminals the agents with no profiles
    And the Tutorial should not ask about agents
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should not ask about agents
    And the welcome card's done line should say agents are on
    And there should be no page errors
