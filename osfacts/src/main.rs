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
        // The discards below are the end of the line: stderr is the only place
        // left to report anything, so a failure to write there has no channel
        // of its own. The exit code still carries the outcome.
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
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    let written = if args.json {
        snap.write_json(&mut out)
    } else {
        snap.write_tsv(&mut out)
    }
    .and_then(|()| out.flush());
    if let Err(e) = written {
        // stdout is already broken; stderr is the only channel left, and a
        // failure to write there cannot be reported anywhere. The nonzero exit
        // is what the caller actually reads.
        let _ = writeln!(io::stderr(), "osfacts: write failed: {e}");
        return ExitCode::from(1);
    }
    snapshot_exit_code(&snap)
}

fn snapshot_exit_code(snap: &Snapshot) -> ExitCode {
    if snap.errors.is_empty() || snap.has_facts() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn take_snapshot(args: &SnapshotArgs) -> Snapshot {
    // Row order belongs to the schema, not to a sensor: normalize here, once,
    // so both platforms emit the same TSV for the same facts.
    #[cfg(target_os = "linux")]
    {
        let mut snap = linux::snapshot(args);
        snap.normalize();
        return snap;
    }
    #[cfg(target_os = "macos")]
    {
        let mut snap = darwin::snapshot(args);
        snap.normalize();
        return snap;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = args;
        Snapshot::new()
    }
}

fn run_host(args: HostArgs) -> ExitCode {
    let host = take_host(&args);
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    let written = if args.json {
        host.write_json(&mut out)
    } else {
        host.write_tsv(&mut out)
    }
    .and_then(|()| out.flush());
    if let Err(e) = written {
        // stdout is already broken; stderr is the only channel left, and a
        // failure to write there cannot be reported anywhere. The nonzero exit
        // is what the caller actually reads.
        let _ = writeln!(io::stderr(), "osfacts: write failed: {e}");
        return ExitCode::from(1);
    }
    host_exit_code(&host)
}

fn host_exit_code(host: &HostSnapshot) -> ExitCode {
    if host.errors.is_empty() || host.has_facts() {
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
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    Snapshot::new()
        .write_tsv(&mut out)
        .and_then(|()| out.flush())
}

#[cfg(test)]
mod tests {
    use super::*;
    use osfacts::{blind_or_empty, source_error, Facet, Proc};

    #[test]
    fn partial_source_failure_does_not_discard_good_facts() {
        let mut snap = Snapshot::new();
        snap.procs.push(Proc {
            pid: 42,
            ppid: 1,
            name: "readable".into(),
        });
        snap.errors
            .push(blind_or_empty("darwin_tcp_pcblist", Facet::PortsUnclaimed));

        assert_eq!(snapshot_exit_code(&snap), ExitCode::SUCCESS);
    }

    #[test]
    fn source_failure_without_any_facts_is_fatal() {
        let mut snap = Snapshot::new();
        snap.errors
            .push(source_error("proc_listpids", Facet::Proc, libc::EPERM));

        assert_eq!(snapshot_exit_code(&snap), ExitCode::from(1));
    }

    /// A host-global constant that fails costs the facet ONCE, as one `E` row —
    /// never N per-pid `U` rows. Both such constants (linux page size, darwin
    /// mach timebase) report this way, so a consumer scoping blindness by facet
    /// writes one rule.
    #[test]
    fn a_failed_host_global_constant_is_one_source_error_not_n_pid_rows() {
        let mut snap = Snapshot::new();
        snap.errors
            .push(source_error("sysconf_pagesize", Facet::Mem, libc::EIO));

        assert!(snap.unreadable.is_empty());
        assert_eq!(snapshot_exit_code(&snap), ExitCode::from(1));
    }

    #[test]
    fn partial_host_source_failure_does_not_discard_good_facts() {
        let mut host = HostSnapshot::new();
        host.uptime_us = Some(1);
        host.errors
            .push(source_error("net_rt_iflist2", Facet::Net, libc::EPERM));

        assert_eq!(host_exit_code(&host), ExitCode::SUCCESS);
    }
}
