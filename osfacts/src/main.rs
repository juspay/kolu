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
    if snap.errors.is_empty() {
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
    if host.errors.is_empty() {
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
