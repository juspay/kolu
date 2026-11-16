Feature: A terminal the Conductor drives is read-only until you take it over
  A member of a waterfall is the CONDUCTOR'S keyboard. The person's own input
  sites — xterm's keys and paste, the phone's key bar — are gated on it, so a
  stray keystroke cannot land halfway through a brief the agent is reading;
  everything about READING is untouched. Nothing is added to the tile's
  header: the terminal is marked by a thin border around its own body, and
  TYPING is what brings up the control — a small card centred over the
  terminal, offering Take over.

  The proof is the PTY, not a signal in the browser. The member terminal runs
  the omp stand-in, whose read loop echoes back every line it is given behind
  a marker it assembles at runtime (`support/agent-mock-omp.ts`) — so a key
  that arrived shows on the terminal's own screen twice (the PTY's echo and
  the stand-in's answer), and a key the lock swallowed leaves no trace of the
  word at all.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A driven terminal takes no keys and no paste, and the card says why
    # THE WHOLE POINT, at the two sites one keystroke can arrive through, and
    # the two ways the card goes away: by hand (Esc) and by itself. The
    # second card is evidence rather than the first one still being up
    # precisely because the first was dismissed between them.
    Given a repo for the work
    When I ask the conductor to open the work "drive the parser"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    Then the member terminal should be framed as driven by the Conductor
    And the member terminal should have no lock card
    When I type "sentinel-keys" into the member terminal
    Then the member terminal should not have heard "sentinel-keys"
    And the lock card should offer to take over the "Implementor"
    And the lock card should sit over the member terminal
    And selecting text in the member terminal should still work
    When I press Escape
    Then the member terminal should have no lock card
    When I paste "sentinel-paste" into the member terminal
    Then the member terminal should not have heard "sentinel-paste"
    And the lock card should offer to take over the "Implementor"
    When the lock card goes by itself
    Then there should be no page errors

  Scenario: Take it over from the card, type, hand it back from the pill
    # THE LOCK ENDS WHEN THE PERSON SAYS SO, and it comes back the same way.
    # The keyboard is the evidence in both directions — the frame, the pill
    # and the dock row say who is driving, the terminal's own screen says
    # whether it was true — and the timeline keeps both acts, because a
    # conversation picked up later has to know the terminal was out of its
    # hands.
    Given a repo for the work
    When I ask the conductor to open the work "take the parser over"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    And I take over the member terminal
    Then the member terminal should be framed as yours
    And the member terminal should offer to hand back
    And the member terminal should have no lock card
    And the dock row for the member terminal should be marked as yours
    And the dock row's mark should not cover its name
    When I type "sentinel-mine" into the member terminal
    Then the member terminal should have heard "sentinel-mine"
    When I hand the member terminal back
    Then the member terminal should be framed as driven by the Conductor
    When I type "sentinel-after" into the member terminal
    Then the member terminal should not have heard "sentinel-after"
    When I enter conductor mode
    And I open the work card
    Then the work's timeline should show a "taken-over" event saying "You took over the implementor"
    And the work's timeline should show a "handed-back" event saying "You handed the implementor back"
    And there should be no page errors

  Scenario: The other browser is told who is driving
    # THE LOCK IS THE PERSON'S, NOT THE TAB'S. It lives on the work's record,
    # so a second browser on the same server reads it off the same collection
    # — and moves when it moves, with no reload and no gesture of its own.
    Given a repo for the work
    When I ask the conductor to open the work "drive from two places"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    And I open a second client on the same server
    Then the second client should show the member terminal as driven by the Conductor
    When I take over the member terminal
    Then the member terminal should be framed as yours
    And the second client should show the member terminal as yours
    And there should be no page errors

  @mobile
  Scenario: The phone's key bar raises the same card
    # A PHONE HAS NO TITLE BAR AND NO KEYBOARD OF ITS OWN — the key bar is
    # where typing happens there, so a blocked tap raises the card over the
    # terminal exactly as a blocked keystroke does on a desktop, and Take
    # over is a thumb's width from the key that was blocked.
    Given a repo for the work
    When I ask the conductor to open the work "drive on a phone"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    And the work's terminal rows should each be one line
    When I go to the member terminal
    Then the member terminal should be framed as driven by the Conductor
    # The phone is shown this terminal for the first time here — a tile
    # nobody has seen takes no output — so the stand-in's own up marker is
    # waited for before anything is measured against the screen.
    And the member terminal should have come up
    When I note the member terminal's screen
    And I tap the mobile key "slash"
    Then the member terminal's screen should be unchanged
    And the lock card should offer to take over the "Implementor"
    And the lock card should sit over the member terminal
    When I take over the member terminal
    Then the member terminal should be framed as yours
    When I note the member terminal's screen
    And I tap the mobile key "slash"
    Then the member terminal's screen should have changed
    And there should be no page errors

  Scenario: A watch is not a waterfall, so nothing is locked
    # THE HUMAN'S OWN TERMINAL, which they asked kolu to keep an eye on. The
    # Conductor does not drive it, so there is no frame to draw and no key to
    # swallow — only the dock's mark, which says this terminal is in a piece
    # of work.
    When I ask the conductor to watch the terminal
    Then the work column should list the terminal as a member
    When I go to the member terminal
    Then the dock row for the member terminal should carry the work's mark
    And the member terminal should have no lock
    When I note the member terminal's screen
    And I type "sentinel-watch" into the member terminal
    Then the member terminal's screen should have changed
    And there should be no page errors
