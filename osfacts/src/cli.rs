//! Flag surface. No OS reads, no schema knowledge beyond the facet names.

use lexopt::prelude::*;
use std::ffi::OsString;

#[derive(Debug)]
pub enum Command {
    Snapshot(SnapshotArgs),
}

#[derive(Debug)]
pub struct SnapshotArgs {
    /// Subtree roots, exact pids, or host-wide.
    pub scope: Scope,
    pub procs: bool,
    pub ports: bool,
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
            CliError::Usage(s) | CliError::Help(s) => f.write_str(s),
        }
    }
}

const HELP: &str = "\
osfacts — scoped, honest OS process & socket facts

Usage:
  osfacts snapshot [--roots PIDS|--pids PIDS] [--procs] [--ports] [--json]

Scoping (pick at most one; none means host-wide):
  --roots PIDS   walk each pid's process subtree
  --pids  PIDS   exactly these pids

Facets (at least one):
  --procs        pid / ppid / name rows
  --ports        listening TCP sockets (raw address bytes)

  --json         JSON on stdout instead of versioned TSV
  -h, --help     show this help
";

pub fn parse(args: impl IntoIterator<Item = OsString>) -> Result<Command, CliError> {
    let mut parser = lexopt::Parser::from_args(args);
    let cmd = match parser.next().map_err(lex)? {
        Some(Value(v)) => {
            let s = v.to_string_lossy();
            if s == "snapshot" {
                parse_snapshot(&mut parser)?
            } else if s == "help" || s == "--help" || s == "-h" {
                return Err(CliError::Help(HELP.into()));
            } else {
                return Err(CliError::Usage(format!("unknown command '{s}'\n\n{HELP}")));
            }
        }
        Some(Short('h')) | Some(Long("help")) | None => {
            return Err(CliError::Help(HELP.into()));
        }
        Some(other) => {
            return Err(CliError::Usage(format!("unexpected {other:?}\n\n{HELP}")));
        }
    };
    Ok(Command::Snapshot(cmd))
}

fn parse_snapshot(parser: &mut lexopt::Parser) -> Result<SnapshotArgs, CliError> {
    let mut roots: Option<Vec<u32>> = None;
    let mut pids: Option<Vec<u32>> = None;
    let mut procs = false;
    let mut ports = false;
    let mut json = false;

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
            Long("json") => json = true,
            Short('h') | Long("help") => return Err(CliError::Help(HELP.into())),
            _ => {
                return Err(CliError::Usage(format!("unexpected argument\n\n{HELP}")));
            }
        }
    }

    if !procs && !ports {
        return Err(CliError::Usage(format!(
            "at least one facet required: --procs and/or --ports\n\n{HELP}"
        )));
    }

    let scope = match (roots, pids) {
        (None, None) => Scope::Host,
        (Some(r), None) => Scope::Roots(r),
        (None, Some(p)) => Scope::Pids(p),
        (Some(_), Some(_)) => unreachable!("mutual exclusion checked above"),
    };

    Ok(SnapshotArgs {
        scope,
        procs,
        ports,
        json,
    })
}

fn parse_pid_list(raw: &std::ffi::OsStr) -> Result<Vec<u32>, CliError> {
    let s = raw.to_string_lossy();
    if s.is_empty() {
        return Err(CliError::Usage("pid list must not be empty".into()));
    }
    let mut out = Vec::new();
    for part in s.split(',') {
        let part = part.trim();
        if part.is_empty() {
            return Err(CliError::Usage(format!("empty pid in list '{s}'")));
        }
        let pid: u32 = part
            .parse()
            .map_err(|_| CliError::Usage(format!("not a pid: '{part}'")))?;
        if pid == 0 {
            return Err(CliError::Usage("pid 0 is not a process".into()));
        }
        out.push(pid);
    }
    Ok(out)
}

fn lex(e: lexopt::Error) -> CliError {
    CliError::Usage(e.to_string())
}
