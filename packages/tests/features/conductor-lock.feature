Feature: A terminal the Conductor drives is read-only until you take it over
  A member of a waterfall is the CONDUCTOR'S keyboard. The person's own input
  sites — xterm's keys and paste, the phone's key bar — are gated on it, so a
  stray keystroke cannot land halfway through a brief the agent is reading;
  everything about READING is untouched. The lock is never a silent swallow:
  the tile says who is driving, and a blocked key nudges at the one control
  that changes it.

  The proof is the PTY, not a signal in the browser. The member terminal runs
  the omp stand-in, whose read loop echoes back every line it is given behind
  a marker it assembles at runtime (`support/agent-mock-omp.ts`) — so a key
  that arrived shows on the terminal's own screen twice (the PTY's echo and
  the stand-in's answer), and a key the lock swallowed leaves no trace of the
  word at all.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A driven terminal takes no keys and no paste, and says why
    # THE WHOLE POINT, at the two sites one keystroke can arrive through.
    # Between the two the nudge is waited OUT — it is a brief thing that goes
    # by itself, which is also what makes the second one evidence rather than
    # the first one still being on screen.
    Given a repo for the work
    When I ask the conductor to open the work "drive the parser"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    Then the member terminal should say the Conductor drives the "Implementor"
    When I type "sentinel-keys" into the member terminal
    Then the member terminal should not have heard "sentinel-keys"
    And the lock should nudge
    And selecting text in the member terminal should still work
    When the lock stops nudging
    And I paste "sentinel-paste" into the member terminal
    Then the member terminal should not have heard "sentinel-paste"
    And the lock should nudge
    And there should be no page errors

  Scenario: Take it over, type, hand it back
    # THE LOCK ENDS WHEN THE PERSON SAYS SO, and it comes back the same way.
    # The keyboard is the evidence in both directions — the banner and the
    # dock row say who is driving, the terminal's own screen says whether it
    # was true — and the timeline keeps both acts, because a conversation
    # picked up later has to know the terminal was out of its hands.
    Given a repo for the work
    When I ask the conductor to open the work "take the parser over"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    And I take over the member terminal
    Then the member terminal should say you took over the "Implementor"
    And the dock row for the member terminal should be marked as yours
    When I type "sentinel-mine" into the member terminal
    Then the member terminal should have heard "sentinel-mine"
    When I hand the member terminal back
    Then the member terminal should say the Conductor drives the "Implementor"
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
    Then the member terminal should say you took over the "Implementor"
    And the second client should show the member terminal as yours
    And there should be no page errors

  @mobile
  Scenario: The phone's key bar is gated by the band above it
    # A PHONE HAS NO TITLE BAR, so the lock owns a band of its own directly
    # above the keys it gates: the control a blocked tap is pointed at is a
    # thumb's width from the key that was blocked. The key bar is a person's
    # keyboard and is gated exactly as xterm's keys are.
    Given a repo for the work
    When I ask the conductor to open the work "drive on a phone"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I go to the member terminal
    Then the member terminal should say the Conductor drives the "Implementor"
    And the lock should sit above the phone's key bar
    When I note the member terminal's screen
    And I tap the mobile key "slash"
    Then the member terminal's screen should be unchanged
    And the lock should nudge
    When I take over the member terminal
    Then the member terminal should say you took over the "Implementor"
    When I note the member terminal's screen
    And I tap the mobile key "slash"
    Then the member terminal's screen should have changed
    And there should be no page errors

  Scenario: A watch is not a waterfall, so nothing is locked
    # THE HUMAN'S OWN TERMINAL, which they asked kolu to keep an eye on. The
    # Conductor does not drive it, so there is no lock to draw and no key to
    # swallow — only the mark that says this terminal is in a piece of work.
    When I ask the conductor to watch the terminal
    Then the work column should list the terminal as a member
    When I go to the member terminal
    Then the member terminal should carry the work's mark
    And the member terminal should have no lock
    When I note the member terminal's screen
    And I type "sentinel-watch" into the member terminal
    Then the member terminal's screen should have changed
    And there should be no page errors
