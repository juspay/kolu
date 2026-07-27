//! Lane 2 — live-host oracle. Runs every full `/ci`, and gates like every
//! other lane: `ci::osfacts-live` is branch-protected on both platforms.
//!
//! Invoked only when `OSFACTS_LIVE=1` (see `scripts/live-oracle.sh`). The
//! binary under test is `$OSFACTS_BIN` (the nix-built osfacts), never a
//! target-dir debug build.
//!
//! Host-wide agreement is privilege-honest. osfacts reads the kernel listener
//! table and emits unclaimed rows even when it cannot inspect the owner. Linux
//! `ss` sees those same kernel rows, while unprivileged Darwin `lsof` omits
//! listeners owned by unreadable processes. Therefore Darwin osfacts→lsof
//! agreement covers claimed rows; lsof→osfacts still covers every oracle row.
//!
//! Cucumber MSRV is 1.88 (crate 0.23, edition 2024); our pin is ≥1.93 — cleared.

use cucumber::{given, then, when, World};
use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process::{Child, Command};
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
    /// Pids osfacts reported as unreadable (`U` rows) on the last snapshot.
    unreadable_pids: HashSet<u32>,
    host_first: Option<String>,
    host_second: Option<String>,
    #[cfg(target_os = "macos")]
    ps_process_count: Option<usize>,
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
            if parts.len() == 5 && parts[0] == "claimed" && parts[3] == port.to_string() {
                let holder: u32 = parts[1].parse().expect("L pid");
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
    world.unreadable_pids = parse_unreadable_pids(&tsv);
    world.snapshot = Some(tsv);
}

#[when("I read the platform oracle's listening ports")]
fn read_oracle(world: &mut LiveWorld) {
    world.oracle_listeners = platform_oracle();
}

#[then("every osfacts listener visible to the platform oracle has a canonical match")]
fn osfacts_subset_of_oracle(world: &mut LiveWorld) {
    agree_with_retry(world, Direction::OsfactsInOracle);
}

#[then("every oracle listener has a canonical match in osfacts")]
fn oracle_subset_of_osfacts(world: &mut LiveWorld) {
    agree_with_retry(world, Direction::OracleInOsfacts);
}

#[when("I snapshot this process's memory and start time")]
fn snapshot_memory_and_start(world: &mut LiveWorld) {
    let pid = std::process::id().to_string();
    world.snapshot =
        Some(world.run_osfacts(&["snapshot", "--pids", &pid, "--mem", "--start-time"]));
}

#[then("osfacts reports positive RSS and a past start instant")]
fn memory_and_start_are_real(world: &mut LiveWorld) {
    let pid = std::process::id();
    let body = world.snapshot.as_ref().expect("snapshot");
    let memory = body
        .lines()
        .find_map(|line| line.strip_prefix(&format!("M\t{pid}\t")))
        .and_then(|raw| raw.parse::<u64>().ok())
        .expect("M row for current process");
    let start = body
        .lines()
        .find_map(|line| line.strip_prefix(&format!("S\t{pid}\t")))
        .and_then(|raw| raw.parse::<u64>().ok())
        .expect("S row for current process");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_micros() as u64;
    assert!(memory > 0, "RSS must be positive: {body}");
    assert!(
        start > 0 && start <= now,
        "start instant must be in the past: {body}"
    );
}

#[when("I snapshot launchd's subtree as an unprivileged darwin user")]
fn snapshot_launchd_subtree(_world: &mut LiveWorld) {
    #[cfg(target_os = "macos")]
    {
        let world = _world;
        assert_ne!(
            unsafe { libc::geteuid() },
            0,
            "fixture requires a non-root user"
        );
        let ps = Command::new("ps")
            .args(["-axo", "pid="])
            .output()
            .expect("ps must be available on darwin");
        assert!(ps.status.success(), "ps failed: {}", ps.status);
        world.ps_process_count = Some(
            String::from_utf8(ps.stdout)
                .expect("ps utf8")
                .lines()
                .filter(|line| line.trim().parse::<u32>().is_ok())
                .count(),
        );
        world.snapshot = Some(world.run_osfacts(&[
            "snapshot",
            "--roots",
            "1",
            "--procs",
            "--ports",
            "--mem",
            "--start-time",
        ]));
    }
}

#[then("the snapshot reports launchd's readable process tree without hiding its blindness")]
fn launchd_tree_survives_unreadable_root(_world: &mut LiveWorld) {
    #[cfg(target_os = "macos")]
    {
        let world = _world;
        let body = world.snapshot.as_ref().expect("snapshot");
        let osfacts_count = body.lines().filter(|line| line.starts_with("P\t")).count();
        let ps_count = world.ps_process_count.expect("ps count");
        assert!(
            body.lines().any(|line| {
                line.starts_with("U\t1\tproc\t")
                    && (line.ends_with("EPERM") || line.ends_with("EACCES"))
            }),
            "launchd must be reported unreadable:\n{body}"
        );
        assert!(
            osfacts_count > 1,
            "an unreadable launchd must not collapse its subtree to one row:\n{body}"
        );
        assert!(
            osfacts_count.saturating_mul(2) >= ps_count,
            "osfacts process count must be comparable to ps: osfacts={osfacts_count}, ps={ps_count}\n{body}"
        );
    }
}

#[when("I take two complete host snapshots")]
fn two_host_snapshots(world: &mut LiveWorld) {
    let args = ["host", "--load", "--mem", "--cpu", "--net", "--disk"];
    world.host_first = Some(world.run_osfacts(&args));
    thread::sleep(Duration::from_millis(20));
    world.host_second = Some(world.run_osfacts(&args));
}

#[then("host gauges are sane and cumulative counters do not decrease")]
fn host_facts_are_sane(world: &mut LiveWorld) {
    let first = world.host_first.as_ref().expect("first host snapshot");
    let second = world.host_second.as_ref().expect("second host snapshot");
    for tag in [
        "HLOAD\t", "HMEM\t", "HSWAP\t", "HUP\t", "HCPU\t", "HNET\t", "HDISK\t",
    ] {
        assert!(
            second.lines().any(|line| line.starts_with(tag)),
            "missing {tag} in:\n{second}"
        );
    }
    let counters = |body: &str, tag: &str| -> HashMap<String, Vec<u64>> {
        body.lines()
            .filter_map(|line| {
                let fields: Vec<&str> = line.split('\t').collect();
                if fields.first().copied() != Some(tag) {
                    return None;
                }
                let values = fields[2..]
                    .iter()
                    .map(|raw| raw.parse::<u64>().expect("counter"))
                    .collect();
                Some((fields[1].to_owned(), values))
            })
            .collect()
    };
    for tag in ["HCPU", "HNET"] {
        let before = counters(first, tag);
        let after = counters(second, tag);
        assert!(!after.is_empty(), "no {tag} rows");
        for (key, values) in before {
            if let Some(next) = after.get(&key) {
                assert!(
                    values.iter().zip(next).all(|(a, b)| b >= a),
                    "{tag} {key} decreased: {values:?} -> {next:?}"
                );
            }
        }
    }
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
                let visible: Vec<ListenerRow> = world
                    .osfacts_listeners
                    .iter()
                    .filter(|row| visible_to_platform_oracle(row))
                    .cloned()
                    .collect();
                missing_from(&visible, &world.oracle_listeners)
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
            world.unreadable_pids = parse_unreadable_pids(&tsv);
            world.oracle_listeners = platform_oracle();
            continue;
        }
        panic!(
            "canonical mismatch ({dir:?}), missing={missing:?}\nosfacts={:?}\noracle={:?}\nunreadable={:?}",
            world.osfacts_listeners, world.oracle_listeners, world.unreadable_pids
        );
    }
}

fn visible_to_platform_oracle(row: &ListenerRow) -> bool {
    #[cfg(target_os = "macos")]
    {
        // `lsof` run as the CI user cannot enumerate root-owned descriptors.
        // pcblist_n still exposes those sockets, correctly as unclaimed rows.
        row.pid.is_some()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = row.pid;
        true
    }
}

fn missing_from(have: &[ListenerRow], against: &[ListenerRow]) -> Vec<(u16, CanonAddr)> {
    // Dual-stack wildcard: osfacts may report `::` (AnyV6) while lsof/ss show
    // `*` / `0.0.0.0` (AnyV4) for the same listener. Collapse both to one key
    // so host tools that disagree on family still agree on "wildcard:port".
    let set: HashSet<(u16, MatchCanon)> = against
        .iter()
        .map(|r| match_key(r.port, &r.canon))
        .collect();
    have.iter()
        .filter(|r| !set.contains(&match_key(r.port, &r.canon)))
        .map(|r| (r.port, r.canon.clone()))
        .collect()
}

/// Comparison key for live-oracle agreement — collapses AnyV4/AnyV6.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum MatchCanon {
    V4([u8; 4]),
    V6([u8; 16]),
    Any,
}

fn match_key(port: u16, canon: &CanonAddr) -> (u16, MatchCanon) {
    let mc = match canon {
        CanonAddr::V4(a) => MatchCanon::V4(*a),
        CanonAddr::V6(a) => MatchCanon::V6(*a),
        CanonAddr::AnyV4 | CanonAddr::AnyV6 => MatchCanon::Any,
    };
    (port, mc)
}

fn parse_unreadable_pids(tsv: &str) -> HashSet<u32> {
    let mut out = HashSet::new();
    for line in tsv.lines() {
        let Some(rest) = line.strip_prefix("U\t") else {
            continue;
        };
        if let Some(pid_s) = rest.split('\t').next() {
            if let Ok(pid) = pid_s.parse::<u32>() {
                out.insert(pid);
            }
        }
    }
    out
}

fn parse_osfacts_listeners(tsv: &str) -> Vec<ListenerRow> {
    let mut out = Vec::new();
    for line in tsv.lines() {
        let Some(rest) = line.strip_prefix("L\t") else {
            continue;
        };
        let parts: Vec<&str> = rest.split('\t').collect();
        if parts.len() != 5 {
            continue;
        }
        let pid = match parts[0] {
            "claimed" => parts[1].parse().ok(),
            "unclaimed" => None,
            _ => continue,
        };
        let port: u16 = match parts[3].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let bytes = match osfacts::decode_network_hex(parts[4]) {
            Ok(b) => b,
            Err(_) => continue,
        };
        out.push(ListenerRow {
            pid,
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
    // `ss -ltnpH` — numeric, listening, TCP, processes when permitted, no
    // header. Pid is None when the kernel withholds process info (other uid);
    // Oracle→osfacts skips those (see agree_with_retry).
    let out = Command::new("ss")
        .args(["-ltnpH"])
        .output()
        .expect("ss must be on PATH for the live oracle");
    assert!(out.status.success(), "ss failed: {}", out.status);
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rows = Vec::new();
    for line in text.lines() {
        // LISTEN 0 4096 127.0.0.1:8080 0.0.0.0:* users:(("node",pid=123,fd=4))
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 {
            continue;
        }
        let local = cols[3];
        let pid = line.find("pid=").and_then(|i| {
            let rest = &line[i + 4..];
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            rest[..end].parse().ok()
        });
        if let Some((addr, port)) = split_host_port(local) {
            if let Some(canon) = parse_ss_addr(addr) {
                rows.push(ListenerRow { pid, port, canon });
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
