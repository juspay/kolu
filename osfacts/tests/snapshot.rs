//! Scar-tissue integration suite for OSF1.
//!
//! Each case is a bug that actually happened (or a contract the plan of record
//! names as mandatory). The suite spawns the real binary via assert_cmd.

use assert_cmd::Command;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};

fn osfacts() -> Command {
    Command::cargo_bin("osfacts").expect("osfacts binary")
}

/// Parse TSV stdout into (version, P rows, L rows, U rows).
fn parse_tsv(stdout: &str) -> (u32, Vec<String>, Vec<String>, Vec<String>) {
    let mut lines = stdout.lines();
    let first = lines.next().expect("stdout must have a version line");
    let version = first
        .strip_prefix("V\t")
        .expect("first line must be V\\tN")
        .parse::<u32>()
        .expect("version number");
    let mut procs = Vec::new();
    let mut ports = Vec::new();
    let mut unreadable = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        match line.as_bytes().first() {
            Some(b'P') => procs.push(line.to_string()),
            Some(b'L') => ports.push(line.to_string()),
            Some(b'U') => unreadable.push(line.to_string()),
            other => panic!("unexpected row tag {other:?} in {line}"),
        }
    }
    (version, procs, ports, unreadable)
}

fn hex_of_v4(a: Ipv4Addr) -> String {
    a.octets().iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_of_v6(a: Ipv6Addr) -> String {
    a.octets().iter().map(|b| format!("{b:02x}")).collect()
}

/// Find the L row for `port` and return its raw hex address field.
fn l_addr_for_port(ports: &[String], port: u16) -> String {
    for row in ports {
        // L\t{pid}\t{port}\t{hex}
        let parts: Vec<&str> = row.split('\t').collect();
        assert_eq!(parts.len(), 4, "L row arity: {row}");
        assert_eq!(parts[0], "L");
        if parts[2] == port.to_string() {
            return parts[3].to_string();
        }
    }
    panic!("no L row for port {port}; rows={ports:?}");
}

// ── five bind fixtures ──────────────────────────────────────────────────

#[test]
fn fixture_loopback_v4() {
    let sock = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
    let port = sock.local_addr().unwrap().port();
    let pid = std::process::id();

    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (v, _p, ports, _u) = parse_tsv(&stdout);
    assert_eq!(v, 1);
    assert_eq!(
        l_addr_for_port(&ports, port),
        hex_of_v4(Ipv4Addr::LOCALHOST)
    );
}

#[test]
fn fixture_any_v4() {
    let sock = TcpListener::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0))).unwrap();
    let port = sock.local_addr().unwrap().port();
    let pid = std::process::id();

    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (_, _, ports, _) = parse_tsv(&stdout);
    assert_eq!(
        l_addr_for_port(&ports, port),
        hex_of_v4(Ipv4Addr::UNSPECIFIED)
    );
}

#[test]
fn fixture_loopback_v6() {
    let sock = match TcpListener::bind(SocketAddr::from((Ipv6Addr::LOCALHOST, 0))) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("skip: no IPv6 loopback ({e})");
            return;
        }
    };
    let port = sock.local_addr().unwrap().port();
    let pid = std::process::id();

    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (_, _, ports, _) = parse_tsv(&stdout);
    assert_eq!(
        l_addr_for_port(&ports, port),
        hex_of_v6(Ipv6Addr::LOCALHOST)
    );
}

#[test]
fn fixture_any_v6() {
    let sock = match TcpListener::bind(SocketAddr::from((Ipv6Addr::UNSPECIFIED, 0))) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("skip: no IPv6 any ({e})");
            return;
        }
    };
    let port = sock.local_addr().unwrap().port();
    let pid = std::process::id();

    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (_, _, ports, _) = parse_tsv(&stdout);
    // Dual-stack flag ordering is unit-tested on the vendored decode; here we
    // only require the L row's raw bytes match a `::` bind (16 zero bytes).
    // On linux IPV6_V6ONLY defaults vary — accept either 16-byte `::` or the
    // kernel's actual representation as long as it is the any-address form.
    let addr = l_addr_for_port(&ports, port);
    assert!(
        addr == hex_of_v6(Ipv6Addr::UNSPECIFIED) || addr == hex_of_v4(Ipv4Addr::UNSPECIFIED),
        "expected any-address bytes for :: bind, got {addr}"
    );
}

#[test]
fn fixture_v4_mapped_loopback() {
    // ::ffff:127.0.0.1 — the scar that upstream listeners mis-reported as
    // ::127.0.0.1 (IPv4-compatible). Our emission follows the C helper: the
    // four-byte v4 form, not the 16-byte mapped one.
    let mapped = Ipv6Addr::new(0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001);
    let sock = match TcpListener::bind(SocketAddr::new(std::net::IpAddr::V6(mapped), 0)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("skip: cannot bind v4-mapped ({e})");
            return;
        }
    };
    let port = sock.local_addr().unwrap().port();
    let pid = std::process::id();

    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (_, _, ports, _) = parse_tsv(&stdout);
    let addr = l_addr_for_port(&ports, port);
    // Accept either the four-byte v4 form (C helper / our contract) or the
    // 16-byte mapped form — never the IPv4-compatible `::127.0.0.1`.
    let v4 = hex_of_v4(Ipv4Addr::LOCALHOST);
    let mapped_hex = hex_of_v6(mapped);
    let compatible = hex_of_v6(Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0x7f00, 0x0001));
    assert_ne!(addr, compatible, "must not report IPv4-compatible form");
    assert!(
        addr == v4 || addr == mapped_hex,
        "expected {v4} or {mapped_hex}, got {addr}"
    );
}

// ── silent-empty ────────────────────────────────────────────────────────

#[test]
fn silent_empty_is_versioned_success_with_zero_listeners() {
    // A success with no L rows must still open with V\t1 so a consumer can
    // tell "no listeners in scope" from "empty internet table, successfully"
    // (macOS netstat's intermittent blindness).
    let pid = std::process::id();
    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    assert!(
        stdout.starts_with("V\t1\n") || stdout == "V\t1",
        "stdout must begin with version line, got {stdout:?}"
    );
    let (v, procs, _ports, _u) = parse_tsv(&stdout);
    assert_eq!(v, 1);
    // The asked pid is readable; we must see at least that P row so an empty
    // L set is "no listeners", not "saw nothing".
    assert!(
        procs.iter().any(|p| p.starts_with(&format!("P\t{pid}\t"))),
        "expected a P row for the asked pid; procs={procs:?}"
    );
}

// ── unreadable ──────────────────────────────────────────────────────────

#[test]
fn unreadable_pid_appears_as_u_row() {
    // A vanished / never-existed pid must surface as U, never as a silent
    // absence (the sudo lesson: blindness is output, not empty success).
    let gone = 2_147_483_646u32; // INT_MAX-1 — not a live pid on any sane box
    let out = osfacts()
        .args([
            "snapshot",
            "--pids",
            &gone.to_string(),
            "--procs",
            "--ports",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (v, procs, _ports, unreadable) = parse_tsv(&stdout);
    assert_eq!(v, 1);
    assert!(
        procs
            .iter()
            .all(|p| !p.starts_with(&format!("P\t{gone}\t"))),
        "must not invent a P row for an unreadable pid"
    );
    assert!(
        unreadable
            .iter()
            .any(|u| u.starts_with(&format!("U\t{gone}\t"))),
        "expected a U row for pid {gone}; unreadable={unreadable:?}"
    );
}

// ── version-first ───────────────────────────────────────────────────────

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
        stdout.starts_with("V\t1\n") || stdout == "V\t1",
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
        stdout.starts_with("V\t1\n") || stdout == "V\t1" || stdout.starts_with("V\t1"),
        "even error paths must open with V\\t1, got {stdout:?}"
    );
}

// ── --json mirrors TSV ──────────────────────────────────────────────────

#[test]
fn json_mirrors_tsv_on_same_snapshot() {
    let sock = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).unwrap();
    let port = sock.local_addr().unwrap().port();
    let pid = std::process::id();
    let pid_s = pid.to_string();

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
    let (v, procs, ports, _unreadable) = parse_tsv(&tsv);
    assert_eq!(v, 1);
    assert!(
        procs.iter().any(|p| p.starts_with(&format!("P\t{pid}\t"))),
        "tsv must list the asked pid"
    );

    let v: serde_json::Value = serde_json::from_str(&json_s).expect("json");
    assert_eq!(v["version"], 1);

    // Compare the listener WE hold — not total port counts. Other tests in this
    // process may bind sockets in parallel, so the full L set is not stable
    // across two sequential spawns.
    let tsv_addr = l_addr_for_port(&ports, port);
    let json_ports = v["ports"].as_array().expect("ports array");
    let found = json_ports.iter().any(|row| {
        row["port"] == port
            && row["address"].as_str() == Some(tsv_addr.as_str())
            && row["pid"] == pid
    });
    assert!(
        found,
        "json ports must mirror tsv L row for port {port} addr {tsv_addr}; json={json_ports:?}"
    );
    let json_procs = v["procs"].as_array().expect("procs array");
    assert!(
        json_procs.iter().any(|row| row["pid"] == pid),
        "json must list the asked pid"
    );
}

// ── --roots scopes to a live subtree ────────────────────────────────────

#[test]
fn roots_includes_self_process() {
    let pid = std::process::id();
    let out = osfacts()
        .args([
            "snapshot",
            "--roots",
            &pid.to_string(),
            "--procs",
            "--ports",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let stdout = String::from_utf8(out).unwrap();
    let (v, procs, _, _) = parse_tsv(&stdout);
    assert_eq!(v, 1);
    assert!(
        procs.iter().any(|p| p.starts_with(&format!("P\t{pid}\t"))),
        "root pid must appear in P rows; procs={procs:?}"
    );
}

/// Sanity: the binary is what cargo built (not a PATH phantom).
#[test]
fn binary_is_cargo_built() {
    let path = assert_cmd::cargo::cargo_bin("osfacts");
    assert!(path.exists(), "cargo-bin path missing: {path:?}");
}
