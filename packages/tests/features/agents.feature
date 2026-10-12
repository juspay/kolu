Feature: Agents come with kolu
  Until agents are on, the welcome card asks for them with the profiles kolu
  ships, by name, Vanilla picked; Turn on takes the picked one, Not now leaves
  the question for later. Settings → Agents is the same choice as cards — a
  bundle kolu ships, Juspay by name, or Custom… for a reference agent-distro
  resolves, with whether it resolves on this machine said under it. The choice
  puts agent-distro's coding agents on the PATH of NEW terminals. A running
  terminal keeps what it started with, and every tile says which profile it
  got. What each MACHINE has — its build, its last update, a failed
  download — lives in that machine's host details. The suite starts every
  scenario never chosen, as a fresh install does.

  Scenario: Settings offers the Agents switch, off until chosen
    Given the terminal is ready
    When I click the settings button
    Then the settings popover should be visible
    And the Agents switch in Settings should be off
    And the Agents hint should explain Off
    And the Agents row should name the agents it would bring
    And there should be no page errors

  Scenario: Turning Agents on starts on Vanilla, for the next terminal, not the current one
    Given the terminal is ready
    When I click the settings button
    And I turn Agents on
    Then padi should give new terminals the "vanilla" agents
    And the "vanilla" profile card should be picked
    And the profile card should say it resolves to "vanilla"
    When I press Escape
    Then the focused tile should show no agents chip
    And the terminal should have no fixture agents on its PATH
    When I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    And the terminal's AI_PROFILE should be "vanilla"
    And the terminal's claude should be the "vanilla" fixture
    And the terminal's agent-distro should name the "vanilla" profile
    And there should be no page errors

  Scenario: Picking another profile card reaches the next terminal, and off removes both
    Given the terminal is ready
    When I click the settings button
    And I pick the "juspay" profile card
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

  Scenario: A reference typed into Custom reaches the next terminal, and its pill names the profile in effect
    Given the terminal is ready
    When I click the settings button
    And I choose the "github:me/my-profile" Agents profile
    Then a toast should say new terminals get the "github:me/my-profile" profile
    And padi should give new terminals the "github:me/my-profile" agents
    And the profile card should say it resolves to the reference's profile
    When I press Escape
    And I create a terminal
    Then the focused tile's agents chip should name the profile in effect from the reference
    And the terminal's AI_PROFILE should be "github:me/my-profile"
    And the terminal's claude should be the "vanilla" fixture
    And there should be no page errors

  Scenario: A profile that does not resolve is said under Custom, in agent-distro's words, and still written
    Given the terminal is ready
    When I click the settings button
    And I choose the "github:nobody/nothing" Agents profile
    Then the profile card should say "github:nobody/nothing" does not resolve
    And padi should give new terminals the "github:nobody/nothing" agents
    When I pick the "vanilla" profile card
    Then the profile card should say it resolves to "vanilla"
    And there should be no page errors

  Scenario: Clicking a tile's agents pill opens Settings at the Agents rows
    Given the terminal is ready
    When I click the settings button
    And I pick the "vanilla" profile card
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I click the focused tile's agents chip
    Then the settings popover should be visible
    And the Agents switch in Settings should be on
    And the "vanilla" profile card should be picked
    And there should be no page errors

  Scenario: Switching Agents says what happened, and the fleet line says this machine is ready
    Given the terminal is ready
    When I click the settings button
    Then the Agents hint should explain Off
    When I turn Agents on
    Then a toast should say new terminals get the "vanilla" profile
    And the Agents fleet line should say this machine is ready
    When I turn Agents off
    Then a toast should say agents are off
    And the Agents hint should explain Off
    And the profile cards should not show
    And there should be no page errors

  Scenario: This machine's tab carries the agents mark while Agents are on, and it opens its host details
    Given the terminal is ready
    Then the host tab should show no agents mark
    When I click the settings button
    And I pick the "vanilla" profile card
    Then the host tab's agents mark should be "ready"
    When I press Escape
    Then the settings popover should not be visible
    When I click the host tab's agents mark
    Then this machine's host details should show its agents section
    And the agents section should name the "Vanilla" profile with the build it serves
    And the agents section should offer to check for newer agents
    When I press Escape
    And I click the settings button
    And I turn Agents off
    Then the host tab should show no agents mark
    And there should be no page errors

  Scenario: A terminal whose agents went stale restarts in place with the new ones
    Given the terminal is ready
    When I click the settings button
    And I pick the "vanilla" profile card
    Then padi should give new terminals the "vanilla" agents
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I run 'cd "$(mktemp -d)" && cd "$(pwd -P)" && pwd -P > here && echo $$ > pid && export X=1'
    And I remember the focused tile
    And I click the settings button
    And I pick the "juspay" profile card
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

  Scenario: The first run offers the profiles by name, and Enter turns on Vanilla
    When I open the app
    Then the welcome card's first row should ask which agents I want
    And the first-run step should offer the "vanilla" and "juspay" profile cards
    And the "vanilla" first-run card should be picked
    And keyboard focus should be on the picked first-run card
    And the first-run step should say what kolu can bring
    When I press Enter
    Then a toast should say new terminals get the "vanilla" profile
    And padi should give new terminals the "vanilla" agents
    And the welcome card should not ask about agents
    And the welcome card's done line should say agents are "Vanilla"
    When I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    When I click the settings button
    Then the Agents switch in Settings should be on
    And the "vanilla" profile card should be picked
    And the Agents fleet line should say this machine is ready
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
    Then padi should give new terminals the "vanilla" agents
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
    Then padi should give new terminals the "vanilla" agents
    And the welcome card should not ask about agents
    When I start watching for the first-run step
    And I reload the page
    Then the welcome card's done line should say agents are "Vanilla"
    And the welcome card should not ask about agents
    And the first-run step should never have shown since
    When I click the settings button
    Then the "vanilla" profile card should be picked
    And there should be no page errors

  Scenario: Ignoring the step opens a terminal without agents, and the Tutorial still asks
    When I open the app
    Then keyboard focus should be on the picked first-run card
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
    Then padi should give new terminals the "vanilla" agents
    And the Tutorial should not ask about agents
    When I press Escape
    And I open the command palette
    And I type "Tutorial" in the palette
    And I select "Tutorial" in the palette
    Then the Tutorial should not ask about agents
    And the welcome card's done line should say agents are "Vanilla"
    And there should be no page errors

  # ── Kept up to date ─────────────────────────────────────────────────────────

  @agent-updates
  Scenario: The palette's check lands a newer set: the toast says what changed, the open tile offers Restart, a new terminal gets it
    Given the terminal is ready
    When I click the settings button
    And I pick the "vanilla" profile card
    Then the Agents fleet line should say this machine is ready
    When I press Escape
    And I create a terminal
    Then the focused tile should show the "vanilla" agents chip
    And this machine has finished looking for newer agents
    Given the next "vanilla" agents update finds a newer set
    When I check for newer coding agents from the palette
    Then a toast should say what the update changed on this machine
    When I open this machine's host details
    Then this machine's agents section should say the last run updated
    And this machine's agents section should list the updated event
    And the agents section names this machine by its hostname
    When I press Escape
    Then the focused tile's agents chip should be stale with a Restart button
    When I create a terminal
    Then the focused tile's agents chip should carry the bundle new terminals get now
    And there should be no page errors

  @agent-updates
  Scenario: A per-host check with nothing newer: no toast, the section says it checked and is up to date
    Given the terminal is ready
    When I click the settings button
    And I pick the "vanilla" profile card
    Then the Agents fleet line should say this machine is ready
    When I press Escape
    And I open this machine's host details
    Then this machine's agents section should say the last run unchanged
    When I remember this machine's last update run
    And I check for newer agents from this machine's host details
    Then this machine's last update run should be newer than the one I remembered
    And this machine's agents section should say the last run unchanged
    And no toast should say an update landed on this machine
    And there should be no page errors

  @agent-updates
  Scenario: A newer set the cache does not hold yet is skipped: no toast, the machine's events say so
    Given the terminal is ready
    When I click the settings button
    And I pick the "vanilla" profile card
    Then the Agents fleet line should say this machine is ready
    And this machine has finished looking for newer agents
    Given the next "vanilla" agents update finds the newer set not ready to download
    When I press Escape
    And I check for newer coding agents from the palette
    And I open this machine's host details
    Then this machine's agents section should say the last run skipped
    And this machine's agents section should list the skipped event
    And no toast should say an update landed on this machine
    And there should be no page errors
