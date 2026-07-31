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
/// Each verb below is then ONE line with no `#[cfg]` of its own — the same
/// five-branch dispatch written once instead of once per verb, which is what a
/// per-verb doc comment reading "same law as the one above" was standing in
/// for. A fourth verb inherits the dispatch for free, and — through [`take`]
/// and `Document::normalize` — the row-ordering step with it.
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use darwin as platform;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use unsupported as platform;

/// The no-sensor platform.
///
/// An empty document is NOT the honest shape here, and that distinction is the
/// whole point of the `socket-holders` verb: an empty holder document is the
/// affirmative answer *nobody holds this path*, so a build with no sensor
/// would tell a supervisor that a live rendezvous socket is free. It reports
/// the only true thing instead — this build cannot look — as the same
/// `socket_holders` source error a blind darwin walk emits, which the client
/// folds to `unattributed`, never `none`.
///
/// The other two verbs have no such affirmative-empty arm (an empty snapshot
/// means "no facts", which is what it says), so they keep the empty document.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod unsupported {
    use crate::cli::{HostArgs, SnapshotArgs, SocketHoldersArgs};
    use osfacts::{HostSnapshot, Snapshot, SocketHolders};

    pub fn snapshot(_args: &SnapshotArgs) -> Snapshot {
        Snapshot::new()
    }
    pub fn socket_holders(_args: &SocketHoldersArgs) -> SocketHolders {
        SocketHolders::unsupported_platform("unsupported_platform")
    }
    pub fn host(_args: &HostArgs) -> HostSnapshot {
        HostSnapshot::new()
    }
}

use cli::Command;
use osfacts::{Document, Snapshot};
use std::io::{self, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    // Version line is mandatory even on error paths: a consumer built against
    // another revision fails loudly instead of parsing a half-shape into zero.
    match cli::parse(std::env::args_os().skip(1)) {
        Ok(Command::Snapshot(args)) => emit(&take(platform::snapshot(&args)), args.json),
        Ok(Command::SocketHolders(args)) => emit(&take(platform::socket_holders(&args)), args.json),
        Ok(Command::Host(args)) => emit(&take(platform::host(&args)), args.json),
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

/// Take a sensor's reading and put it in document order.
///
/// One taker for every verb, because row order belongs to the SCHEMA, not to a
/// sensor: normalize here, once, so both platforms emit the same TSV for the
/// same facts. Each document says for itself what its order is (a
/// `HostSnapshot` inherits the do-nothing default), so a fourth verb genuinely
/// inherits this dispatch instead of arriving with a wrapper of its own.
fn take<D: Document>(mut doc: D) -> D {
    doc.normalize();
    doc
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
    use osfacts::{
        blind_or_empty, source_error, Attribution, Facet, HostSnapshot, Proc, SocketHolders,
    };

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

    /// A build with no sensor must never say "nobody holds it": that is the
    /// affirmative answer, and it would send a supervisor to spawn onto a live
    /// rendezvous socket. It reports blindness, and exits non-zero.
    #[test]
    fn a_sensorless_build_reports_blindness_not_absence() {
        let holders = SocketHolders::unsupported_platform("unsupported_platform");

        assert!(!holders.has_facts());
        assert!(holders
            .errors
            .iter()
            .any(|row| row.facet == Facet::SocketHolders));
        assert_eq!(exit_code(&holders), ExitCode::from(1));
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
