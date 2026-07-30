//! Shared hermetic-test helpers.
//!
//! Both platforms use the same strategy: bind port 0 in a parked
//! `osfacts-listener` child, snapshot that child's subtree (or exact pid),
//! assert *our* fixture appears exactly when the kernel exposes its listener
//! table. A Darwin sandbox may instead report that source as explicitly blind;
//! the process fact must still survive. Pid and port are redacted for insta;
//! nothing claims the host port table is empty. There is no
//! `unshare` / netns path — hermeticity is scoped assertions, not an
//! isolated network namespace.

use assert_cmd::Command;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command as StdCommand, Stdio};
use tempfile::{tempdir, TempDir};

/// Result of a hermetic bind+snapshot.
pub struct Hermetic {
    pub listener_pid: u32,
    pub port: u16,
    pub tsv: String,
}

/// Bind `bind` in a parked helper child and snapshot its process subtree.
pub fn hermetic_snapshot(bind: &str) -> Hermetic {
    let listener = Listener::spawn(bind);
    let tsv = snapshot_roots(listener.pid);
    Hermetic {
        listener_pid: listener.pid,
        port: listener.port,
        tsv,
    }
}

/// Like [`hermetic_snapshot`] but `--pids` instead of `--roots`.
#[allow(dead_code)] // kept for parity with --pids call sites / future fixtures
pub fn hermetic_snapshot_pids(bind: &str) -> Hermetic {
    let listener = Listener::spawn(bind);
    let tsv = snapshot_pids(listener.pid);
    Hermetic {
        listener_pid: listener.pid,
        port: listener.port,
        tsv,
    }
}

/// A spawned listener helper: bind port 0, print the kernel-chosen port, park.
pub struct Listener {
    child: Child,
    pub pid: u32,
    pub port: u16,
}

impl Listener {
    pub fn spawn(bind: &str) -> Self {
        Self::spawn_with_args(bind, &[])
    }

    pub fn spawn_busy() -> Self {
        Self::spawn_with_args("127.0.0.1", &["--spin"])
    }

    fn spawn_with_args(bind: &str, extra: &[&str]) -> Self {
        let bin = env!("CARGO_BIN_EXE_osfacts-listener");
        let mut child = StdCommand::new(bin)
            .arg(bind)
            .args(extra)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("spawn osfacts-listener: {e}"));
        let pid = child.id();
        let stdout = child.stdout.take().expect("listener stdout");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .expect("read listener port");
        let port: u16 = line
            .trim()
            .parse()
            .unwrap_or_else(|_| panic!("listener did not print a port; got {line:?}"));
        Self { child, pid, port }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A spawned helper holding a bound UNIX socket at a path this test owns.
///
/// The path lives in a `TempDir` the fixture keeps alive, so nothing outside
/// this test can hold it and no assertion depends on host inventory.
pub struct UnixHolder {
    child: Child,
    pub pid: u32,
    _dir: TempDir,
    pub path: PathBuf,
}

impl UnixHolder {
    /// Bind `name` inside a fresh temp dir and wait for the child to say so.
    pub fn spawn(name: &str) -> Self {
        let dir = tempdir().expect("temp dir");
        let path = dir.path().join(name);
        let bin = env!("CARGO_BIN_EXE_osfacts-listener");
        let mut child = StdCommand::new(bin)
            .arg("--unix")
            .arg(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| panic!("spawn osfacts-listener --unix: {e}"));
        let pid = child.id();
        let stdout = child.stdout.take().expect("listener stdout");
        let mut line = String::new();
        BufReader::new(stdout)
            .read_line(&mut line)
            .expect("read bind confirmation");
        assert_eq!(
            line.trim(),
            "bound",
            "listener did not confirm the unix bind"
        );
        Self {
            child,
            pid,
            _dir: dir,
            path,
        }
    }

    /// Kill the holder and wait for it to be reaped, so the socket is
    /// genuinely unbound before the caller asks about the path again. The
    /// FILE survives — that is the point of the stale-socket fixture.
    pub fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for UnixHolder {
    fn drop(&mut self) {
        self.kill();
    }
}

/// `osfacts socket-holders <path> [--procs]` — stdout and exit status, both.
/// The status is part of the contract (a document with no facts and a blind
/// source exits 1), so no helper may `assert().success()` it away.
pub fn socket_holders(path: &Path, procs: bool) -> (String, bool) {
    let mut cmd = osfacts();
    cmd.arg("socket-holders").arg(path);
    if procs {
        cmd.arg("--procs");
    }
    let out = cmd.output().expect("run osfacts socket-holders");
    (
        String::from_utf8(out.stdout).expect("utf8"),
        out.status.success(),
    )
}

/// The rows of a `socket-holders` document, by tag.
pub struct HolderRows {
    pub holders: Vec<String>,
    pub procs: Vec<String>,
    pub unreadable: Vec<String>,
    pub errors: Vec<String>,
}

pub fn parse_holders_tsv(stdout: &str) -> HolderRows {
    let mut lines = stdout.lines();
    let first = lines.next().expect("stdout must have a version line");
    assert_eq!(first, "V\t2", "socket-holders must carry the schema version");
    let mut out = HolderRows {
        holders: Vec::new(),
        procs: Vec::new(),
        unreadable: Vec::new(),
        errors: Vec::new(),
    };
    for line in lines {
        if line.is_empty() {
            continue;
        }
        match line.split('\t').next() {
            Some("H") => out.holders.push(line.to_string()),
            Some("P") => out.procs.push(line.to_string()),
            Some("U") => out.unreadable.push(line.to_string()),
            Some("E") => out.errors.push(line.to_string()),
            other => panic!("unexpected row tag {other:?} in {line}"),
        }
    }
    out
}

/// Darwin has no world-readable table of bound unix sockets, so a walk that
/// claimed nobody may simply have been denied another user's descriptors. A
/// linux run never carries this row; a darwin run carries it exactly when it
/// named no holder.
pub fn darwin_holder_walk_is_blind(errors: &[String]) -> bool {
    errors
        .iter()
        .any(|row| row == "E\tdarwin_proc_fds\tsocket_holders\tBLIND_OR_EMPTY")
}

pub fn osfacts() -> Command {
    Command::cargo_bin("osfacts").expect("osfacts binary")
}

pub fn snapshot_roots(pid: u32) -> String {
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
    String::from_utf8(out).expect("utf8")
}

pub fn snapshot_pids(pid: u32) -> String {
    let out = osfacts()
        .args(["snapshot", "--pids", &pid.to_string(), "--procs", "--ports"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    String::from_utf8(out).expect("utf8")
}

/// Redact volatile process ids, user ids, and kernel-chosen ports.
pub fn redact_tsv(tsv: &str) -> String {
    let mut out = String::with_capacity(tsv.len());
    for line in tsv.lines() {
        // OSF6 intentionally emits the whole host listener table as unclaimed
        // even under a narrow scope. Snapshot only this test's self-referential
        // claimed fixture; host noise belongs in structural assertions.
        if line.starts_with("L\tunclaimed\t") {
            continue;
        }
        let redacted = if let Some(rest) = line.strip_prefix("P\t") {
            let mut parts = rest.splitn(3, '\t');
            let _pid = parts.next().unwrap_or("");
            let _ppid = parts.next().unwrap_or("");
            let name = parts.next().unwrap_or("");
            format!("P\t<PID>\t<PPID>\t{name}")
        } else if let Some(rest) = line.strip_prefix("L\t") {
            let mut parts = rest.splitn(5, '\t');
            let status = parts.next().unwrap_or("");
            let _pid = parts.next().unwrap_or("");
            let _uid = parts.next().unwrap_or("");
            let _port = parts.next().unwrap_or("");
            let hex = parts.next().unwrap_or("");
            format!("L\t{status}\t<PID>\t<UID>\t<PORT>\t{hex}")
        } else if let Some(rest) = line.strip_prefix("U\t") {
            let mut parts = rest.splitn(3, '\t');
            let _pid = parts.next().unwrap_or("");
            let facet = parts.next().unwrap_or("");
            let errno = parts.next().unwrap_or("");
            format!("U\t<PID>\t{facet}\t{errno}")
        } else {
            line.to_string()
        };
        out.push_str(&redacted);
        out.push('\n');
    }
    out
}

pub fn parse_tsv(stdout: &str) -> (u32, Vec<String>, Vec<String>, Vec<String>, Vec<String>) {
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
    let mut errors = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        match line.as_bytes().first() {
            Some(b'P') => procs.push(line.to_string()),
            Some(b'L') => ports.push(line.to_string()),
            Some(b'U') => unreadable.push(line.to_string()),
            Some(b'E') => errors.push(line.to_string()),
            other => panic!("unexpected row tag {other:?} in {line}"),
        }
    }
    (version, procs, ports, unreadable, errors)
}

/// The macOS 27 gate: the host-wide `pcblist_n` table told us nothing.
pub fn darwin_pcblist_is_blind(errors: &[String]) -> bool {
    errors
        .iter()
        .any(|row| row == "E\tdarwin_tcp_pcblist\tports_unclaimed\tBLIND_OR_EMPTY")
}

/// Every `E` row a `--ports` snapshot may legitimately carry without any
/// claimed listener being lost.
///
/// Two on darwin: `ports_uid` is unconditional (neither darwin listener source
/// exposes a socket's owning uid, so the `L` uid column is always `-` there),
/// and `ports_unclaimed BLIND_OR_EMPTY` is the macOS 27 gate. Linux carries
/// neither. A test asserting "nothing blinded this scan" must ignore both and
/// nothing else.
pub fn only_benign_port_source_errors(errors: &[String]) -> bool {
    errors.iter().all(|row| {
        row == "E\tdarwin_listeners\tports_uid\tENOTSUP"
            || row == "E\tdarwin_tcp_pcblist\tports_unclaimed\tBLIND_OR_EMPTY"
    })
}

pub fn l_addr_for_port(ports: &[String], port: u16) -> String {
    for row in ports {
        let parts: Vec<&str> = row.split('\t').collect();
        assert_eq!(parts.len(), 6, "L row arity: {row}");
        assert_eq!(parts[0], "L");
        if parts[4] == port.to_string() {
            return parts[5].to_string();
        }
    }
    panic!("no L row for port {port}; rows={ports:?}");
}

/// Count L rows that match our fixture port (self-referential "appears exactly").
pub fn l_rows_for_port(ports: &[String], port: u16) -> usize {
    ports
        .iter()
        .filter(|row| {
            let parts: Vec<&str> = row.split('\t').collect();
            parts.len() == 6 && parts[0] == "L" && parts[4] == port.to_string()
        })
        .count()
}

pub fn hex_of_v4(a: std::net::Ipv4Addr) -> String {
    osfacts::encode_hex(&a.octets())
}

pub fn hex_of_v6(a: std::net::Ipv6Addr) -> String {
    osfacts::encode_hex(&a.octets())
}
