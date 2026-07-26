//! osfacts — one versioned snapshot of processes and sockets.
//!
//! Contract: docs/atlas (os-facts-tool). Front door: README.md.
//!
//! Layout (space + time):
//! - `cli`     — flag surface only
//! - `schema`  — the versioned fact set + TSV/JSON (one serializer)
//! - `linux` / `darwin` — OS volatility, each fills a `Snapshot`
//! - `decode`  — pure darwin address-slot decision (fixtures run everywhere)

mod cli;
// decode is darwin-only at runtime; the scar-tissue unit tests path-include it
// on every host. Allow dead_code on linux so the pure fixtures stay next to
// the code they pin.
#[allow(dead_code)]
mod decode;
mod schema;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
mod darwin;

use cli::{Command, SnapshotArgs};
use schema::Snapshot;
use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    // Version line is mandatory even on error paths: a consumer built against
    // another revision fails loudly instead of parsing a half-shape into zero.
    match cli::parse(std::env::args_os().skip(1)) {
        Ok(Command::Snapshot(args)) => run_snapshot(args),
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
    ExitCode::SUCCESS
}

fn take_snapshot(args: &SnapshotArgs) -> Snapshot {
    #[cfg(target_os = "linux")]
    {
        return linux::snapshot(&args.scope, args.procs, args.ports);
    }
    #[cfg(target_os = "macos")]
    {
        return darwin::snapshot(&args.scope, args.procs, args.ports);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = args;
        Snapshot::new()
    }
}

fn write_version_only() -> io::Result<()> {
    let snap = Snapshot::new();
    // Empty body, version line only — enough for the version-first contract.
    snap.write_tsv(&mut io::stdout().lock())
}
