//! osfacts — one versioned snapshot of processes and sockets.
//!
//! Contract: docs/atlas (os-facts-tool). Front door: README.md.
//!
//! Layout (space + time):
//! - `osfacts::cli`    — flag surface only
//! - `osfacts::schema` — the versioned fact set + TSV/JSON (one serializer)
//! - `linux` / `darwin` — OS volatility, each fills a `Snapshot`
//! - `osfacts::decode` — pure darwin address-slot decision

mod cli;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
mod darwin;

use cli::{Command, HostArgs, SnapshotArgs};
use osfacts::{HostSnapshot, Snapshot};
use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    // Version line is mandatory even on error paths: a consumer built against
    // another revision fails loudly instead of parsing a half-shape into zero.
    match cli::parse(std::env::args_os().skip(1)) {
        Ok(Command::Snapshot(args)) => run_snapshot(args),
        Ok(Command::Host(args)) => run_host(args),
        Err(cli::CliError::Help(msg)) => {
            let _ = write_version_only();
            let _ = writeln!(io::stderr(), "{msg}");
            ExitCode::SUCCESS
        }
        Err(cli::CliError::Usage(msg)) => {
            let _ = write_version_only();
            let _ = writeln!(io::stderr(), "osfacts: {msg}");
            ExitCode::from(2)
        }
    }
}

fn run_snapshot(args: SnapshotArgs) -> ExitCode {
    let snap = take_snapshot(&args);
    let mut out = io::stdout().lock();
    let written = if args.json {
        snap.write_json(&mut out)
    } else {
        snap.write_tsv(&mut out)
    };
    if let Err(e) = written {
        let _ = writeln!(io::stderr(), "osfacts: write failed: {e}");
        return ExitCode::from(1);
    }
    snapshot_exit_code(&snap)
}

fn snapshot_exit_code(snap: &Snapshot) -> ExitCode {
    let has_facts = !snap.procs.is_empty()
        || !snap.memory.is_empty()
        || !snap.start_times.is_empty()
        || !snap.ports.is_empty()
        || !snap.unreadable.is_empty();
    if snap.errors.is_empty() || has_facts {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn take_snapshot(args: &SnapshotArgs) -> Snapshot {
    #[cfg(target_os = "linux")]
    {
        return linux::snapshot(args);
    }
    #[cfg(target_os = "macos")]
    {
        return darwin::snapshot(args);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = args;
        Snapshot::new()
    }
}

fn run_host(args: HostArgs) -> ExitCode {
    let host = take_host(&args);
    let mut out = io::stdout().lock();
    let written = if args.json {
        host.write_json(&mut out)
    } else {
        host.write_tsv(&mut out)
    };
    if let Err(e) = written {
        let _ = writeln!(io::stderr(), "osfacts: write failed: {e}");
        return ExitCode::from(1);
    }
    host_exit_code(&host)
}

fn host_exit_code(host: &HostSnapshot) -> ExitCode {
    let has_facts = host.load.is_some()
        || host.memory.is_some()
        || host.swap.is_some()
        || host.uptime_us != 0
        || !host.cpus.is_empty()
        || !host.networks.is_empty()
        || !host.disks.is_empty();
    if host.errors.is_empty() || has_facts {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn take_host(args: &HostArgs) -> HostSnapshot {
    #[cfg(target_os = "linux")]
    {
        return linux::host(args);
    }
    #[cfg(target_os = "macos")]
    {
        return darwin::host(args);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = args;
        HostSnapshot::new()
    }
}

fn write_version_only() -> io::Result<()> {
    Snapshot::new().write_tsv(&mut io::stdout().lock())
}

#[cfg(test)]
mod tests {
    use super::*;
    use osfacts::{Proc, SourceError};

    #[test]
    fn partial_source_failure_does_not_discard_good_facts() {
        let mut snap = Snapshot::new();
        snap.procs.push(Proc {
            pid: 42,
            ppid: 1,
            name: "readable".into(),
        });
        snap.errors.push(SourceError {
            source: "darwin_tcp_pcblist".into(),
            code: "BLIND_OR_EMPTY".into(),
        });

        assert_eq!(snapshot_exit_code(&snap), ExitCode::SUCCESS);
    }

    #[test]
    fn source_failure_without_any_facts_is_fatal() {
        let mut snap = Snapshot::new();
        snap.errors.push(SourceError {
            source: "proc_listpids".into(),
            code: "EPERM".into(),
        });

        assert_eq!(snapshot_exit_code(&snap), ExitCode::from(1));
    }

    #[test]
    fn partial_host_source_failure_does_not_discard_good_facts() {
        let mut host = HostSnapshot::new();
        host.uptime_us = 1;
        host.errors.push(SourceError {
            source: "getifaddrs".into(),
            code: "EPERM".into(),
        });

        assert_eq!(host_exit_code(&host), ExitCode::SUCCESS);
    }
}
