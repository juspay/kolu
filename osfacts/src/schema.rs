//! The versioned fact set — one shape for TSV and JSON.

use serde::Serialize;
use std::io::{self, Write};

pub const SCHEMA_VERSION: u32 = 2;

/// The V2 facet vocabulary — the one noun `U` and `E` rows are spelled in.
///
/// This enum is the *only* place a facet name exists on the producer side: a
/// reader names a facet by variant, never by string literal, so a typo is a
/// compile error rather than a parse error at the far end of the pipe. The
/// wire spelling is `as_str`, and the three projections below are what the
/// checked-in `facets.json` contract file carries across to the TypeScript
/// client (pinned from both sides — see `tests/v2_contract.rs` and
/// `client-ts/src/facets.test.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Facet {
    Proc,
    Ports,
    PortsUnclaimed,
    PortsUid,
    Mem,
    StartTime,
    CpuTime,
    Uid,
    Cwd,
    Status,
    StatusThreads,
    Argv,
    Uptime,
    Load,
    Cpu,
    Net,
    Disk,
}

impl Facet {
    /// The wire spelling. An exhaustive match, so a new variant cannot ship
    /// without a deliberate decision about how it is spelled.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proc => "proc",
            Self::Ports => "ports",
            Self::PortsUnclaimed => "ports_unclaimed",
            Self::PortsUid => "ports_uid",
            Self::Mem => "mem",
            Self::StartTime => "start_time",
            Self::CpuTime => "cpu_time",
            Self::Uid => "uid",
            Self::Cwd => "cwd",
            Self::Status => "status",
            Self::StatusThreads => "status_threads",
            Self::Argv => "argv",
            Self::Uptime => "uptime",
            Self::Load => "load",
            Self::Cpu => "cpu",
            Self::Net => "net",
            Self::Disk => "disk",
        }
    }

    /// Facets a `U` row can name — what one unreadable *pid* costs.
    pub const UNREADABLE: &'static [Self] = &[
        Self::Proc,
        Self::Ports,
        Self::Mem,
        Self::StartTime,
        Self::CpuTime,
        Self::Uid,
        Self::Cwd,
        Self::Status,
        Self::StatusThreads,
        Self::Argv,
    ];

    /// Facets an `E` row of the `snapshot` verb can name — what one blind
    /// *source* costs.
    pub const SNAPSHOT_SOURCE: &'static [Self] = &[
        Self::Proc,
        Self::Ports,
        Self::PortsUnclaimed,
        Self::PortsUid,
        Self::Mem,
        Self::StartTime,
        Self::CpuTime,
        Self::Uid,
        Self::Status,
    ];

    /// Facets an `E` row of the `host` verb can name. A separate projection
    /// because the two verbs are separate contracts: `mem` here is host RAM,
    /// `mem` in `SNAPSHOT_SOURCE` is process RSS.
    pub const HOST_SOURCE: &'static [Self] = &[
        Self::Uptime,
        Self::Load,
        Self::Mem,
        Self::Cpu,
        Self::Net,
        Self::Disk,
    ];
}

#[derive(Debug, Clone, Serialize)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Memory {
    pub pid: u32,
    #[serde(rename = "rssBytes")]
    pub rss_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartTime {
    pub pid: u32,
    #[serde(rename = "startUnixUs")]
    pub start_unix_us: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessCpuTime {
    pub pid: u32,
    #[serde(rename = "cpuTimeUs")]
    pub cpu_time_us: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessUid {
    pub pid: u32,
    pub uid: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessCwd {
    pub pid: u32,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessStatus {
    pub pid: u32,
    pub state: char,
    pub nice: i32,
    pub threads: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessArgv {
    pub pid: u32,
    pub argv: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Attribution {
    Claimed { pid: u32 },
    Unclaimed,
}

#[derive(Debug, Clone, Serialize)]
pub struct Port {
    #[serde(flatten)]
    pub attribution: Attribution,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<u32>,
    pub port: u16,
    pub address: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Unreadable {
    pub pid: u32,
    pub facet: Facet,
    pub errno: String,
}

/// A source that could not be read, and the facet its silence costs.
///
/// `facet` is the same vocabulary the `U` rows use, so a consumer scopes
/// source blindness exactly the way it scopes per-pid blindness. It is what
/// separates "the listener table is gone" (`ports`) from "the host-wide table
/// is gone but the fd walk still named every claimed listener"
/// (`ports_unclaimed`) — a distinction a consumer cannot rederive from the
/// source name without duplicating this module's knowledge.
#[derive(Debug, Clone, Serialize)]
pub struct SourceError {
    pub source: String,
    pub facet: Facet,
    pub code: String,
}

/// The code a source uses when it cannot tell *gated* from *genuinely empty*.
///
/// One condition, one code, on both platforms: `lo`/`lo0` always exists and a
/// listener table always has framing, so an empty read means the source went
/// blind. A consumer that branches on `code` must not have to know which OS
/// produced the row.
pub const BLIND_OR_EMPTY: &str = "BLIND_OR_EMPTY";

/// One `E` row: a source that could not be read, and the facet it costs.
pub fn source_error(source: &str, facet: Facet, err: i32) -> SourceError {
    SourceError {
        source: source.into(),
        facet,
        code: errno_name(err),
    }
}

/// One `E` row for the indistinguishable-empty condition — see [`BLIND_OR_EMPTY`].
pub fn blind_or_empty(source: &str, facet: Facet) -> SourceError {
    SourceError {
        source: source.into(),
        facet,
        code: BLIND_OR_EMPTY.into(),
    }
}

#[derive(Debug, Default, Serialize)]
pub struct Snapshot {
    pub version: u32,
    pub procs: Vec<Proc>,
    pub memory: Vec<Memory>,
    #[serde(rename = "startTimes")]
    pub start_times: Vec<StartTime>,
    #[serde(rename = "cpuTimes")]
    pub cpu_times: Vec<ProcessCpuTime>,
    pub uids: Vec<ProcessUid>,
    pub cwds: Vec<ProcessCwd>,
    pub statuses: Vec<ProcessStatus>,
    pub argv: Vec<ProcessArgv>,
    pub ports: Vec<Port>,
    pub unreadable: Vec<Unreadable>,
    pub errors: Vec<SourceError>,
}

impl Snapshot {
    pub fn new() -> Self {
        Self {
            version: SCHEMA_VERSION,
            ..Self::default()
        }
    }

    /// Record that one pid's facet could not be read. At most one row per
    /// (pid, facet): several readers share a file, and a shared failure is one
    /// fact, not N.
    pub fn push_unreadable(&mut self, pid: u32, facet: Facet, err: i32) {
        if !self
            .unreadable
            .iter()
            .any(|row| row.pid == pid && row.facet == facet)
        {
            self.unreadable.push(Unreadable {
                pid,
                facet,
                errno: errno_name(err),
            });
        }
    }

    /// Did this snapshot carry any fact at all? An exhaustive destructure, so
    /// adding a field to `Snapshot` without deciding whether it is a fact is a
    /// compile error rather than a silently wrong exit code.
    pub fn has_facts(&self) -> bool {
        let Self {
            version: _,
            procs,
            memory,
            start_times,
            cpu_times,
            uids,
            cwds,
            statuses,
            argv,
            ports,
            unreadable,
            errors: _,
        } = self;
        !procs.is_empty()
            || !memory.is_empty()
            || !start_times.is_empty()
            || !cpu_times.is_empty()
            || !uids.is_empty()
            || !cwds.is_empty()
            || !statuses.is_empty()
            || !argv.is_empty()
            || !ports.is_empty()
            || !unreadable.is_empty()
    }

    /// Total, platform-independent row order.
    ///
    /// Row order is a property of the schema, not of an OS — two platforms
    /// whose only visible contract is "the same TSV" must sort identically.
    /// Called once, by `main`, after the platform sensor returns.
    pub fn normalize(&mut self) {
        let Self {
            version: _,
            procs,
            memory,
            start_times,
            cpu_times,
            uids,
            cwds,
            statuses,
            argv,
            ports,
            unreadable,
            errors: _,
        } = self;
        procs.sort_by_key(|row| row.pid);
        memory.sort_by_key(|row| row.pid);
        start_times.sort_by_key(|row| row.pid);
        cpu_times.sort_by_key(|row| row.pid);
        uids.sort_by_key(|row| row.pid);
        cwds.sort_by_key(|row| row.pid);
        statuses.sort_by_key(|row| row.pid);
        argv.sort_by_key(|row| row.pid);
        // `(port, pid)` is total: `SO_REUSEPORT` and wildcard/loopback pairs
        // put several rows on one port, and sorting by port alone leaves their
        // order unspecified on whichever platform emits them second.
        ports.sort_by(|a, b| {
            let key = |row: &Port| {
                (
                    row.port,
                    match row.attribution {
                        Attribution::Claimed { pid } => pid,
                        Attribution::Unclaimed => u32::MAX,
                    },
                    row.address.clone(),
                )
            };
            key(a).cmp(&key(b))
        });
        unreadable.sort_by_key(|row| (row.pid, row.facet));
    }

    pub fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()> {
        writeln!(out, "V\t{}", self.version)?;
        for p in &self.procs {
            writeln!(out, "P\t{}\t{}\t{}", p.pid, p.ppid, p.name)?;
        }
        for m in &self.memory {
            writeln!(out, "M\t{}\t{}", m.pid, m.rss_bytes)?;
        }
        for s in &self.start_times {
            writeln!(out, "S\t{}\t{}", s.pid, s.start_unix_us)?;
        }
        for c in &self.cpu_times {
            writeln!(out, "C\t{}\t{}", c.pid, c.cpu_time_us)?;
        }
        for u in &self.uids {
            writeln!(out, "UID\t{}\t{}", u.pid, u.uid)?;
        }
        for c in &self.cwds {
            writeln!(out, "CWD\t{}\t{}", c.pid, encode_tsv_string(&c.cwd))?;
        }
        for s in &self.statuses {
            let threads = s
                .threads
                .map_or_else(|| "-".into(), |value| value.to_string());
            writeln!(out, "STAT\t{}\t{}\t{}\t{threads}", s.pid, s.state, s.nice)?;
        }
        for a in &self.argv {
            writeln!(out, "ARGV\t{}\t{}", a.pid, encode_tsv_strings(&a.argv))?;
        }
        for l in &self.ports {
            let (status, pid) = match l.attribution {
                Attribution::Claimed { pid } => ("claimed", pid.to_string()),
                Attribution::Unclaimed => ("unclaimed", "-".into()),
            };
            let uid = l.uid.map_or_else(|| "-".into(), |uid| uid.to_string());
            writeln!(out, "L\t{status}\t{pid}\t{uid}\t{}\t{}", l.port, l.address)?;
        }
        for u in &self.unreadable {
            writeln!(out, "U\t{}\t{}\t{}", u.pid, u.facet.as_str(), u.errno)?;
        }
        write_source_errors(out, &self.errors)?;
        out.flush()
    }

    pub fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        write_json(self, out)
    }
}

/// The `E` row block. One writer, shared by both documents — the two copies it
/// replaces had to be edited in lockstep for every field the row gained.
fn write_source_errors(out: &mut dyn Write, errors: &[SourceError]) -> io::Result<()> {
    for e in errors {
        writeln!(out, "E\t{}\t{}\t{}", e.source, e.facet.as_str(), e.code)?;
    }
    Ok(())
}

fn write_json<T: Serialize>(value: &T, out: &mut dyn Write) -> io::Result<()> {
    serde_json::to_writer(&mut *out, value).map_err(io::Error::other)?;
    writeln!(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct Load {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostMemory {
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "availableBytes")]
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Swap {
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "usedBytes")]
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Cpu {
    pub core: u32,
    #[serde(rename = "userUs")]
    pub user_us: u64,
    #[serde(rename = "systemUs")]
    pub system_us: u64,
    #[serde(rename = "idleUs")]
    pub idle_us: u64,
    #[serde(rename = "otherUs")]
    pub other_us: u64,
    pub model: String,
    #[serde(rename = "frequencyMhz")]
    pub frequency_mhz: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Network {
    pub name: String,
    #[serde(rename = "rxBytes")]
    pub rx_bytes: u64,
    #[serde(rename = "txBytes")]
    pub tx_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Disk {
    pub mount: String,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "availableBytes")]
    pub available_bytes: u64,
    #[serde(rename = "freeBytes")]
    pub free_bytes: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct HostSnapshot {
    pub version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub load: Option<Load>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<HostMemory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub swap: Option<Swap>,
    #[serde(rename = "uptimeUs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_us: Option<u64>,
    pub cpus: Vec<Cpu>,
    pub networks: Vec<Network>,
    pub disks: Vec<Disk>,
    pub errors: Vec<SourceError>,
}

impl HostSnapshot {
    pub fn new() -> Self {
        Self {
            version: SCHEMA_VERSION,
            ..Self::default()
        }
    }

    /// Did this host reading carry any fact at all? Exhaustive destructure for
    /// the same reason as [`Snapshot::has_facts`].
    pub fn has_facts(&self) -> bool {
        let Self {
            version: _,
            load,
            memory,
            swap,
            uptime_us,
            cpus,
            networks,
            disks,
            errors: _,
        } = self;
        load.is_some()
            || memory.is_some()
            || swap.is_some()
            || uptime_us.is_some()
            || !cpus.is_empty()
            || !networks.is_empty()
            || !disks.is_empty()
    }

    pub fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()> {
        writeln!(out, "V\t{}", self.version)?;
        if let Some(v) = &self.load {
            writeln!(out, "HLOAD\t{}\t{}\t{}", v.one, v.five, v.fifteen)?;
        }
        if let Some(v) = &self.memory {
            writeln!(out, "HMEM\t{}\t{}", v.total_bytes, v.available_bytes)?;
        }
        if let Some(v) = &self.swap {
            writeln!(out, "HSWAP\t{}\t{}", v.total_bytes, v.used_bytes)?;
        }
        if let Some(v) = self.uptime_us {
            writeln!(out, "HUP\t{v}")?;
        }
        for v in &self.cpus {
            writeln!(
                out,
                "HCPU\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                v.core,
                v.user_us,
                v.system_us,
                v.idle_us,
                v.other_us,
                encode_tsv_string(&v.model),
                v.frequency_mhz
                    .map_or_else(|| "-".into(), |value| value.to_string())
            )?;
        }
        for v in &self.networks {
            writeln!(out, "HNET\t{}\t{}\t{}", v.name, v.rx_bytes, v.tx_bytes)?;
        }
        for v in &self.disks {
            writeln!(
                out,
                "HDISK\t{}\t{}\t{}\t{}",
                v.mount, v.total_bytes, v.available_bytes, v.free_bytes
            )?;
        }
        write_source_errors(out, &self.errors)?;
        out.flush()
    }

    pub fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        write_json(self, out)
    }
}

pub fn hex_bytes(bytes: &[u8]) -> String {
    crate::proc_addr::encode_hex(bytes)
}

pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if matches!(c, '\t' | '\n' | '\r') {
                ' '
            } else {
                c
            }
        })
        .collect()
}

pub fn encode_tsv_string(value: &str) -> String {
    serde_json::to_string(value).expect("a string always serializes as JSON")
}

pub fn encode_tsv_strings(values: &[String]) -> String {
    serde_json::to_string(values).expect("strings always serialize as JSON")
}

pub fn errno_name(err: i32) -> String {
    match err {
        libc::EACCES => "EACCES".into(),
        libc::EPERM => "EPERM".into(),
        libc::ENOENT => "ENOENT".into(),
        libc::ESRCH => "ESRCH".into(),
        libc::EIO => "EIO".into(),
        libc::EINVAL => "EINVAL".into(),
        libc::ENOTSUP => "ENOTSUP".into(),
        other => other.to_string(),
    }
}
