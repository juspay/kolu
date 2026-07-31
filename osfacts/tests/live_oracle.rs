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

use cucumber::{World, given, then, when};
use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::thread;
use std::time::Duration;
#[cfg(target_os = "macos")]
use std::time::Instant;

// The extra-facet cost has TWO drivers, not one.
//
// `--ports` walks every process's file descriptors, so it scales with
// DESCRIPTOR count; the remaining facets read a file or two per process, so
// they scale with PROCESS count. Budgeting the whole thing per-process measured
// the wrong denominator for the dominant term — on a workstation the two
// happen to track each other, but a CI container runs few processes while a
// build daemon holds thousands of descriptors, and there the fd walk alone is
// ~20 ms against a 3.75 ms allowance. This smoke failed on every CI host it
// ever ran on while passing on the ~450-process box it was calibrated against.
//
// Measured on an idle 407-process / 2725-descriptor workstation: the `--ports`
// facet costs 6.0 us per readable descriptor, and the other seven facets
// together cost ~15 us per process. Both budgets carry roughly 3x headroom for
// a contended CI box, which is what makes this a smoke rather than a benchmark.
const LINUX_EXTRA_FACETS_CPU_BUDGET_US_PER_PROCESS: u128 = 75;
const LINUX_PORTS_CPU_BUDGET_US_PER_FD: u128 = 20;

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
    cpu_time_first: Option<u64>,
    cpu_time_second: Option<u64>,
    cpu_time_oracle_delta: Option<u64>,
    #[cfg(target_os = "macos")]
    foreign_process_snapshot: Option<ForeignProcessSnapshot>,
    linux_perf_baseline_samples: Vec<Duration>,
    linux_perf_samples: Vec<Duration>,
    linux_perf_process_count: Option<usize>,
    linux_perf_fd_count: Option<usize>,
}

/// How many processes exist, and how many of their descriptors this uid can
/// read — the two quantities the extra-facet cost is actually a function of.
#[cfg(target_os = "linux")]
fn linux_proc_census() -> (usize, usize) {
    let mut processes = 0;
    let mut descriptors = 0;
    for entry in std::fs::read_dir("/proc").expect("read /proc").flatten() {
        if entry.file_name().to_string_lossy().parse::<u32>().is_err() {
            continue;
        }
        processes += 1;
        if let Ok(fds) = std::fs::read_dir(entry.path().join("fd")) {
            descriptors += fds.count();
        }
    }
    (processes, descriptors)
}

#[derive(Debug, Clone)]
struct ListenerRow {
    pid: Option<u32>,
    port: u16,
    /// Canonical form for comparison (v4-mapped collapsed to v4; any-form kept).
    canon: CanonAddr,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
struct ForeignProcessOracle {
    pid: u32,
    uid: u32,
    ppid: u32,
    elapsed_seconds: u64,
    name: String,
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct ForeignProcessSnapshot {
    started_at: Instant,
    finished_at: Instant,
    rows: Vec<ForeignProcessOracle>,
}

#[cfg(target_os = "macos")]
fn parse_ps_elapsed(value: &str) -> Option<u64> {
    let (days, clock) = match value.split_once('-') {
        Some((days, clock)) => (days.parse::<u64>().ok()?, clock),
        None => (0, value),
    };
    let parts = clock
        .split(':')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (0, *minutes, *seconds),
        [hours, minutes, seconds] => (*hours, *minutes, *seconds),
        _ => return None,
    };
    Some(
        days.saturating_mul(86_400)
            .saturating_add(hours.saturating_mul(3_600))
            .saturating_add(minutes.saturating_mul(60))
            .saturating_add(seconds),
    )
}

#[cfg(target_os = "macos")]
fn foreign_processes_from_ps(own_uid: u32) -> ForeignProcessSnapshot {
    let started_at = Instant::now();
    let output = Command::new("ps")
        .args(["-axo", "pid=,uid=,ppid=,etime=,comm="])
        .output()
        .expect("ps must be on PATH for the live oracle");
    assert!(output.status.success(), "ps failed: {}", output.status);
    let finished_at = Instant::now();
    let rows = String::from_utf8(output.stdout)
        .expect("ps output is utf8")
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let pid = fields.next()?.parse::<u32>().ok()?;
            let uid = fields.next()?.parse::<u32>().ok()?;
            let ppid = fields.next()?.parse::<u32>().ok()?;
            let elapsed_seconds = parse_ps_elapsed(fields.next()?)?;
            let command = fields.collect::<Vec<_>>().join(" ");
            let name = PathBuf::from(command).file_name()?.to_str()?.to_owned();
            (pid > 0 && pid < 10_000 && uid != own_uid).then_some(ForeignProcessOracle {
                pid,
                uid,
                ppid,
                elapsed_seconds,
                name,
            })
        })
        .collect();
    ForeignProcessSnapshot {
        started_at,
        finished_at,
        rows,
    }
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

#[cfg(target_os = "linux")]
fn child_cpu_time() -> Duration {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    // SAFETY: getrusage initializes the pointed-to rusage on success.
    let result = unsafe { libc::getrusage(libc::RUSAGE_CHILDREN, usage.as_mut_ptr()) };
    assert_eq!(result, 0, "getrusage(RUSAGE_CHILDREN) failed");
    // SAFETY: the successful call above initialized the value.
    let usage = unsafe { usage.assume_init() };
    let micros = |time: libc::timeval| {
        u64::try_from(time.tv_sec)
            .expect("non-negative child CPU seconds")
            .saturating_mul(1_000_000)
            .saturating_add(u64::try_from(time.tv_usec).expect("non-negative child CPU micros"))
    };
    Duration::from_micros(micros(usage.ru_utime).saturating_add(micros(usage.ru_stime)))
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

#[when("I burn a measured amount of CPU between two process snapshots")]
fn measured_process_cpu_time_snapshots(world: &mut LiveWorld) {
    let pid = std::process::id();
    world.cpu_time_first = Some(read_process_cpu_time(world, pid));
    let oracle_first = self_cpu_time_us();
    let target = oracle_first.saturating_add(500_000);
    let mut oracle_second = oracle_first;
    while oracle_second < target {
        std::hint::spin_loop();
        oracle_second = self_cpu_time_us();
    }
    world.cpu_time_oracle_delta = Some(oracle_second.saturating_sub(oracle_first));
    world.cpu_time_second = Some(read_process_cpu_time(world, pid));
}

fn self_cpu_time_us() -> u64 {
    unsafe {
        let mut usage = std::mem::zeroed::<libc::rusage>();
        assert_eq!(libc::getrusage(libc::RUSAGE_SELF, &mut usage), 0);
        let timeval_us = |value: libc::timeval| {
            (value.tv_sec as u64)
                .saturating_mul(1_000_000)
                .saturating_add(value.tv_usec as u64)
        };
        timeval_us(usage.ru_utime).saturating_add(timeval_us(usage.ru_stime))
    }
}

fn read_process_cpu_time(world: &LiveWorld, pid: u32) -> u64 {
    let body = world.run_osfacts(&["snapshot", "--pids", &pid.to_string(), "--cpu-time"]);
    body.lines()
        .find_map(|line| line.strip_prefix(&format!("C\t{pid}\t")))
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or_else(|| panic!("C row for current process missing: {body}"))
}

#[then("the osfacts CPU-time delta matches getrusage")]
fn process_cpu_time_matches_getrusage(world: &mut LiveWorld) {
    let first = world.cpu_time_first.expect("first cpu time");
    let second = world.cpu_time_second.expect("second cpu time");
    let expected = world
        .cpu_time_oracle_delta
        .expect("getrusage CPU-time delta");
    assert!(
        second >= first,
        "process CPU time decreased: first={first}, second={second}"
    );
    let observed = second - first;
    let tolerance = expected / 5;
    assert!(
        observed.abs_diff(expected) <= tolerance,
        "osfacts CPU-time units diverged from getrusage: observed={observed}us expected={expected}us tolerance={tolerance}us"
    );
}

#[when("I snapshot this process's identity and launch details")]
fn snapshot_process_details(world: &mut LiveWorld) {
    let pid = std::process::id().to_string();
    world.snapshot = Some(world.run_osfacts(&[
        "snapshot", "--pids", &pid, "--uid", "--cwd", "--status", "--argv",
    ]));
}

#[then("uid cwd status and argv match this process")]
fn process_details_are_real(world: &mut LiveWorld) {
    let pid = std::process::id();
    let body = world.snapshot.as_ref().expect("snapshot");
    let fields = |tag: &str| {
        body.lines()
            .find(|line| line.starts_with(&format!("{tag}\t{pid}\t")))
            .unwrap_or_else(|| panic!("{tag} row for current process missing: {body}"))
            .split('\t')
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let uid = fields("UID");
    assert_eq!(uid[2].parse::<u32>().expect("uid"), unsafe {
        libc::getuid()
    });
    let cwd = fields("CWD");
    let cwd: String = serde_json::from_str(&cwd[2]).expect("cwd JSON");
    assert_eq!(
        cwd,
        std::env::current_dir()
            .expect("current directory")
            .to_string_lossy()
    );
    let status = fields("STAT");
    assert_eq!(status[2].chars().count(), 1);
    status[3].parse::<i32>().expect("nice");
    let argv = fields("ARGV");
    let argv: Vec<String> = serde_json::from_str(&argv[2]).expect("argv JSON");
    assert!(
        argv.iter().any(|value| value.contains("live_oracle")),
        "live harness missing from argv: {argv:?}"
    );
}

#[when("I snapshot stable foreign-uid processes visible to ps on darwin")]
fn snapshot_foreign_processes(_world: &mut LiveWorld) {
    #[cfg(target_os = "macos")]
    {
        let world = _world;
        let own_uid = unsafe { libc::geteuid() };
        assert_ne!(own_uid, 0, "fixture requires a non-root user");
        let mut process_snapshot = foreign_processes_from_ps(own_uid);
        process_snapshot.rows.sort_by_key(|row| row.pid);
        process_snapshot.rows.truncate(12);
        assert!(
            process_snapshot.rows.len() >= 5,
            "need at least five stable foreign processes, found {:?}",
            process_snapshot.rows
        );
        assert!(
            process_snapshot.rows.iter().any(|row| row.name.len() > 16),
            "fixture must include a name longer than kern.proc p_comm: {:?}",
            process_snapshot.rows
        );
        let pids = process_snapshot
            .rows
            .iter()
            .map(|row| row.pid.to_string())
            .collect::<Vec<_>>()
            .join(",");
        world.foreign_process_snapshot = Some(process_snapshot);
        world.snapshot = Some(world.run_osfacts(&[
            "snapshot",
            "--pids",
            &pids,
            "--procs",
            "--uid",
            "--start-time",
            "--mem",
            "--cpu-time",
        ]));
    }
}

#[then("osfacts matches their identity and start facts without hiding real blindness")]
fn foreign_process_facts_are_honest(_world: &mut LiveWorld) {
    #[cfg(target_os = "macos")]
    {
        let world = _world;
        let body = world.snapshot.as_ref().expect("snapshot");
        let rows = |tag: &str| {
            body.lines()
                .filter_map(|line| {
                    let fields = line.split('\t').collect::<Vec<_>>();
                    (fields.first().copied() == Some(tag)).then_some(fields)
                })
                .collect::<Vec<_>>()
        };
        let procs = rows("P");
        let uids = rows("UID");
        let starts = rows("S");
        let memory = rows("M");
        let cpu_times = rows("C");
        let unreadable = rows("U");
        let own_uid = unsafe { libc::geteuid() };
        let current_snapshot = foreign_processes_from_ps(own_uid);
        let current = current_snapshot
            .rows
            .iter()
            .cloned()
            .map(|process| (process.pid, process))
            .collect::<HashMap<_, _>>();
        let first_ps = world
            .foreign_process_snapshot
            .as_ref()
            .expect("foreign process snapshot");
        // `ps etime` is whole-second resolution, and each process can be
        // sampled anywhere between the command's start and finish. Compare the
        // observed age increase against that complete interval rather than a
        // fixed skew allowance that becomes false on a slow/noisy host.
        let minimum_age_increase = current_snapshot
            .started_at
            .saturating_duration_since(first_ps.finished_at)
            .as_secs()
            .saturating_sub(1);
        let maximum_age_increase = current_snapshot
            .finished_at
            .saturating_duration_since(first_ps.started_at)
            .as_secs()
            .saturating_add(1);
        let retired = first_ps
            .rows
            .iter()
            .filter_map(|expected| {
                let pid = expected.pid.to_string();
                if procs.iter().any(|row| row.get(1) == Some(&pid.as_str())) {
                    return None;
                }
                let same_process_is_live =
                    current.get(&expected.pid).is_some_and(|process| {
                        let age_increase = process
                            .elapsed_seconds
                            .saturating_sub(expected.elapsed_seconds);
                        process.uid == expected.uid
                            && process.ppid == expected.ppid
                            && process.name == expected.name
                            && (minimum_age_increase..=maximum_age_increase)
                                .contains(&age_increase)
                    });
                assert!(
                    !same_process_is_live,
                    "osfacts omitted still-live foreign process {}:\n{body}",
                    expected.pid
                );
                assert!(
                    unreadable.iter().any(|row| {
                        row.get(1) == Some(&pid.as_str())
                            && row.get(2) == Some(&"proc")
                            && row.get(3) == Some(&"ESRCH")
                    }),
                    "retired foreign process {} lacks explicit proc ESRCH:\n{body}",
                    expected.pid
                );
                Some(expected.pid)
            })
            .collect::<HashSet<_>>();
        assert_eq!(
            procs.len() + retired.len(),
            first_ps.rows.len(),
            "foreign process accounting diverged from ps:\n{body}"
        );
        let now_instant = Instant::now();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_micros() as u64;
        let minimum_elapsed_increase = now_instant
            .saturating_duration_since(first_ps.finished_at)
            .as_secs()
            .saturating_sub(1);
        let maximum_elapsed_increase = now_instant
            .saturating_duration_since(first_ps.started_at)
            .as_secs()
            .saturating_add(1);
        for expected in &first_ps.rows {
            if retired.contains(&expected.pid) {
                continue;
            }
            let pid = expected.pid.to_string();
            let ppid = expected.ppid.to_string();
            let uid = expected.uid.to_string();
            let proc = procs
                .iter()
                .find(|row| row.get(1) == Some(&pid.as_str()))
                .unwrap_or_else(|| panic!("missing P row for {}:\n{body}", expected.pid));
            assert_eq!(proc.get(2), Some(&ppid.as_str()));
            assert_eq!(proc.get(3), Some(&expected.name.as_str()));
            let uid_row = uids
                .iter()
                .find(|row| row.get(1) == Some(&pid.as_str()))
                .unwrap_or_else(|| panic!("missing UID row for {}:\n{body}", expected.pid));
            assert_eq!(uid_row.get(2), Some(&uid.as_str()));
            let start = starts
                .iter()
                .find(|row| row.get(1) == Some(&pid.as_str()))
                .unwrap_or_else(|| panic!("missing S row for {}:\n{body}", expected.pid));
            let start = start[2].parse::<u64>().expect("start time");
            let elapsed = now.saturating_sub(start) / 1_000_000;
            let expected_elapsed =
                expected.elapsed_seconds.saturating_add(minimum_elapsed_increase)
                    ..=expected
                        .elapsed_seconds
                        .saturating_add(maximum_elapsed_increase);
            assert!(
                expected_elapsed.contains(&elapsed),
                "start time for {} differs from ps: osfacts elapsed={elapsed}s, ps expected={expected_elapsed:?}",
                expected.pid,
            );
            for facet in ["proc", "uid", "start_time"] {
                assert!(
                    !unreadable
                        .iter()
                        .any(|row| row.get(1) == Some(&pid.as_str()) && row.get(2) == Some(&facet)),
                    "false {facet} blindness for {}:\n{body}",
                    expected.pid
                );
            }
            for (tag, facet, facts) in [("M", "mem", &memory), ("C", "cpu_time", &cpu_times)] {
                let has_fact = facts.iter().any(|row| row.get(1) == Some(&pid.as_str()));
                let has_unreadable = unreadable
                    .iter()
                    .any(|row| row.get(1) == Some(&pid.as_str()) && row.get(2) == Some(&facet));
                assert!(
                    has_fact ^ has_unreadable,
                    "{tag}/{facet} must be exactly fact or honest U for {}:\n{body}",
                    expected.pid
                );
            }
        }
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
                let numeric = if tag == "HCPU" {
                    &fields[2..6]
                } else {
                    &fields[2..]
                };
                let values = numeric
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
    for line in second.lines().filter(|line| line.starts_with("HCPU\t")) {
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(fields.len(), 8, "bad HCPU row: {line}");
        let model: String = serde_json::from_str(fields[6]).expect("CPU model JSON");
        assert!(!model.is_empty(), "empty CPU model: {line}");
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert_eq!(fields[7], "-", "Apple Silicon MHz must be null: {line}");
    }
    let disk = second
        .lines()
        .find(|line| line.starts_with("HDISK\t"))
        .expect("root disk row");
    let disk: Vec<&str> = disk.split('\t').collect();
    let total = disk[2].parse::<u64>().expect("disk total");
    let available = disk[3].parse::<u64>().expect("disk available");
    let free = disk[4].parse::<u64>().expect("disk free");
    assert!(
        available <= free && free <= total,
        "bad disk gauges: {disk:?}"
    );
}

#[when("I time warm complete process snapshots")]
fn time_complete_process_snapshots(_world: &mut LiveWorld) {
    #[cfg(target_os = "linux")]
    {
        let world = _world;
        let args = [
            "snapshot",
            "--procs",
            "--ports",
            "--mem",
            "--start-time",
            "--cpu-time",
            "--uid",
            "--cwd",
            "--status",
            "--argv",
        ];
        let baseline_args = ["snapshot", "--procs"];
        for _ in 0..3 {
            world.run_osfacts(&baseline_args);
            world.run_osfacts(&args);
        }
        let (processes, descriptors) = linux_proc_census();
        world.linux_perf_process_count = Some(processes);
        world.linux_perf_fd_count = Some(descriptors);
        for _ in 0..11 {
            let started = child_cpu_time();
            world.run_osfacts(&baseline_args);
            world
                .linux_perf_baseline_samples
                .push(child_cpu_time().saturating_sub(started));

            let started = child_cpu_time();
            world.run_osfacts(&args);
            world
                .linux_perf_samples
                .push(child_cpu_time().saturating_sub(started));
        }
    }
}

#[then("the Linux all-facets median stays below the live smoke bound")]
fn complete_process_snapshot_is_fast(_world: &mut LiveWorld) {
    #[cfg(target_os = "linux")]
    {
        let world = _world;
        world.linux_perf_baseline_samples.sort_unstable();
        world.linux_perf_samples.sort_unstable();
        let baseline_median =
            world.linux_perf_baseline_samples[world.linux_perf_baseline_samples.len() / 2];
        let median = world.linux_perf_samples[world.linux_perf_samples.len() / 2];
        let extra = median.saturating_sub(baseline_median);
        let process_count = world.linux_perf_process_count.expect("process count");
        let fd_count = world.linux_perf_fd_count.expect("descriptor count");
        let process_micros =
            LINUX_EXTRA_FACETS_CPU_BUDGET_US_PER_PROCESS.saturating_mul(process_count as u128);
        let fd_micros = LINUX_PORTS_CPU_BUDGET_US_PER_FD.saturating_mul(fd_count as u128);
        let limit_micros = process_micros.saturating_add(fd_micros);
        eprintln!(
            "Linux child CPU medians across {process_count} processes / {fd_count} descriptors: --procs={baseline_median:?}, all facets={median:?}, extra={extra:?} (budget {process_micros}us process + {fd_micros}us fd = {limit_micros}us total)"
        );
        assert!(
            extra.as_micros() < limit_micros,
            "Linux extra-facets child CPU median was {extra:?} (--procs={baseline_median:?}, all facets={median:?}) across {process_count} processes and {fd_count} descriptors; live smoke budget is {LINUX_EXTRA_FACETS_CPU_BUDGET_US_PER_PROCESS}us/process + {LINUX_PORTS_CPU_BUDGET_US_PER_FD}us/descriptor ({limit_micros}us total; baseline samples={:?}; all-facet samples={:?})",
            world.linux_perf_baseline_samples,
            world.linux_perf_samples,
        );
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
