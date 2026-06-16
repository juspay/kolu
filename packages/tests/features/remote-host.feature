@remote-host
Feature: Remote host — kolu dials a remote over ssh
  Kolu can open a terminal on another machine over ssh (P3, kaval-sessions).
  "Connect to host…" in the command palette dials the target, mirrors its
  fs/git + metadata into the browser like a local terminal, and tags the tile
  with a host chip naming the machine plus a health dot that tracks the dial
  (provisioning → connected).

  This scenario dials `localhost` AS a remote. The dial path is identical to a
  real ssh host — resolve the host's nix-system, provision the kolu-watcher
  closure, run it, and forward pty verbs to the host-local kaval — but for
  `localhost` it runs over the loopback with NO ssh round-trip (`isLocalHost`),
  so it exercises the whole remote machinery without a second box.

  It is tagged @remote-host and is EXCLUDED from the plain `ci::e2e` lane the
  same way @recording is: a real nix dial is heavy and has no reason to resolve
  (and flake) in the hermetic CI suite. It is driven by the evidence harness
  (`KOLU_EVIDENCE=1`, with `KOLU_WATCHER_AGENT_DRVS_JSON` + `KOLU_WATCHER_KAVAL_BIN`
  supplied) on a pu box to capture the host chip on a genuine remote dial —
  see `CUCUMBER_TAGS='@remote-host'` in the evidence run.

  Background:
    Given the terminal is ready

  Scenario: Connect to localhost as a remote host and tag the tile with a host chip
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "Connect to host…" in the palette
    And I type "localhost" in the palette
    And I press Enter
    Then the active terminal should show host chip "localhost"
    # Maximize so the dock renders as a left SIBLING (not a floating overlay over
    # the tile titlebar): the host chip is then fully visible — which also asserts
    # it survives the posture change, and gives the evidence capture a clean frame.
    When I press the maximize toggle shortcut
    # Wait for the dial to walk provisioning → connected: the chip's health dot
    # turns green. This is the real payoff (a live remote terminal), proves the
    # full dial lifecycle, and holds the green state for the evidence capture.
    Then the host chip should reach the "connected" state
    And there should be no page errors

  # The companion to the ad-hoc dial above: kolu RECOGNISES the hosts in the
  # user's ssh config and lists them in "New terminal", so a host is picked, not
  # retyped. The evidence harness plants a `KOLU_SSH_CONFIG` fixture with a few
  # `Host` entries (one of them `localhost`) before the run.
  Scenario: Recognise ~/.ssh/config hosts in the palette and dial one to green
    When I open the command palette
    And I select "New terminal" in the palette
    # The ssh-config Host aliases are recognised and offered as pickable entries.
    Then palette item "prod" should be visible
    And palette item "localhost" should be visible
    # Pick the ssh-config host — kolu dials it (over the loopback for `localhost`).
    When I select "localhost" in the palette
    And I press the maximize toggle shortcut
    Then the host chip should reach the "connected" state
    And there should be no page errors
