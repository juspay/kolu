Feature: Live-host oracle (lane 2 — never gates)
  The second lane asks "did the OS break osfacts?" on a real, noisy host.
  Answers are diffed against tools that do not share its code: `ss` on
  linux, `lsof` on darwin. A live host owes you noise, so this lane informs
  instead of blocking.

  Scenario: A loopback listener in a shell tree is attributed to that shell
    Given a shell running a loopback server
    When I snapshot that shell's subtree with osfacts
    Then the listener is attributed to a pid in that shell's subtree

  Scenario: Host-wide snapshot agrees with the platform oracle
    When I take a host-wide osfacts snapshot of listening ports
    And I read the platform oracle's listening ports
    Then every osfacts listener visible to the platform oracle has a canonical match
    And every oracle listener has a canonical match in osfacts
    # Appear/vanish races between the two reads are tolerated structurally:
    # the step functions re-read once on mismatch before failing.
    # Every oracle listener is present. A listener whose fd owner cannot be
    # read is an explicit unclaimed L row, not a missing row.

  Scenario: Memory and process age are live OS facts
    When I snapshot this process's memory and start time
    Then osfacts reports positive RSS and a past start instant

  Scenario: Process CPU time is cumulative
    When I take two CPU-time snapshots of this process
    Then process CPU time is positive and does not decrease

  Scenario: An unreadable launchd does not hide its readable descendants on darwin
    When I snapshot launchd's subtree as an unprivileged darwin user
    Then the snapshot reports launchd's readable process tree without hiding its blindness

  Scenario: Host telemetry preserves gauge and cumulative semantics
    When I take two complete host snapshots
    Then host gauges are sane and cumulative counters do not decrease
