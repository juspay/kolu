//! Flag surface. No OS reads.

use lexopt::prelude::*;
use std::ffi::OsString;

#[derive(Debug)]
pub enum Command {
    Snapshot(SnapshotArgs),
    Host(HostArgs),
}

#[derive(Debug)]
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

#[derive(Debug)]
pub struct HostArgs {
    pub load: bool,
    pub mem: bool,
    pub cpu: bool,
    pub net: bool,
    pub disk: bool,
    pub json: bool,
}

#[derive(Debug, Clone)]
pub enum Scope {
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
  osfacts host [--load] [--mem] [--cpu] [--net] [--disk] [--json]
";

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, CliError> {
    let mut parser = lexopt::Parser::from_args(args);
    match parser.next().map_err(lex)? {
        Some(Value(v)) if v == "snapshot" => Ok(Command::Snapshot(parse_snapshot(&mut parser)?)),
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
    let (
        mut procs,
        mut ports,
        mut mem,
        mut start_time,
        mut cpu_time,
        mut uid,
        mut cwd,
        mut status,
        mut argv,
        mut json,
    ) = (
        false, false, false, false, false, false, false, false, false, false,
    );
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
            Long("procs") => procs = true,
            Long("ports") => ports = true,
            Long("mem") => mem = true,
            Long("start-time") => start_time = true,
            Long("cpu-time") => cpu_time = true,
            Long("uid") => uid = true,
            Long("cwd") => cwd = true,
            Long("status") => status = true,
            Long("argv") => argv = true,
            Long("json") => json = true,
            Short('h') | Long("help") => return Err(CliError::Help(HELP.into())),
            _ => return Err(CliError::Usage(format!("unexpected argument\n\n{HELP}"))),
        }
    }
    if !procs && !ports && !mem && !start_time && !cpu_time && !uid && !cwd && !status && !argv {
        return Err(CliError::Usage(format!(
            "at least one snapshot facet required\n\n{HELP}"
        )));
    }
    let scope = match (roots, pids) {
        (None, None) => Scope::Host,
        (Some(v), None) => Scope::Roots(v),
        (None, Some(v)) => Scope::Pids(v),
        _ => unreachable!(),
    };
    Ok(SnapshotArgs {
        scope,
        procs,
        ports,
        mem,
        start_time,
        cpu_time,
        uid,
        cwd,
        status,
        argv,
        json,
    })
}

fn parse_host(parser: &mut lexopt::Parser) -> Result<HostArgs, CliError> {
    let (mut load, mut mem, mut cpu, mut net, mut disk, mut json) =
        (false, false, false, false, false, false);
    while let Some(arg) = parser.next().map_err(lex)? {
        match arg {
            Long("load") => load = true,
            Long("mem") => mem = true,
            Long("cpu") => cpu = true,
            Long("net") => net = true,
            Long("disk") => disk = true,
            Long("json") => json = true,
            Short('h') | Long("help") => return Err(CliError::Help(HELP.into())),
            _ => return Err(CliError::Usage(format!("unexpected argument\n\n{HELP}"))),
        }
    }
    if !load && !mem && !cpu && !net && !disk {
        return Err(CliError::Usage(format!(
            "at least one host facet required\n\n{HELP}"
        )));
    }
    Ok(HostArgs {
        load,
        mem,
        cpu,
        net,
        disk,
        json,
    })
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
