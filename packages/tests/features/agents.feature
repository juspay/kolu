Feature: Agents come with kolu
  Until agents are on, the welcome card asks for them with one switch; turning
  it on with nothing chosen starts on Juspay's profile, github:juspay/skills.
  Settings → Agents is the same switch, and while it is on, a profile field:
  any bundle kolu ships or a reference agent-distro resolves, with whether it
  resolves on this machine said under it. The choice puts agent-distro's coding
  agents on the PATH of NEW terminals. A running terminal keeps what it started
  with, and every tile says which profile it got. The suite starts every
  scenario never chosen, as a fresh install does.

  Scenario: Settings offers the Agents switch, off until chosen
    Given the terminal is ready
    When I click the settings button
    Then the settings popover should be visible
    And the Agents switch in Settings should be off
    And the Agents hint should explain Off
    And the Agents control in Settings should have nothing chosen
    And there should be no page errors

  Scenario: Turning Agents on starts on Juspay's profile, for the next terminal, not the current one
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "github:juspay/skills" agents
    And the profile field should hold "github:juspay/skills"
    And the profile field should say it resolves to the reference's profile
    When I press Escape
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    When I create a terminal
    Then the focused tile's agents chip should name the profile in effect from the reference
    And the terminal's AI_PROFILE should be "github:juspay/skills"
    And the terminal's claude should be the "vanilla" fixture
    And the terminal's agent-distro should name the "vanilla" profile
    And there should be no page errors

  Scenario: Switching profile reaches the next terminal, and off removes both
    Given the terminal is ready
    When I click the settings button
    And I pick "juspay" from the profile suggestions
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

  Scenario: A profile reference reaches the next terminal, and its pill names the profile in effect
    Given the terminal is ready
    When I click the settings button
    And I choose the "github:me/my-profile" Agents profile
    Then a toast should say new terminals get the "github:me/my-profile" profile
    And padi should give new terminals the "github:me/my-profile" agents
    And the profile field should say it resolves to the reference's profile
    When I press Escape
    And I create a terminal
    Then the focused tile's agents chip should name the profile in effect from the reference
    And the terminal's AI_PROFILE should be "github:me/my-profile"
    And the terminal's claude should be the "vanilla" fixture
    And there should be no page errors

  Scenario: A profile that does not resolve is said under the field, in agent-distro's words, and still written
    Given the terminal is ready
    When I click the settings button
    And I choose the "github:nobody/nothing" Agents profile
    Then the profile field should say "github:nobody/nothing" does not resolve
    And padi should give new terminals the "github:nobody/nothing" agents
    When I choose the "vanilla" Agents profile
    Then the profile field should say it resolves to "vanilla"
    And there should be no page errors

  Scenario: Clicking a tile's agents pill opens Settings at the Agents rows
    Given the terminal is ready
    When I click the settings button
    And I choose the "vanilla" Agents profile
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I click the focused tile's agents chip
    Then the settings popover should be visible
    And the Agents switch in Settings should be on
    And the profile field should hold "vanilla"
    And there should be no page errors

  Scenario: Switching Agents says what happened, and the rows show this machine's status
    Given the terminal is ready
    When I click the settings button
    Then the Agents hint should explain Off
    When I turn Agents on
    Then a toast should say new terminals get the "github:juspay/skills" profile
    And this machine's Agents status should be ready
    When I turn Agents off
    Then a toast should say agents are off
    And the Agents hint should explain Off
    And the profile field should not show
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
    And I choose the "vanilla" Agents profile
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

  Scenario: The first run asks with one switch, and Enter turns on Juspay's profile
    When I open the app
    Then the welcome card's first row should ask which agents I want
    And the first-run agents switch should be off
    And keyboard focus should be on the first-run agents switch
    And the first-run step should say what kolu can bring
    When I press Enter
    Then a toast should say new terminals get the "github:juspay/skills" profile
    And padi should give new terminals the "github:juspay/skills" agents
    And the welcome card should not ask about agents
    And the welcome card's done line should say agents are "github:juspay/skills"
    When I create a terminal
    Then the focused tile's agents chip should name the profile in effect from the reference
    When I click the settings button
    Then the Agents switch in Settings should be on
    And the profile field should hold "github:juspay/skills"
    And this machine's Agents status should be ready
    And there should be no page errors

  Scenario: Switching agents off brings the question back, without taking the keyboard
    When I open the app
    And I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "github:juspay/skills" agents
    When I turn Agents off
    Then a toast should say agents are off
    When I press Escape
    Then the welcome card's first row should ask which agents I want
    And the first-run agents switch should be off
    And the welcome card's done line should not mention agents
    When I reload the page
    Then the welcome card's first row should ask which agents I want
    And the first-run agents switch should be off
    And the first-run step should not have taken keyboard focus
    And the welcome card's done line should not mention agents
    When I create a terminal
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    And there should be no page errors

  Scenario: Once chosen, the first-run step never shows again and Settings shows the choice
    When I open the app
    And I turn on the first-run agents switch
    Then padi should give new terminals the "github:juspay/skills" agents
    And the welcome card should not ask about agents
    When I start watching for the first-run step
    And I reload the page
    Then the welcome card's done line should say agents are "github:juspay/skills"
    And the welcome card should not ask about agents
    And the first-run step should never have shown since
    When I click the settings button
    Then the profile field should hold "github:juspay/skills"
    And there should be no page errors

  Scenario: Ignoring the step opens a terminal without agents, and the Tutorial still asks
    When I open the app
    Then keyboard focus should be on the first-run agents switch
    When I create a terminal
    Then the focused tile should show no agents chip
    When I click the settings button
    Then the Agents control in Settings should have nothing chosen
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should ask which agents I want
    When I turn on the first-run agents switch
    Then padi should give new terminals the "github:juspay/skills" agents
    And the Tutorial should not ask about agents
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should not ask about agents
    And the welcome card's done line should say agents are "github:juspay/skills"
    And there should be no page errors

  # ── Kept up to date ─────────────────────────────────────────────────────────

  @agent-updates
  Scenario: Check now lands a newer set: the toast says what changed, the open tile offers Restart, a new terminal gets it
    Given the terminal is ready
    When I click the settings button
    And I choose the "vanilla" Agents profile
    Then this machine's Agents status should be ready
    And this machine's Agents line should say the last run unchanged
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    Given the next "vanilla" agents update finds a newer set
    When I click the settings button
    And I click Check now
    Then this machine's Agents line should show an update downloading
    And the host tab's agents mark should be "ready"
    And a toast should say what the update changed on this machine
    And this machine's Agents line should say the last run updated
    And the Agents History should list the updated event
    And the Agents line and History name this machine by its hostname
    When I press Escape
    Then the focused tile's agents chip should be stale with a Restart button
    When I create a terminal
    Then the focused tile's agents chip should carry the bundle new terminals get now
    And there should be no page errors

  @agent-updates
  Scenario: Check now with nothing newer: no toast, the line says it checked and is up to date
    Given the terminal is ready
    When I click the settings button
    And I choose the "vanilla" Agents profile
    Then this machine's Agents status should be ready
    And this machine's Agents line should say the last run unchanged
    When I remember this machine's last update run
    And I click Check now
    Then this machine's Agents line should show an update checking
    And this machine's last update run should be newer than the one I remembered
    And this machine's Agents line should say the last run unchanged
    And no toast should say an update landed on this machine
    And there should be no page errors

  @agent-updates
  Scenario: A newer set the cache does not hold yet is skipped: no toast, the History says so
    Given the terminal is ready
    When I click the settings button
    And I choose the "vanilla" Agents profile
    Then this machine's Agents status should be ready
    And this machine's Agents line should say the last run unchanged
    Given the next "vanilla" agents update finds the newer set not ready to download
    When I click Check now
    Then this machine's Agents line should say the last run skipped
    And no toast should say an update landed on this machine
    And the Agents History should list the skipped event
    And this machine's Agents status should be ready
    And there should be no page errors
