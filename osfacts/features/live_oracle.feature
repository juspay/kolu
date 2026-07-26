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
    Then every osfacts listener has a canonical match in the oracle
    And every oracle listener has a canonical match in osfacts
    # Appear/vanish races between the two reads are tolerated structurally:
    # the step functions re-read once on mismatch before failing.
    # Privilege-honest: oracle sockets with no process attribution (or whose
    # pid is in osfacts's unreadable set) are not required in the L table —
    # osfacts reports those as U rows, not missing L rows.
