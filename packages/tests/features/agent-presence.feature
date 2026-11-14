@omp-mock
Feature: An agent that is simply there
  A terminal whose foreground program IS a coding agent carries an agent from
  that moment on — before the agent has written a word of transcript. Most
  agents keep a brand-new session in memory and materialize its file at the
  first prompt, so the seconds (or minutes) in between used to read as a plain
  shell: nothing to watch, nothing to speak to, nothing on the dock.

  kolu names those seconds. An agent whose screen is still being drawn is
  STARTING; once its screen goes quiet it is READY — up, and never prompted.
  Both are QUIET facts: the row says what it is, and nothing asks for you. No
  badge on the dock, none on the host tab, none on the app icon — an agent
  nobody has briefed is not waiting on anybody.

  The stand-in is the fake `omp` binary (a bash copy seeded by hooks.ts, so
  `/proc/<pid>/comm` reads `omp`), which writes its breadcrumb at launch and its
  session file only when something prompts it — exactly the lazy session the
  real one keeps. While it paints its bring-up it holds padi's quiet window
  open, so `starting` is a state this scenario ENDS rather than one it races.

  Background:
    Given the terminal is ready

  Scenario: An agent that comes up and is never prompted reads as Ready, and asks for nobody
    When I stub the Badging API
    And the dock is expanded
    And an Oh My Pi agent is coming up with its screen still being drawn
    Then the tile chrome should show an Oh My Pi indicator with state "starting"
    And the dock agent row should say "Starting"
    When Oh My Pi's screen goes quiet
    Then the tile chrome should show an Oh My Pi indicator with state "fresh"
    And the dock agent row should say "Ready"
    # The quiet half: an agent that is READY is an agent, not an alarm.
    And the dock should show 0 cards
    And the dock should show 0 working pills
    And the dock needs-you strip should show 0 entries
    And the active host tab should show no attention marks
    And the app badge should never have counted an agent
    And there should be no page errors

  Scenario: The agent leaving the foreground ends its presence
    # Presence is a PROCESS fact, so it ends the way the process does — with no
    # session file ever written, there is nothing else that could end it.
    When an Oh My Pi process is running with no session file yet
    Then the tile chrome should show an Oh My Pi indicator with state "fresh"
    When Oh My Pi leaves the foreground
    Then the tile chrome should not show an agent indicator
    And there should be no page errors

  @presence-registry
  Scenario: Every registered agent reads as Ready from its foreground alone
    # Presence is minted from the FOREGROUND, matched against the registry's CLI
    # grammar — so it is owed to every agent kolu knows, not only to the one
    # with a faithful fake. This scenario is run once per REGISTERED agent, and
    # the list comes from the registry at runtime: registering an eighth agent
    # extends it without touching this file. Each stand-in is a copy of bash
    # renamed to that agent's own binary name (so `/proc/<pid>/comm` reads it),
    # which paints a bring-up and then goes quiet — and writes no session, no
    # breadcrumb, nothing at all.
    When I stub the Badging API
    And the dock is expanded
    And every registered agent is brought up in turn, writing no session
    Then each registered agent should have read Starting then Ready, asking for nobody
    And the app badge should never have counted an agent
    And there should be no page errors
