//! The versioned fact set — one shape for TSV and JSON.
//!
//! Platform modules fill a `Snapshot`; this module is the only place that
//! knows how it serializes. Schema rev is independent of how linux or
//! darwin gather rows.

use serde::Serialize;
use std::io::{self, Write};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Port {
    pub pid: u32,
    pub port: u16,
    /// Raw bind address bytes as lowercase hex (4 bytes → 8 hex, 16 → 32).
    pub address: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Unreadable {
    pub pid: u32,
    /// Symbolic errno name when known (`EACCES`), else the number as decimal.
    pub errno: String,
}

#[derive(Debug, Default, Serialize)]
pub struct Snapshot {
    pub version: u32,
    pub procs: Vec<Proc>,
    pub ports: Vec<Port>,
    pub unreadable: Vec<Unreadable>,
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
            // Name last: may contain spaces; tabs/newlines stripped at fill time.
            writeln!(out, "P\t{}\t{}\t{}", p.pid, p.ppid, p.name)?;
        }
        for l in &self.ports {
            writeln!(out, "L\t{}\t{}\t{}", l.pid, l.port, l.address)?;
        }
        for u in &self.unreadable {
            writeln!(out, "U\t{}\t{}", u.pid, u.errno)?;
        }
        out.flush()
    }

    pub fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
        serde_json::to_writer(&mut *out, self).map_err(io::Error::other)?;
        // Trailing newline keeps `jq` and pipes tidy; not part of the schema.
        writeln!(out)
    }
}

/// Hex-encode raw address bytes (network order).
pub fn hex_bytes(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(s, "{b:02x}");
    }
    s
}

/// Sanitize a process name so it can be the last TSV field.
pub fn sanitize_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c == '\t' || c == '\n' || c == '\r' {
                ' '
            } else {
                c
            }
        })
        .collect()
}

/// Map a raw errno to the short name consumers see in `U` rows.
pub fn errno_name(err: i32) -> String {
    // The set we actually emit. Unknown numbers pass through as decimal so a
    // new kernel errno is never silently renamed to "unknown".
    match err {
        libc::EACCES => "EACCES".into(),
        libc::EPERM => "EPERM".into(),
        libc::ENOENT => "ENOENT".into(),
        libc::ESRCH => "ESRCH".into(),
        libc::EIO => "EIO".into(),
        other => other.to_string(),
    }
}
