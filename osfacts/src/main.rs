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

/// The one place the host platform is named.
///
/// Each verb below is then three lines with no `#[cfg]` of its own — the same
/// five-branch dispatch written once instead of once per verb, which is what a
/// doc comment reading "same law as `take_snapshot`" was standing in for. A
/// fourth verb inherits the dispatch for free.
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use darwin as platform;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use unsupported as platform;

/// The empty-document platform. Not a fallback: a host osfacts has no sensors
/// for cannot answer, and an empty document with no `E` rows is the honest
/// shape for "this build was never taught to look" — it exits 0 with nothing,
/// exactly as the three `#[cfg(not(...))]` arms it replaces did.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod unsupported {
    use crate::cli::{HostArgs, SnapshotArgs, SocketHoldersArgs};
    use osfacts::{HostSnapshot, Snapshot, SocketHolders};

    pub fn snapshot(_args: &SnapshotArgs) -> Snapshot {
        Snapshot::new()
    }
    pub fn socket_holders(_args: &SocketHoldersArgs) -> SocketHolders {
        SocketHolders::new()
    }
    pub fn host(_args: &HostArgs) -> HostSnapshot {
        HostSnapshot::new()
    }
}

use cli::{Command, HostArgs, SnapshotArgs, SocketHoldersArgs};
use osfacts::{Document, HostSnapshot, Snapshot, SocketHolders};
use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    // Version line is mandatory even on error paths: a consumer built against
    // another revision fails loudly instead of parsing a half-shape into zero.
    match cli::parse(std::env::args_os().skip(1)) {
        Ok(Command::Snapshot(args)) => emit(&take_snapshot(&args), args.json),
        Ok(Command::SocketHolders(args)) => emit(&take_socket_holders(&args), args.json),
        Ok(Command::Host(args)) => emit(&take_host(&args), args.json),
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

fn emit(doc: &dyn Document, json: bool) -> ExitCode {
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    let written = if json {
        doc.write_json(&mut out)
    } else {
        doc.write_tsv(&mut out)
    }
    .and_then(|()| out.flush());
    if let Err(e) = written {
        // stdout is already broken; stderr is the only channel left, and a
        // failure to write there cannot be reported anywhere. The nonzero exit
        // is what the caller actually reads.
        let _ = writeln!(io::stderr(), "osfacts: write failed: {e}");
        return ExitCode::from(1);
    }
    exit_code(doc)
}

fn exit_code(doc: &dyn Document) -> ExitCode {
    if doc.errors().is_empty() || doc.has_facts() {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn take_snapshot(args: &SnapshotArgs) -> Snapshot {
    // Row order belongs to the schema, not to a sensor: normalize here, once,
    // so both platforms emit the same TSV for the same facts.
    let mut snap = platform::snapshot(args);
    snap.normalize();
    snap
}

fn take_socket_holders(args: &SocketHoldersArgs) -> SocketHolders {
    let mut holders = platform::socket_holders(args);
    holders.normalize();
    holders
}

/// No `normalize` here, and that is a decision rather than an omission: a
/// `HostSnapshot` carries no per-pid row vectors to order — its facts are
/// scalars plus cpu/net/disk lists the sensors already emit in the host's own
/// enumeration order, which is the order to report them in.
fn take_host(args: &HostArgs) -> HostSnapshot {
    platform::host(args)
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
    use osfacts::{blind_or_empty, source_error, Attribution, Facet, Proc};

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

        assert_eq!(exit_code(&snap), ExitCode::SUCCESS);
    }

    #[test]
    fn source_failure_without_any_facts_is_fatal() {
        let mut snap = Snapshot::new();
        snap.errors
            .push(source_error("proc_listpids", Facet::Proc, libc::EPERM));

        assert_eq!(exit_code(&snap), ExitCode::from(1));
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
        assert_eq!(exit_code(&snap), ExitCode::from(1));
    }

    /// "Nobody holds this path" is an ANSWER, not a failure. It is the one
    /// document with no facts that still exits successfully, and the whole
    /// point of the verb: a consumer must be able to tell it from blindness.
    #[test]
    fn an_unheld_socket_is_a_successful_empty_answer() {
        let holders = SocketHolders::new();

        assert!(!holders.has_facts());
        assert_eq!(exit_code(&holders), ExitCode::SUCCESS);
    }

    #[test]
    fn a_blind_socket_holder_source_without_facts_is_fatal() {
        let mut holders = SocketHolders::new();
        holders.errors.push(source_error(
            "proc_net_unix",
            Facet::SocketHolders,
            libc::EACCES,
        ));

        assert_eq!(exit_code(&holders), ExitCode::from(1));
    }

    /// A bound socket no readable pid claims is a fact — so a `--procs` ask
    /// that also lost holder *names* still succeeds, carrying both.
    #[test]
    fn a_holder_whose_name_is_unreadable_is_still_an_answer() {
        let mut holders = SocketHolders::new();
        holders.holders.push(Attribution::Claimed { pid: 7 });
        // The `--procs` failure this verb really has: the pid set is already
        // known, so a name it cannot read costs THAT holder and nothing else.
        // It is a `U` row, never an `E … proc …` one — which is why
        // `SOCKET_HOLDERS_SOURCE` names only `socket_holders`.
        holders.push_unreadable(7, Facet::Proc, libc::EACCES);

        assert_eq!(exit_code(&holders), ExitCode::SUCCESS);
        assert!(holders.errors.is_empty());
        assert!(!Facet::SOCKET_HOLDERS_SOURCE.contains(&Facet::Proc));
    }

    #[test]
    fn partial_host_source_failure_does_not_discard_good_facts() {
        let mut host = HostSnapshot::new();
        host.uptime_us = Some(1);
        host.errors
            .push(source_error("net_rt_iflist2", Facet::Net, libc::EPERM));

        assert_eq!(exit_code(&host), ExitCode::SUCCESS);
    }
}
