//! Flag surface. No OS reads.

use lexopt::prelude::*;
use osfacts::Facet;
use std::ffi::OsString;

#[derive(Debug)]
pub enum Command {
    Snapshot(SnapshotArgs),
    SocketHolders(SocketHoldersArgs),
    Host(HostArgs),
}

/// The `socket-holders` ask: one unix socket PATH, and whether to name the
/// holders as well as count them.
///
/// The path is positional and mandatory, not a facet: the holder set IS this
/// verb's answer, so — unlike `snapshot` and `host` — there is no "at least
/// one facet required" rule to enforce. `--procs` is the one composable facet,
/// and it costs holder *identity*, never the holder set.
#[derive(Debug)]
pub struct SocketHoldersArgs {
    pub path: OsString,
    pub procs: bool,
    pub json: bool,
}

#[derive(Debug, Default)]
pub struct SnapshotArgs {
    pub scope: Scope,
    pub procs: bool,
    pub ports: bool,
    pub mem: bool,
    pub start_time: bool,
    pub cpu_time: bool,
    pub uid: bool,
    pub cwd: bool,
    pub status: bool,
    pub argv: bool,
    pub json: bool,
}

impl SnapshotArgs {
    /// The facets this ask names — the answer to "what does a blind source
    /// cost me".
    ///
    /// It lives beside the flags because the flag→facet relation IS the ask,
    /// and a reader that spells it out for itself is writing that relation a
    /// second time with nothing keeping the copies in step. Both platform
    /// readers had one, and they had already drifted: darwin's named four of
    /// the nine while its sole process table gates all nine, so a `--mem`-only
    /// ask that lost `kern.proc.all` reported a `proc` row the consumer
    /// filtered out before reading an empty table as truth.
    ///
    /// Never empty — the CLI refuses an ask that names no facet — so a caller
    /// needs no fallback for "the ask named nothing".
    pub fn asked_facets(&self) -> Vec<Facet> {
        [
            (self.procs, Facet::Proc),
            (self.ports, Facet::Ports),
            (self.mem, Facet::Mem),
            (self.start_time, Facet::StartTime),
            (self.cpu_time, Facet::CpuTime),
            (self.uid, Facet::Uid),
            (self.cwd, Facet::Cwd),
            (self.status, Facet::Status),
            (self.argv, Facet::Argv),
        ]
        .into_iter()
        .filter_map(|(asked, facet)| asked.then_some(facet))
        .collect()
    }
}

#[derive(Debug, Default)]
pub struct HostArgs {
    pub load: bool,
    pub mem: bool,
    pub cpu: bool,
    pub net: bool,
    pub disk: bool,
    pub json: bool,
}

#[derive(Debug, Clone, Default)]
pub enum Scope {
    /// No scope flag: the whole host. The CLI's own default, stated here so
    /// `SnapshotArgs` can start from `Default` instead of a positional tuple.
    #[default]
    Host,
    Roots(Vec<u32>),
    Pids(Vec<u32>),
}

#[derive(Debug)]
pub enum CliError {
    Usage(String),
    Help(String),
}
impl std::fmt::Display for CliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Usage(s) | Self::Help(s) => f.write_str(s),
        }
    }
}

const HELP: &str = "\
osfacts — scoped, honest OS process & socket facts

Usage:
  osfacts snapshot [--roots PIDS|--pids PIDS] [--procs] [--ports] [--mem] [--start-time] [--cpu-time] [--uid] [--cwd] [--status] [--argv] [--json]
  osfacts socket-holders PATH [--procs] [--json]
  osfacts host [--load] [--mem] [--cpu] [--net] [--disk] [--json]
";

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, CliError> {
    let mut parser = lexopt::Parser::from_args(args);
    match parser.next().map_err(lex)? {
        Some(Value(v)) if v == "snapshot" => Ok(Command::Snapshot(parse_snapshot(&mut parser)?)),
        Some(Value(v)) if v == "socket-holders" => Ok(Command::SocketHolders(
            parse_socket_holders(&mut parser)?,
        )),
        Some(Value(v)) if v == "host" => Ok(Command::Host(parse_host(&mut parser)?)),
        Some(Value(v)) if v == "help" || v == "--help" || v == "-h" => {
            Err(CliError::Help(HELP.into()))
        }
        Some(Value(v)) => Err(CliError::Usage(format!(
            "unknown command '{}'\n\n{HELP}",
            v.to_string_lossy()
        ))),
        Some(Short('h')) | Some(Long("help")) | None => Err(CliError::Help(HELP.into())),
        Some(other) => Err(CliError::Usage(format!("unexpected {other:?}\n\n{HELP}"))),
    }
}

fn parse_snapshot(parser: &mut lexopt::Parser) -> Result<SnapshotArgs, CliError> {
    let (mut roots, mut pids) = (None, None);
    // Start from `Default` and set fields by name. The ten positional `bool`s
    // this replaces could be inserted at the wrong offset and swap two facets
    // with no type error and no test failure — a wrong-facet snapshot at
    // runtime, from a change that looked mechanical.
    let mut out = SnapshotArgs::default();
    while let Some(arg) = parser.next().map_err(lex)? {
        match arg {
            Long("roots") => {
                if pids.is_some() {
                    return Err(CliError::Usage(
                        "--roots and --pids are mutually exclusive".into(),
                    ));
                }
                roots = Some(parse_pid_list(&parser.value().map_err(lex)?)?);
            }
            Long("pids") => {
                if roots.is_some() {
                    return Err(CliError::Usage(
                        "--roots and --pids are mutually exclusive".into(),
                    ));
                }
                pids = Some(parse_pid_list(&parser.value().map_err(lex)?)?);
            }
            Long("procs") => out.procs = true,
            Long("ports") => out.ports = true,
            Long("mem") => out.mem = true,
            Long("start-time") => out.start_time = true,
            Long("cpu-time") => out.cpu_time = true,
            Long("uid") => out.uid = true,
            Long("cwd") => out.cwd = true,
            Long("status") => out.status = true,
            Long("argv") => out.argv = true,
            Long("json") => out.json = true,
            Short('h') | Long("help") => return Err(CliError::Help(HELP.into())),
            _ => return Err(CliError::Usage(format!("unexpected argument\n\n{HELP}"))),
        }
    }
    if !out.procs
        && !out.ports
        && !out.mem
        && !out.start_time
        && !out.cpu_time
        && !out.uid
        && !out.cwd
        && !out.status
        && !out.argv
    {
        return Err(CliError::Usage(format!(
            "at least one snapshot facet required\n\n{HELP}"
        )));
    }
    out.scope = match (roots, pids) {
        (None, None) => Scope::Host,
        (Some(v), None) => Scope::Roots(v),
        (None, Some(v)) => Scope::Pids(v),
        _ => unreachable!(),
    };
    Ok(out)
}

fn parse_socket_holders(parser: &mut lexopt::Parser) -> Result<SocketHoldersArgs, CliError> {
    let (mut path, mut procs, mut json) = (None, false, false);
    while let Some(arg) = parser.next().map_err(lex)? {
        match arg {
            // The path arrives as the raw `OsString`: a socket path is a byte
            // string the kernel bound verbatim, and lossy UTF-8 conversion here
            // would silently ask about a DIFFERENT path than the caller named.
            Value(v) if path.is_none() => path = Some(v),
            Value(_) => {
                return Err(CliError::Usage(format!(
                    "socket-holders takes exactly one PATH\n\n{HELP}"
                )))
            }
            Long("procs") => procs = true,
            Long("json") => json = true,
            Short('h') | Long("help") => return Err(CliError::Help(HELP.into())),
            _ => return Err(CliError::Usage(format!("unexpected argument\n\n{HELP}"))),
        }
    }
    let path = path.ok_or_else(|| CliError::Usage(format!("socket-holders needs a PATH\n\n{HELP}")))?;
    if path.is_empty() {
        return Err(CliError::Usage("socket path must not be empty".into()));
    }
    Ok(SocketHoldersArgs { path, procs, json })
}

fn parse_host(parser: &mut lexopt::Parser) -> Result<HostArgs, CliError> {
    let mut out = HostArgs::default();
    while let Some(arg) = parser.next().map_err(lex)? {
        match arg {
            Long("load") => out.load = true,
            Long("mem") => out.mem = true,
            Long("cpu") => out.cpu = true,
            Long("net") => out.net = true,
            Long("disk") => out.disk = true,
            Long("json") => out.json = true,
            Short('h') | Long("help") => return Err(CliError::Help(HELP.into())),
            _ => return Err(CliError::Usage(format!("unexpected argument\n\n{HELP}"))),
        }
    }
    if !out.load && !out.mem && !out.cpu && !out.net && !out.disk {
        return Err(CliError::Usage(format!(
            "at least one host facet required\n\n{HELP}"
        )));
    }
    Ok(out)
}

fn parse_pid_list(raw: &std::ffi::OsStr) -> Result<Vec<u32>, CliError> {
    let s = raw.to_string_lossy();
    if s.is_empty() {
        return Err(CliError::Usage("pid list must not be empty".into()));
    }
    s.split(',')
        .map(|part| {
            let part = part.trim();
            let pid = part
                .parse::<u32>()
                .map_err(|_| CliError::Usage(format!("not a pid: '{part}'")))?;
            if pid == 0 {
                Err(CliError::Usage("pid 0 is not a process".into()))
            } else {
                Ok(pid)
            }
        })
        .collect()
}
fn lex(e: lexopt::Error) -> CliError {
    CliError::Usage(e.to_string())
}
