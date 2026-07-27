//! Lane 1 — hermetic CLI-contract suite (gates every merge).
//!
//! Both platforms: self-referential bind-in-child (`osfacts-listener`) +
//! scoped snapshot. Assertions pin *our* fixtures — never "the host table is
//! empty". One optional empty-table check exists only inside the nix
//! sandbox's private netns (see `host_ports_empty_in_sandbox_netns`).

mod common;

use common::{
    hermetic_snapshot, hex_of_v4, hex_of_v6, l_addr_for_port, l_rows_for_port, osfacts, parse_tsv,
    redact_tsv, snapshot_pids,
};
use std::net::{Ipv4Addr, Ipv6Addr};

// ── five bind fixtures ──────────────────────────────────────────────────

#[test]
fn fixture_loopback_v4() {
    let h = hermetic_snapshot("127.0.0.1");
    let (v, procs, ports, _) = parse_tsv(&h.tsv);
    assert_eq!(v, 2);
    assert!(
        procs
            .iter()
            .any(|p| p.starts_with(&format!("P\t{}\t", h.listener_pid))),
        "helper pid must appear: {procs:?}"
    );
    assert_eq!(
        l_rows_for_port(&ports, h.port),
        1,
        "fixture port must appear exactly once; ports={ports:?}"
    );
    assert_eq!(
        l_addr_for_port(&ports, h.port),
        hex_of_v4(Ipv4Addr::LOCALHOST)
    );
    insta::assert_snapshot!("fixture_loopback_v4", redact_tsv(&h.tsv));
}

#[test]
fn fixture_any_v4() {
    let h = hermetic_snapshot("0.0.0.0");
    let (_, _, ports, _) = parse_tsv(&h.tsv);
    assert_eq!(
        l_rows_for_port(&ports, h.port),
        1,
        "fixture port must appear exactly once; ports={ports:?}"
    );
    assert_eq!(
        l_addr_for_port(&ports, h.port),
        hex_of_v4(Ipv4Addr::UNSPECIFIED)
    );
    insta::assert_snapshot!("fixture_any_v4", redact_tsv(&h.tsv));
}

#[test]
fn fixture_loopback_v6() {
    let h = match std::panic::catch_unwind(|| hermetic_snapshot("::1")) {
        Ok(h) => h,
        Err(_) => {
            eprintln!("skip: cannot bind ::1");
            return;
        }
    };
    let (_, _, ports, _) = parse_tsv(&h.tsv);
    assert_eq!(
        l_rows_for_port(&ports, h.port),
        1,
        "fixture port must appear exactly once; ports={ports:?}"
    );
    assert_eq!(
        l_addr_for_port(&ports, h.port),
        hex_of_v6(Ipv6Addr::LOCALHOST)
    );
    insta::assert_snapshot!("fixture_loopback_v6", redact_tsv(&h.tsv));
}

#[test]
fn fixture_any_v6() {
    let h = match std::panic::catch_unwind(|| hermetic_snapshot("::")) {
        Ok(h) => h,
        Err(_) => {
            eprintln!("skip: cannot bind ::");
            return;
        }
    };
    let (_, _, ports, _) = parse_tsv(&h.tsv);
    assert_eq!(
        l_rows_for_port(&ports, h.port),
        1,
        "fixture port must appear exactly once; ports={ports:?}"
    );
    let addr = l_addr_for_port(&ports, h.port);
    assert!(
        addr == hex_of_v6(Ipv6Addr::UNSPECIFIED) || addr == hex_of_v4(Ipv4Addr::UNSPECIFIED),
        "expected any-address for :: bind, got {addr}"
    );
    insta::assert_snapshot!("fixture_any_v6", redact_tsv(&h.tsv));
}

#[test]
fn fixture_v4_mapped_loopback() {
    let h = match std::panic::catch_unwind(|| hermetic_snapshot("::ffff:127.0.0.1")) {
        Ok(h) => h,
        Err(_) => {
            eprintln!("skip: cannot bind v4-mapped");
            return;
        }
    };
    let (_, _, ports, _) = parse_tsv(&h.tsv);
    assert_eq!(
        l_rows_for_port(&ports, h.port),
        1,
        "fixture port must appear exactly once; ports={ports:?}"
    );
    let addr = l_addr_for_port(&ports, h.port);
    let v4 = hex_of_v4(Ipv4Addr::LOCALHOST);
    let mapped = hex_of_v6(Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001));
    let compatible = hex_of_v6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0x7f00, 0x0001));
    assert_ne!(addr, compatible, "must not report IPv4-compatible form");
    assert!(
        addr == v4 || addr == mapped,
        "expected {v4} or {mapped}, got {addr}"
    );
    // No insta here: linux /proc and darwin libproc may emit either the
    // 4-byte v4 form or the 16-byte mapped form for the same bind — both
    // are correct; the assertions above pin the scar (not IPv4-compatible).
}

// ── silent-empty / version / json ───────────────────────────────────────

#[test]
fn pid_without_listener_has_no_claimed_listener() {
    // Snapshot a pid that holds no listener: the test process itself.
    // Version + P row is what we assert — empty L means "no listeners", not
    // "saw nothing".
    let pid = std::process::id();
    let tsv = snapshot_pids(pid);
    assert!(
        tsv.starts_with("V\t2\n") || tsv == "V\t2",
        "must begin with version line, got {tsv:?}"
    );
    let (v, procs, ports, _) = parse_tsv(&tsv);
    assert_eq!(v, 2);
    assert!(
        procs.iter().any(|p| p.starts_with(&format!("P\t{pid}\t"))),
        "asked pid must appear so empty L is 'no listeners', not 'saw nothing'"
    );
    // OSF6 emits unrelated host rows as unclaimed. It must not claim one for
    // this exact pid, which holds no listener.
    assert!(
        ports
            .iter()
            .all(|row| !row.starts_with(&format!("L\tclaimed\t{pid}\t"))),
        "test process must have zero claimed L rows; ports={ports:?}"
    );
}

#[test]
fn version_first_on_success() {
    let out = osfacts()
        .args(["snapshot", "--procs"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    assert!(
        stdout.starts_with("V\t2\n") || stdout == "V\t2",
        "stdout must begin V\\t1, got {stdout:?}"
    );
}

#[test]
fn version_first_on_usage_error() {
    let out = osfacts()
        .args(["snapshot", "--no-such-flag"])
        .assert()
        .failure()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    assert!(
        stdout.starts_with("V\t2"),
        "even error paths must open with V\\t1, got {stdout:?}"
    );
}

#[test]
fn json_mirrors_tsv_on_same_snapshot() {
    // Long-lived listener so TSV and JSON see the same socket.
    let listener = common::Listener::spawn("127.0.0.1");
    let pid_s = listener.pid.to_string();
    let tsv_out = osfacts()
        .args(["snapshot", "--pids", &pid_s, "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let json_out = osfacts()
        .args(["snapshot", "--pids", &pid_s, "--procs", "--ports", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let tsv = String::from_utf8(tsv_out).unwrap();
    let json_s = String::from_utf8(json_out).unwrap();
    let (v, _, ports, _) = parse_tsv(&tsv);
    assert_eq!(v, 2);
    let val: serde_json::Value = serde_json::from_str(&json_s).expect("json");
    assert_eq!(val["version"], 2);
    let tsv_addr = l_addr_for_port(&ports, listener.port);
    let json_ports = val["ports"].as_array().expect("ports");
    assert!(
        json_ports.iter().any(|row| {
            row["port"] == listener.port
                && row["address"].as_str() == Some(tsv_addr.as_str())
                && row["pid"] == listener.pid
                && row["status"] == "claimed"
        }),
        "json must mirror tsv L row; json={json_ports:?}"
    );
}

#[test]
fn roots_includes_helper_process() {
    let h = hermetic_snapshot("127.0.0.1");
    let (v, procs, ports, _) = parse_tsv(&h.tsv);
    assert_eq!(v, 2);
    assert!(
        procs
            .iter()
            .any(|p| p.starts_with(&format!("P\t{}\t", h.listener_pid))),
        "root pid must appear; procs={procs:?}"
    );
    assert_eq!(
        l_rows_for_port(&ports, h.port),
        1,
        "fixture port must appear exactly once; ports={ports:?}"
    );
}

/// The one remaining "table is empty" pin: host-wide `--ports` with zero L
/// rows. Exists only when positively inside a nix build sandbox
/// (`NIX_BUILD_TOP` is set — the builder's private netns starts empty). On a
/// noisy dev box this test does not exist (returns without asserting).
/// nextest runs it alone so sibling bind fixtures cannot race the empty claim.
#[cfg(target_os = "linux")]
#[test]
fn host_ports_empty_in_sandbox_netns() {
    if std::env::var_os("NIX_BUILD_TOP").is_none() {
        // Outside the sandbox: no claim, no fail — the test does not exist.
        return;
    }
    let out = osfacts()
        .args(["snapshot", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (v, _, ports, _) = parse_tsv(&stdout);
    assert_eq!(v, 2);
    assert!(
        ports.is_empty(),
        "nix sandbox netns must start with zero listeners; ports={ports:?}"
    );
}
