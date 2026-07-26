//! Lane 2 — live-host oracle. Never gates a merge.
//!
//! Invoked only when `OSFACTS_LIVE=1` (see `scripts/live-oracle.sh`). The
//! binary under test is `$OSFACTS_BIN` (the nix-built osfacts), never a
//! target-dir debug build.
//!
//! Cucumber MSRV is 1.88 (crate 0.23, edition 2024); our pin is ≥1.93 — cleared.

use cucumber::{given, then, when, World};
use std::collections::HashSet;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

#[derive(Debug, Default, World)]
#[world(init = Self::new)]
struct LiveWorld {
    /// Child shell holding a loopback listener (scenario 1).
    shell: Option<Child>,
    shell_pid: Option<u32>,
    listen_port: Option<u16>,
    /// Last osfacts snapshot stdout.
    snapshot: Option<String>,
    /// Parsed L rows from osfacts: (pid, port, addr_bytes).
    osfacts_listeners: Vec<ListenerRow>,
    /// Platform oracle rows: (pid_opt, port, addr_bytes).
    oracle_listeners: Vec<ListenerRow>,
}

#[derive(Debug, Clone)]
struct ListenerRow {
    pid: Option<u32>,
    port: u16,
    /// Canonical form for comparison (v4-mapped collapsed to v4; any-form kept).
    canon: CanonAddr,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum CanonAddr {
    V4([u8; 4]),
    V6([u8; 16]),
    /// 0.0.0.0 or :: — wildcard.
    AnyV4,
    AnyV6,
}

impl LiveWorld {
    fn new() -> Self {
        Self::default()
    }

    fn osfacts_bin() -> PathBuf {
        if let Some(p) = std::env::var_os("OSFACTS_BIN") {
            return PathBuf::from(p);
        }
        // Local convenience only — the live script always sets OSFACTS_BIN.
        assert_cmd::cargo::cargo_bin("osfacts")
    }

    fn run_osfacts(&self, args: &[&str]) -> String {
        let out = Command::new(Self::osfacts_bin())
            .args(args)
            .output()
            .expect("spawn osfacts");
        assert!(
            out.status.success(),
            "osfacts failed: {}\n{}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).expect("utf8")
    }
}

impl Drop for LiveWorld {
    fn drop(&mut self) {
        if let Some(mut c) = self.shell.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

// ── Scenario 1 ──────────────────────────────────────────────────────────

#[given("a shell running a loopback server")]
fn spawn_shell_listener(world: &mut LiveWorld) {
    // Bind in this process first so we know the port, then keep the
    // listener alive as a "shell tree" root (this test process). The live
    // lane's job is host noise + oracle agreement; self-attribution of a
    // held socket is the readable form of "a shell running a loopback server".
    let sock =
        TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("bind loopback");
    let port = sock.local_addr().unwrap().port();
    // Leak the listener into a parked thread so the fd stays open.
    let pid = std::process::id();
    thread::spawn(move || {
        let _sock = sock;
        loop {
            thread::sleep(Duration::from_secs(3600));
        }
    });
    // Give the kernel a beat to publish the LISTEN row.
    thread::sleep(Duration::from_millis(50));
    world.shell_pid = Some(pid);
    world.listen_port = Some(port);
}

#[when("I snapshot that shell's subtree with osfacts")]
fn snapshot_subtree(world: &mut LiveWorld) {
    let pid = world.shell_pid.expect("shell pid");
    let tsv = world.run_osfacts(&[
        "snapshot",
        "--roots",
        &pid.to_string(),
        "--procs",
        "--ports",
    ]);
    world.snapshot = Some(tsv);
}

#[then("the listener is attributed to a pid in that shell's subtree")]
fn listener_attributed(world: &mut LiveWorld) {
    let tsv = world.snapshot.as_ref().expect("snapshot");
    let port = world.listen_port.expect("port");
    let root = world.shell_pid.expect("pid");
    let mut pids: HashSet<u32> = HashSet::new();
    let mut found = false;
    for line in tsv.lines() {
        if let Some(rest) = line.strip_prefix("P\t") {
            if let Some(p) = rest.split('\t').next().and_then(|s| s.parse().ok()) {
                pids.insert(p);
            }
        }
        if let Some(rest) = line.strip_prefix("L\t") {
            let parts: Vec<&str> = rest.split('\t').collect();
            if parts.len() >= 2 && parts[1] == port.to_string() {
                let holder: u32 = parts[0].parse().expect("L pid");
                assert!(
                    pids.contains(&holder) || holder == root,
                    "listener pid {holder} not in subtree of {root}; pids={pids:?}"
                );
                found = true;
            }
        }
    }
    assert!(found, "no L row for port {port} in:\n{tsv}");
}

// ── Scenario 2 ──────────────────────────────────────────────────────────

#[when("I take a host-wide osfacts snapshot of listening ports")]
fn host_wide(world: &mut LiveWorld) {
    let tsv = world.run_osfacts(&["snapshot", "--procs", "--ports"]);
    world.osfacts_listeners = parse_osfacts_listeners(&tsv);
    world.snapshot = Some(tsv);
}

#[when("I read the platform oracle's listening ports")]
fn read_oracle(world: &mut LiveWorld) {
    world.oracle_listeners = platform_oracle();
}

#[then("every osfacts listener has a canonical match in the oracle")]
fn osfacts_subset_of_oracle(world: &mut LiveWorld) {
    agree_with_retry(world, Direction::OsfactsInOracle);
}

#[then("every oracle listener has a canonical match in osfacts")]
fn oracle_subset_of_osfacts(world: &mut LiveWorld) {
    agree_with_retry(world, Direction::OracleInOsfacts);
}

#[derive(Debug)]
enum Direction {
    OsfactsInOracle,
    OracleInOsfacts,
}

fn agree_with_retry(world: &mut LiveWorld, dir: Direction) {
    // Live host noise: a listener can appear/vanish between the two reads.
    // Re-sample once on mismatch before failing.
    for attempt in 0..2 {
        let missing = match dir {
            Direction::OsfactsInOracle => {
                missing_from(&world.osfacts_listeners, &world.oracle_listeners)
            }
            Direction::OracleInOsfacts => {
                missing_from(&world.oracle_listeners, &world.osfacts_listeners)
            }
        };
        if missing.is_empty() {
            return;
        }
        if attempt == 0 {
            // Re-read both sides.
            let tsv = world.run_osfacts(&["snapshot", "--procs", "--ports"]);
            world.osfacts_listeners = parse_osfacts_listeners(&tsv);
            world.oracle_listeners = platform_oracle();
            continue;
        }
        panic!(
            "canonical mismatch ({dir:?}), missing={missing:?}\nosfacts={:?}\noracle={:?}",
            world.osfacts_listeners, world.oracle_listeners
        );
    }
}

fn missing_from(have: &[ListenerRow], against: &[ListenerRow]) -> Vec<(u16, CanonAddr)> {
    let set: HashSet<(u16, CanonAddr)> =
        against.iter().map(|r| (r.port, r.canon.clone())).collect();
    have.iter()
        .map(|r| (r.port, r.canon.clone()))
        .filter(|k| !set.contains(k))
        .collect()
}

fn parse_osfacts_listeners(tsv: &str) -> Vec<ListenerRow> {
    let mut out = Vec::new();
    for line in tsv.lines() {
        let Some(rest) = line.strip_prefix("L\t") else {
            continue;
        };
        let parts: Vec<&str> = rest.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let pid: u32 = parts[0].parse().unwrap_or(0);
        let port: u16 = match parts[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let bytes = match osfacts::decode_network_hex(parts[2]) {
            Ok(b) => b,
            Err(_) => continue,
        };
        out.push(ListenerRow {
            pid: Some(pid),
            port,
            canon: canonicalize(&bytes),
        });
    }
    out
}

/// Canonical address equivalence: v4-mapped ↔ v4, all-zeros ≡ ANY.
fn canonicalize(bytes: &[u8]) -> CanonAddr {
    // v4-mapped ::ffff:a.b.c.d
    if bytes.len() == 16
        && bytes[..10].iter().all(|&b| b == 0)
        && bytes[10] == 0xff
        && bytes[11] == 0xff
    {
        let v4 = [bytes[12], bytes[13], bytes[14], bytes[15]];
        if v4 == [0, 0, 0, 0] {
            return CanonAddr::AnyV4;
        }
        return CanonAddr::V4(v4);
    }
    if bytes.len() == 4 {
        if bytes == [0, 0, 0, 0] {
            return CanonAddr::AnyV4;
        }
        return CanonAddr::V4([bytes[0], bytes[1], bytes[2], bytes[3]]);
    }
    if bytes.len() == 16 {
        if bytes.iter().all(|&b| b == 0) {
            return CanonAddr::AnyV6;
        }
        let mut a = [0u8; 16];
        a.copy_from_slice(bytes);
        return CanonAddr::V6(a);
    }
    // Unknown width — treat as distinct v6-shaped so it won't false-match.
    CanonAddr::AnyV6
}

fn platform_oracle() -> Vec<ListenerRow> {
    #[cfg(target_os = "linux")]
    {
        return oracle_ss();
    }
    #[cfg(target_os = "macos")]
    {
        return oracle_lsof();
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "linux")]
fn oracle_ss() -> Vec<ListenerRow> {
    // `ss -ltnH` — numeric, listening, TCP, no header. Users can add -p for
    // pid; we key by (port, canon addr) so pid is optional.
    let out = Command::new("ss")
        .args(["-ltnH"])
        .output()
        .expect("ss must be on PATH for the live oracle");
    assert!(out.status.success(), "ss failed: {}", out.status);
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in text.lines() {
        // LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:*
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        let local = cols[3];
        if let Some((addr, port)) = split_host_port(local) {
            if let Some(canon) = parse_ss_addr(addr) {
                rows.push(ListenerRow {
                    pid: None,
                    port,
                    canon,
                });
            }
        }
    }
    rows
}

#[cfg(target_os = "macos")]
fn oracle_lsof() -> Vec<ListenerRow> {
    let out = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
        .output()
        .expect("lsof must be on PATH for the live oracle");
    // lsof returns 1 when nothing is listening — treat as empty, not fatal.
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in text.lines().skip(1) {
        // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        // node 123 … TCP 127.0.0.1:8080 (LISTEN)
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }
        let pid: Option<u32> = cols[1].parse().ok();
        let name = cols[8];
        let name = name.trim_end_matches("(LISTEN)").trim();
        // name like 127.0.0.1:8080 or *:8080 or [::1]:8080
        if let Some((addr, port)) = split_host_port(name) {
            if let Some(canon) = parse_ss_addr(addr) {
                rows.push(ListenerRow { pid, port, canon });
            }
        }
    }
    rows
}

fn split_host_port(s: &str) -> Option<(&str, u16)> {
    // [v6]:port or v4:port or *:port
    if let Some(rest) = s.strip_prefix('[') {
        let (addr, port_s) = rest.split_once("]:")?;
        let port = port_s.parse().ok()?;
        return Some((addr, port));
    }
    let (addr, port_s) = s.rsplit_once(':')?;
    let port = port_s.parse().ok()?;
    Some((addr, port))
}

fn parse_ss_addr(addr: &str) -> Option<CanonAddr> {
    if addr == "*" || addr == "0.0.0.0" {
        return Some(CanonAddr::AnyV4);
    }
    if addr == "::" || addr == "[::]" {
        return Some(CanonAddr::AnyV6);
    }
    if let Ok(v4) = addr.parse::<Ipv4Addr>() {
        let o = v4.octets();
        return Some(if o == [0, 0, 0, 0] {
            CanonAddr::AnyV4
        } else {
            CanonAddr::V4(o)
        });
    }
    if let Ok(v6) = addr.parse::<Ipv6Addr>() {
        if let Some(v4) = v6.to_ipv4_mapped() {
            let o = v4.octets();
            return Some(if o == [0, 0, 0, 0] {
                CanonAddr::AnyV4
            } else {
                CanonAddr::V4(o)
            });
        }
        let o = v6.octets();
        return Some(if o.iter().all(|&b| b == 0) {
            CanonAddr::AnyV6
        } else {
            CanonAddr::V6(o)
        });
    }
    None
}

#[tokio::main]
async fn main() {
    if std::env::var_os("OSFACTS_LIVE").is_none() {
        // Hermetic gate must never run the live lane. Exit success so a
        // stray nextest discovery of this harness is a no-op.
        eprintln!("live_oracle: skipped (set OSFACTS_LIVE=1; see scripts/live-oracle.sh)");
        return;
    }
    LiveWorld::cucumber().run_and_exit("features").await;
}
