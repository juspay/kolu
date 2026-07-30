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

use cli::{Command, HostArgs, SnapshotArgs, SocketHoldersArgs};
use osfacts::{HostSnapshot, Snapshot, SocketHolders, SourceError};
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

/// One document the binary can emit. The three verbs answer different
/// questions, but they all obey ONE emit-and-exit law, so it is written once:
/// a document that carried a fact is a success even when a source went blind,
/// and only a document with nothing but blindness in it exits non-zero.
trait Document {
    fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()>;
    fn write_json(&self, out: &mut dyn Write) -> io::Result<()>;
    fn has_facts(&self) -> bool;
    fn errors(&self) -> &[SourceError];
}

macro_rules! impl_document {
    ($t:ty) => {
        impl Document for $t {
            fn write_tsv(&self, out: &mut dyn Write) -> io::Result<()> {
                <$t>::write_tsv(self, out)
            }
            fn write_json(&self, out: &mut dyn Write) -> io::Result<()> {
                <$t>::write_json(self, out)
            }
            fn has_facts(&self) -> bool {
                <$t>::has_facts(self)
            }
            fn errors(&self) -> &[SourceError] {
                &self.errors
            }
        }
    };
}
impl_document!(Snapshot);
impl_document!(SocketHolders);
impl_document!(HostSnapshot);

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

/// Row order belongs to the schema, not to a sensor — same law as
/// [`take_snapshot`], so both platforms emit the same TSV for the same facts.
fn take_socket_holders(args: &SocketHoldersArgs) -> SocketHolders {
    #[cfg(target_os = "linux")]
    {
        let mut holders = linux::socket_holders(args);
        holders.normalize();
        return holders;
    }
    #[cfg(target_os = "macos")]
    {
        let mut holders = darwin::socket_holders(args);
        holders.normalize();
        return holders;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = args;
        SocketHolders::new()
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
    fn an_unclaimed_holder_survives_a_blind_name_source() {
        let mut holders = SocketHolders::new();
        holders.holders.push(Attribution::Unclaimed);
        holders
            .errors
            .push(source_error("proc_readdir", Facet::Proc, libc::EACCES));

        assert_eq!(exit_code(&holders), ExitCode::SUCCESS);
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
