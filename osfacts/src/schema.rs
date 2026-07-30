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
    SocketHolders,
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
            Self::SocketHolders => "socket_holders",
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
        Self::Cwd,
        Self::Status,
        Self::Argv,
    ];

    /// Facets an `E` row of the `socket-holders` verb can name.
    ///
    /// Exactly one: `socket_holders`, the holder set itself — the source that
    /// answers *who holds this path*. The `--procs` facet has no source-level
    /// failure on this verb: it names an already-known pid set, so a name it
    /// cannot read costs that ONE holder and is reported as that pid's `U`
    /// row (`Facet::Proc`), never as a blind source. A projection wider than
    /// the code can emit would tell a consumer to expect an `E … proc …` row
    /// nothing writes.
    pub const SOCKET_HOLDERS_SOURCE: &'static [Self] = &[Self::SocketHolders];

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

/// One document the binary can emit.
///
/// The three verbs answer different questions, but they all obey ONE
/// emit-and-exit law, so it is written once (in `main`): a document that
/// carried a fact is a success even when a source went blind, and only a
/// document with nothing but blindness in it exits non-zero.
///
/// It is declared HERE, beside the documents, and each type implements it as
/// its ONLY definition of these four methods. A trait in `main` whose impls
/// forwarded to same-named inherent methods meant every document defined
/// `write_tsv` / `write_json` / `has_facts` twice, and a fourth document would
/// have had to remember the forwarding as well as the method.
pub trait Document {
    fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()>;
    fn write_json(&self, out: &mut dyn Write) -> io::Result<()>;
    /// Did this reading carry any fact? An exhaustive destructure in every
    /// impl, so a new field is a compile error until it is classified.
    fn has_facts(&self) -> bool;
    /// The sources that went blind — what the exit code is decided against.
    fn errors(&self) -> &[SourceError];
    /// Total, platform-independent row order. Called once by `main`, after the
    /// platform sensor returns and before anything is written.
    ///
    /// Row order is a property of the DOCUMENT, so it belongs on this trait
    /// rather than as an inherent method two of the three types happened to
    /// have — that shape made `main` carry a bespoke wrapper per verb, one of
    /// which existed only to explain that it did nothing. The default is the
    /// do-nothing one, for a document with no per-pid row vectors to order.
    fn normalize(&mut self) {}
}

impl Snapshot {
    pub fn new() -> Self {
        Self {
            version: SCHEMA_VERSION,
            ..Self::default()
        }
    }

    /// Record that one pid's facet could not be read.
    ///
    /// Duplicates are collapsed by `normalize`, not here: scanning the whole
    /// accumulated vector on every push made this quadratic in the row count,
    /// and a host-wide all-facets snapshot on a busy box produces thousands of
    /// rows. `normalize` already sorts on exactly the `(pid, facet)` key the
    /// dedup needs, so doing it there costs nothing.
    pub fn push_unreadable(&mut self, pid: u32, facet: Facet, err: i32) {
        push_unreadable_row(&mut self.unreadable, pid, facet, err);
    }

    /// Total, platform-independent row order.
    ///
    /// Row order is a property of the schema, not of an OS — two platforms
    /// whose only visible contract is "the same TSV" must sort identically.
    /// Called once, by `main`, through [`Document::normalize`].
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
            let claim = |row: &Port| match row.attribution {
                Attribution::Claimed { pid } => pid,
                Attribution::Unclaimed => u32::MAX,
            };
            (a.port, claim(a))
                .cmp(&(b.port, claim(b)))
                .then_with(|| a.address.cmp(&b.address))
        });
        normalize_unreadable(unreadable);
    }
}

impl Document for Snapshot {
    /// Did this snapshot carry any fact at all? An exhaustive destructure, so
    /// adding a field to `Snapshot` without deciding whether it is a fact is a
    /// compile error rather than a silently wrong exit code.
    fn has_facts(&self) -> bool {
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

    fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()> {
        writeln!(out, "V\t{}", self.version)?;
        write_procs(out, &self.procs)?;
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
            let (status, pid) = attribution_columns(&l.attribution);
            let uid = l.uid.map_or_else(|| "-".into(), |uid| uid.to_string());
            writeln!(out, "L\t{status}\t{pid}\t{uid}\t{}\t{}", l.port, l.address)?;
        }
        write_unreadable(out, &self.unreadable)?;
        write_source_errors(out, &self.errors)?;
        out.flush()
    }

    fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        write_json(self, out)
    }

    fn errors(&self) -> &[SourceError] {
        &self.errors
    }

    fn normalize(&mut self) {
        Snapshot::normalize(self);
    }
}

/// The TSV columns an [`Attribution`] occupies: the status word, and the pid
/// (or `-` when nobody claimed it).
///
/// One writer because the `L` row and the `H` row spell the SAME rule — how a
/// claim is rendered — and two copies of it could disagree about the sentinel
/// or the status word while every test still passed on each row in isolation.
/// The TypeScript client folded this same rule into one `attribution()` reader
/// for the same reason; this is that deduplication on the producer side.
fn attribution_columns(a: &Attribution) -> (&'static str, String) {
    match a {
        Attribution::Claimed { pid } => ("claimed", pid.to_string()),
        Attribution::Unclaimed => ("unclaimed", "-".into()),
    }
}

/// Record that one pid's facet could not be read. One pusher, shared by every
/// document that carries `U` rows.
///
/// Duplicates are collapsed by [`normalize_unreadable`], not here: scanning the
/// whole accumulated vector on every push made this quadratic in the row count,
/// and a host-wide all-facets snapshot on a busy box produces thousands of
/// rows. The normalize already sorts on exactly the `(pid, facet)` key the
/// dedup needs, so doing it there costs nothing.
fn push_unreadable_row(rows: &mut Vec<Unreadable>, pid: u32, facet: Facet, err: i32) {
    rows.push(Unreadable {
        pid,
        facet,
        errno: errno_name(err),
    });
}

/// Order and collapse a document's `U` rows — one row per (pid, facet).
///
/// Several readers share a proc file, so a shared failure is one fact, not N —
/// and a duplicate pid in `--pids` would otherwise report the same blindness
/// twice. The sort is stable and keys on exactly the pair the dedup uses, so
/// the first row of each run survives, which is the row the reader saw first.
fn normalize_unreadable(rows: &mut Vec<Unreadable>) {
    rows.sort_by_key(|row| (row.pid, row.facet));
    rows.dedup_by_key(|row| (row.pid, row.facet));
}

/// The `P` row block. One writer for every document that names a process, for
/// the same reason as [`write_source_errors`].
fn write_procs(out: &mut dyn Write, procs: &[Proc]) -> io::Result<()> {
    for p in procs {
        writeln!(out, "P\t{}\t{}\t{}", p.pid, p.ppid, p.name)?;
    }
    Ok(())
}

/// The `U` row block — one writer, shared for the same reason.
fn write_unreadable(out: &mut dyn Write, unreadable: &[Unreadable]) -> io::Result<()> {
    for u in unreadable {
        writeln!(out, "U\t{}\t{}\t{}", u.pid, u.facet.as_str(), u.errno)?;
    }
    Ok(())
}

/// The `E` row block. One writer, shared by every document — the copies it
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

/// What the `socket-holders` verb returns: who holds one unix socket PATH.
///
/// A third document rather than a shape inside `Snapshot`, because the ask is
/// a *path* and the answer is a *set of holders* — including the affirmative
/// answer "nobody holds it", which an empty facet document could never state.
///
/// `holders` reuses [`Attribution`] for the reason the listener rows do: a
/// bound socket no readable pid claims is a real, reportable state
/// (`unclaimed`), distinct both from "nobody holds it" (no row at all) and
/// from "the source went blind" (an `E` row). Collapsing those three into an
/// empty list is exactly the defect this verb exists to delete.
#[derive(Debug, Default, Serialize)]
pub struct SocketHolders {
    pub version: u32,
    pub holders: Vec<Attribution>,
    /// Holder identity, only when `--procs` was asked.
    pub procs: Vec<Proc>,
    pub unreadable: Vec<Unreadable>,
    pub errors: Vec<SourceError>,
}

impl SocketHolders {
    pub fn new() -> Self {
        Self {
            version: SCHEMA_VERSION,
            ..Self::default()
        }
    }

    /// The answer a build with no sensor for this host must give.
    ///
    /// NOT an empty document, and that is the whole reason this constructor
    /// exists: an empty holder document is the affirmative *nobody holds this
    /// path*, so a sensorless build would tell a supervisor that a live
    /// rendezvous socket is free to bind. It reports the one true thing —
    /// this build cannot look — through the same `socket_holders` source row a
    /// blind darwin walk emits, so a consumer needs no platform rule to fold
    /// it. Lives here, compiled on every platform, so the shape is pinned by a
    /// test rather than only by the `cfg` arm that uses it.
    pub fn unsupported_platform(source: &str) -> Self {
        let mut out = Self::new();
        out.errors
            .push(source_error(source, Facet::SocketHolders, libc::ENOTSUP));
        out
    }

    /// Record that one holder's facet could not be read. Duplicates collapse
    /// in `normalize`, for the same reason as [`Snapshot::push_unreadable`].
    pub fn push_unreadable(&mut self, pid: u32, facet: Facet, err: i32) {
        push_unreadable_row(&mut self.unreadable, pid, facet, err);
    }

    /// Total, platform-independent row order — same law as [`Snapshot::normalize`].
    pub fn normalize(&mut self) {
        let Self {
            version: _,
            holders,
            procs,
            unreadable,
            errors: _,
        } = self;
        // Claimed rows by pid, `unclaimed` last: a pid is a total order, and
        // the unattributed row is one-per-blind-socket with nothing to sort by.
        //
        // The sort and the dedup MUST read the same key — one spelling, used
        // twice — because a dedup keyed differently from the sort would leave
        // duplicate holders standing while every row still looked ordered.
        //
        // One row per holder: a pid holding the bound socket on several fds
        // (an inherited descriptor, a `dup`) is ONE holder, not N.
        fn holder_key(row: &Attribution) -> (u8, u32) {
            match row {
                Attribution::Claimed { pid } => (0, *pid),
                Attribution::Unclaimed => (1, 0),
            }
        }
        holders.sort_by_key(|row| holder_key(row));
        holders.dedup_by_key(|row| holder_key(row));
        procs.sort_by_key(|row| row.pid);
        normalize_unreadable(unreadable);
    }
}

impl Document for SocketHolders {
    /// Did this reading carry any fact? Exhaustive destructure for the same
    /// reason as [`Document::has_facts`].
    ///
    /// Note what is NOT a fact: an empty `holders` with no `errors` is the
    /// affirmative answer *nobody holds this path*, and it exits successfully
    /// through the `errors.is_empty()` arm rather than this one.
    fn has_facts(&self) -> bool {
        let Self {
            version: _,
            holders,
            procs,
            unreadable,
            errors: _,
        } = self;
        !holders.is_empty() || !procs.is_empty() || !unreadable.is_empty()
    }

    fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()> {
        writeln!(out, "V\t{}", self.version)?;
        for h in &self.holders {
            let (status, pid) = attribution_columns(h);
            writeln!(out, "H\t{status}\t{pid}")?;
        }
        write_procs(out, &self.procs)?;
        write_unreadable(out, &self.unreadable)?;
        write_source_errors(out, &self.errors)?;
        out.flush()
    }

    fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        write_json(self, out)
    }

    fn errors(&self) -> &[SourceError] {
        &self.errors
    }

    fn normalize(&mut self) {
        SocketHolders::normalize(self);
    }
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
}

/// This document INHERITS `Document::normalize`'s do-nothing default, and that
/// is a decision rather than an omission: a `HostSnapshot` carries no per-pid
/// row vectors to order — its facts are scalars plus cpu/net/disk lists the
/// sensors already emit in the host's own enumeration order, which is the order
/// to report them in.
impl Document for HostSnapshot {
    /// Did this host reading carry any fact at all? Exhaustive destructure for
    /// the same reason as [`Document::has_facts`].
    fn has_facts(&self) -> bool {
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

    fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()> {
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

    fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        write_json(self, out)
    }

    fn errors(&self) -> &[SourceError] {
        &self.errors
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
