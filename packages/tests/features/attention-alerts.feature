Feature: Attention Alerts
  Workspace switcher glow and audio when a background terminal's Claude finishes.

  Background:
    Given the terminal is ready

  Scenario: Visiting notified terminal clears the glow
    When I create a terminal
    And I simulate an attention alert
    Then a workspace switcher branch should be notified
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And there should be no page errors

  Scenario: An agent awaiting you badges the PWA dock icon
    # W5 cross-host attention: the app badge is now the count of agents AWAITING
    # you across every bound host (padi's `urgency` projection), not the old
    # active-host attention marks. A simulated attention alert (glow /
    # notification) no longer badges — a REAL `awaiting_user` agent does, which is
    # the done-criterion. Driven through the real agent-state pipeline (padi's
    # urgency fold → the client's cross-host watcher), so the badge assertion
    # polls for the wire round-trip.
    When I stub the Badging API
    And a Claude Code session is mocked with state "awaiting_user"
    And I create a terminal
    Then the tile chrome should show an agent indicator with state "awaiting_user"
    And the app badge should show 1
    And there should be no page errors

  Scenario: Alerts respect the settings toggle
    When I create a terminal
    And I click the settings button
    And I click the attention alerts toggle
    And I press Escape
    And I simulate an attention alert
    Then no workspace switcher branch should be notified
    And there should be no page errors

  # After a restart. The harness starts the new server on a new port, so the
  # page always reloads; these scenarios are the RELOAD case. A tab that stays
  # open through the restart is covered by the attention engine's unit tests.
  # Each waits for the agent's row to show padi's verdict before checking what
  # did NOT happen, so the check runs after padi's first real word. The page
  # comes back focused on the terminal padi saved as active, and a terminal you
  # are looking at never carries a mark nor rings — so each scenario waits for
  # padi to save the shell as active before the restart, and checks the shell
  # is the active tile after it, before any "not unread" or "0 plays" check.

  Scenario: A finished agent you had opened reads as read after kolu restarts
    When I stub the notification sound
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And the notification sound should have played 1 time
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    When I select terminal 1 in the workspace switcher
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When the kolu server is redeployed under this page
    Then the saved active canvas tile should still be active
    And the agent's dock row should show its finished turn
    And no workspace switcher branch should be notified
    And the notification sound should have played 0 times
    And there should be no page errors

  # The saved session's FIRST terminal asleep: padi registers it before any
  # surviving terminal, and nothing about that may change what you had read.
  Scenario: A finished agent you had opened reads as read after kolu restarts, behind a sleeping terminal
    When I stub the notification sound
    And I sleep the active terminal via the tile sleep button
    Then the dock should show 1 sleeping row
    When I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And the notification sound should have played 1 time
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    When I select terminal 2 in the workspace switcher
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When the kolu server is redeployed under this page
    Then the saved active canvas tile should still be active
    And the agent's dock row should show its finished turn
    And no workspace switcher branch should be notified
    And the notification sound should have played 0 times
    And there should be no page errors

  Scenario: A finished agent you had not opened is still unread after kolu restarts
    When I stub the notification sound
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    And the agent's dock row should be unread
    And the notification sound should have played 1 time
    When the kolu server is redeployed under this page
    Then the saved active canvas tile should still be active
    And the agent's dock row should show its finished turn
    And the agent's dock row should be unread
    And the notification sound should have played 0 times
    And there should be no page errors

  Scenario: An agent that finishes while kolu is down is unread when it comes back, without a chime
    When I stub the notification sound
    And a Claude Code session is mocked with state "thinking"
    Then the tile chrome should show an agent indicator with state "thinking"
    When I create a terminal
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When the kolu server is redeployed while the Claude Code session changes to "waiting"
    Then the saved active canvas tile should still be active
    And the agent's dock row should show its finished turn
    And the agent's dock row should be unread
    And the notification sound should have played 0 times
    And there should be no page errors

  Scenario: An agent asking you before kolu restarts is still asking after it comes back, and rings nothing
    # Claude Code's question is never in its transcript: a permission prompt
    # leaves it at `tool_use`, and kolu reads "asking" off the screen.
    When I stub the notification sound
    And I stub the Badging API
    And a Claude Code session is mocked with state "tool_use"
    And the terminal renders a Claude permission prompt
    Then the tile chrome should show an agent indicator with state "awaiting_user"
    When I create a terminal
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When the kolu server is redeployed under this page
    Then the saved active canvas tile should still be active
    And the agent's dock row should show it asking
    And no workspace switcher branch should be notified
    And the notification sound should have played 0 times
    And the app badge should show 1
    And there should be no page errors

  # A DEPLOY under a page that stays open: only the server stops; padi and
  # kaval keep running; the new server, on the same address, drains padi the
  # way a new build's server does, and starts another. The page offers Reload
  # and it is clicked at once. Each scenario waits for the NEW padi to list the
  # agent finished, and for the row to show it, before checking what did not
  # happen.

  Scenario: A finished agent you had opened reads as read after a deploy
    When I stub the notification sound
    And I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And the notification sound should have played 1 time
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    When I select terminal 2 in the workspace switcher
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When kolu is deployed under this page and I click Reload when it is offered
    Then padi should list the agent's turn as finished
    And the saved active canvas tile should still be active
    And the agent's dock row should show its finished turn
    And no workspace switcher branch should be notified
    And the notification sound should have played 0 times
    And there should be no page errors

  Scenario: A finished agent you had opened reads as read after a deploy, behind a sleeping terminal
    When I stub the notification sound
    And I sleep the active terminal via the tile sleep button
    Then the dock should show 1 sleeping row
    When I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And the notification sound should have played 1 time
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    When I select terminal 2 in the workspace switcher
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When kolu is deployed under this page and I click Reload when it is offered
    Then padi should list the agent's turn as finished
    And the saved active canvas tile should still be active
    And the agent's dock row should show its finished turn
    And no workspace switcher branch should be notified
    And the notification sound should have played 0 times
    And there should be no page errors

  # The host's padi replaced under a page that is never reloaded: the server
  # and the page stay, padi is killed, and the server starts another that
  # adopts kaval's terminals. The sound already played once, before.

  Scenario: A finished agent you had opened stays read when padi is replaced under the page
    When I stub the notification sound
    And I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And the notification sound should have played 1 time
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    When I select terminal 2 in the workspace switcher
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When this host's padi is replaced under the page
    Then padi should list the agent's turn as finished
    And the agent's dock row should show its finished turn
    And no workspace switcher branch should be notified
    And the notification sound should have played 1 time
    And there should be no page errors

  Scenario: A finished agent you had opened stays read when padi is replaced under the page, behind a sleeping terminal
    When I stub the notification sound
    And I sleep the active terminal via the tile sleep button
    Then the dock should show 1 sleeping row
    When I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And the notification sound should have played 1 time
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    When I select terminal 2 in the workspace switcher
    And I save the active canvas tile id
    Then the saved session should record the active terminal
    When this host's padi is replaced under the page
    Then padi should list the agent's turn as finished
    And the agent's dock row should show its finished turn
    And no workspace switcher branch should be notified
    And the notification sound should have played 1 time
    And there should be no page errors

  # Two pages of the same kolu in one browser share one saved list of unread
  # marks. A terminal read in one page must stay read when the other page
  # writes the list and the first page reloads.

  @codex-mock
  Scenario: A terminal read in one page stays read after another page of the same kolu writes the unread list
    When I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And this browser's saved unread list should be terminals "1"
    When I open a second page of the same kolu
    Then terminal 1's dock row should be unread in the second page
    # Read terminal 1 in the first page.
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And this browser's saved unread list should be terminals ""
    # A second agent finishes; reading it in the second page makes that page
    # write the list.
    When I select terminal 2 in the workspace switcher
    And I create a terminal
    And a Codex session is mocked with state "waiting"
    And I create a terminal
    Then terminal 3's dock row should be unread in the second page
    When I click terminal 3's dock row in the second page
    Then terminal 3's dock row should not be unread in the second page
    When I reload the first page
    Then terminal 1's dock row should show its finished turn
    And terminal 1's dock row should not be unread

  # The same, with the second page opened on a kolu link: a page keeps its
  # link in the address bar, so two pages of one kolu can sit at different
  # addresses while sharing one storage.
  @codex-mock
  Scenario: A terminal read in one page stays read after another page, at a different address, writes the unread list
    When I create a terminal
    And a Claude Code session is mocked with state "waiting"
    And I create a terminal
    Then a workspace switcher branch should be notified
    And this browser's saved unread list should be terminals "1"
    When I open a second page of the same kolu at another address
    Then terminal 1's dock row should be unread in the second page
    When I click the notified workspace switcher branch
    Then no workspace switcher branch should be notified
    And this browser's saved unread list should be terminals ""
    When I select terminal 2 in the workspace switcher
    And I create a terminal
    And a Codex session is mocked with state "waiting"
    And I create a terminal
    Then terminal 3's dock row should be unread in the second page
    When I click terminal 3's dock row in the second page
    Then terminal 3's dock row should not be unread in the second page
    When I reload the first page
    Then terminal 1's dock row should show its finished turn
    And terminal 1's dock row should not be unread
