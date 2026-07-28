//! The versioned fact set — one shape for TSV and JSON.

use serde::Serialize;
use std::io::{self, Write};

pub const SCHEMA_VERSION: u32 = 2;

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
    pub facet: String,
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
    pub facet: String,
    pub code: String,
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
            writeln!(out, "U\t{}\t{}\t{}", u.pid, u.facet, u.errno)?;
        }
        for e in &self.errors {
            writeln!(out, "E\t{}\t{}\t{}", e.source, e.facet, e.code)?;
        }
        out.flush()
    }

    pub fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        serde_json::to_writer(&mut *out, self).map_err(io::Error::other)?;
        writeln!(out)
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
        for e in &self.errors {
            writeln!(out, "E\t{}\t{}\t{}", e.source, e.facet, e.code)?;
        }
        out.flush()
    }

    pub fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        serde_json::to_writer(&mut *out, self).map_err(io::Error::other)?;
        writeln!(out)
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
        other => other.to_string(),
    }
}
