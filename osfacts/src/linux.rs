//! Linux readers. OS failures stay typed: per-pid failures become `U`, global
//! requested-source failures become `E` and a non-zero command exit.

use crate::cli::{HostArgs, Scope, SnapshotArgs, SocketHoldersArgs};
use osfacts::{
    blind_or_empty, decode_proc_hex, hex_bytes, sanitize_name, source_error, Attribution, Cpu,
    Disk, Facet, HostMemory, HostSnapshot, Load, Memory, Network, Port, Proc, ProcessArgv,
    unix_socket_inodes, ProcessCpuTime, ProcessCwd, ProcessStatus, ProcessUid, Snapshot,
    SocketHolders, StartTime, Swap,
};
use std::collections::{HashMap, HashSet};
use std::ffi::CString;
use std::fs;
use std::io::{self, Read};
use std::path::Path;
use std::thread;

const TCP_LISTEN: &str = "0A";

pub fn snapshot(args: &SnapshotArgs) -> Snapshot {
    let mut snap = Snapshot::new();
    let pids = match collect_pids(&args.scope, &mut snap) {
        Ok(pids) => pids,
        Err(err) => {
            // Listing `/proc` is how a host-wide ask learns which pids exist,
            // so its silence costs every facet the ask named — the same shape
            // as darwin's `kern.proc.all`, which is that platform's sole
            // process source.
            for facet in args.asked_facets() {
                snap.errors.push(source_error("proc_readdir", facet, err));
            }
            return snap;
        }
    };
    let boot_us = if args.start_time {
        match boot_time_us() {
            Ok(value) => Some(value),
            Err(err) => {
                snap.errors
                    .push(source_error("proc_stat_btime", Facet::StartTime, err));
                None
            }
        }
    } else {
        None
    };
    // The tick rate is one host-global constant, so it is read once here and
    // handed to both facets that need it. Re-deriving it per pid would turn a
    // single source failure into one `U` row per process — a host fact
    // misfiled as N per-process facts.
    let clk_hz = if args.cpu_time || args.start_time {
        match clock_ticks() {
            Ok(value) => Some(value),
            Err(err) => {
                if args.start_time {
                    snap.errors
                        .push(source_error("sysconf_clk_tck", Facet::StartTime, err));
                }
                if args.cpu_time {
                    snap.errors
                        .push(source_error("sysconf_clk_tck", Facet::CpuTime, err));
                }
                None
            }
        }
    } else {
        None
    };
    // Same rule as the tick rate above: the page size is one host-global
    // constant. Its failure is one `E` row for the facet it costs, never one
    // `U` row per process.
    let page_size = if args.mem {
        match page_size() {
            Ok(value) => Some(value),
            Err(err) => {
                snap.errors
                    .push(source_error("sysconf_pagesize", Facet::Mem, err));
                None
            }
        }
    } else {
        None
    };

    for &pid in &pids {
        // One snapshot should observe one copy of each proc file. Several
        // facets share stat/cmdline; reopening them per facet multiplies I/O
        // and can mix observations from different instants.
        let stat = (args.procs || args.start_time || args.cpu_time || args.status)
            .then(|| read_string(&format!("/proc/{pid}/stat")));
        let cmdline =
            (args.procs || args.argv).then(|| read_bytes(&format!("/proc/{pid}/cmdline")));
        if args.procs {
            let stat = stat
                .as_ref()
                .expect("stat is loaded for process rows")
                .as_deref()
                .map_err(|err| *err);
            let cmdline = cmdline
                .as_ref()
                .expect("cmdline is loaded for process rows")
                .as_deref()
                .map_err(|err| *err);
            match stat.and_then(|stat| read_proc(pid, stat, cmdline)) {
                Ok(row) => snap.procs.push(Proc {
                    pid,
                    ppid: row.ppid,
                    name: row.name,
                }),
                Err(err) => snap.push_unreadable(pid, Facet::Proc, err),
            }
        }
        if let (true, Some(page)) = (args.mem, page_size) {
            let rss = match stat.as_ref() {
                Some(stat) => stat
                    .as_deref()
                    .map_err(|err| *err)
                    .and_then(|stat| read_rss_from_stat(stat, page)),
                None => read_rss_from_statm(pid, page),
            };
            match rss {
                Ok(rss_bytes) => snap.memory.push(Memory { pid, rss_bytes }),
                Err(err) => snap.push_unreadable(pid, Facet::Mem, err),
            }
        }
        if let (Some(boot_us), Some(clk_hz)) = (boot_us, clk_hz) {
            let stat = stat
                .as_ref()
                .expect("stat is loaded for start time")
                .as_deref()
                .map_err(|err| *err);
            match stat.and_then(|stat| read_start_time(stat, boot_us, clk_hz)) {
                Ok(start_unix_us) => snap.start_times.push(StartTime { pid, start_unix_us }),
                Err(err) => snap.push_unreadable(pid, Facet::StartTime, err),
            }
        }
        if let (true, Some(cpu_hz)) = (args.cpu_time, clk_hz) {
            let stat = stat
                .as_ref()
                .expect("stat is loaded for CPU time")
                .as_deref()
                .map_err(|err| *err);
            match stat.and_then(|stat| read_cpu_time(stat, cpu_hz)) {
                Ok(cpu_time_us) => snap.cpu_times.push(ProcessCpuTime { pid, cpu_time_us }),
                Err(err) => snap.push_unreadable(pid, Facet::CpuTime, err),
            }
        }
        if args.uid {
            match read_uid(pid) {
                Ok(uid) => snap.uids.push(ProcessUid { pid, uid }),
                Err(err) => snap.push_unreadable(pid, Facet::Uid, err),
            }
        }
        if args.cwd {
            match read_cwd(pid) {
                Ok(cwd) => snap.cwds.push(ProcessCwd { pid, cwd }),
                Err(err) => snap.push_unreadable(pid, Facet::Cwd, err),
            }
        }
        if args.status {
            let stat = stat
                .as_ref()
                .expect("stat is loaded for status")
                .as_deref()
                .map_err(|err| *err);
            match stat.and_then(read_status) {
                Ok((state, nice, threads)) => snap.statuses.push(ProcessStatus {
                    pid,
                    state,
                    nice,
                    threads: Some(threads),
                }),
                Err(err) => snap.push_unreadable(pid, Facet::Status, err),
            }
        }
        if args.argv {
            let cmdline = cmdline
                .as_ref()
                .expect("cmdline is loaded for argv")
                .as_deref()
                .map_err(|err| *err);
            match cmdline.map(read_argv) {
                Ok(argv) => snap.argv.push(ProcessArgv { pid, argv }),
                Err(err) => snap.push_unreadable(pid, Facet::Argv, err),
            }
        }
    }

    if args.ports {
        match load_listeners() {
            Ok(listeners) => {
                let mut claims = HashMap::<u64, u32>::new();
                for (pid, result) in socket_inodes_for_pids(&pids) {
                    match result {
                        Ok(inodes) => {
                            for inode in inodes {
                                claims.entry(inode).or_insert(pid);
                            }
                        }
                        Err(err) => snap.push_unreadable(pid, Facet::Ports, err),
                    }
                }
                snap.ports = listeners
                    .into_iter()
                    .map(|listener| Port {
                        attribution: claims
                            .get(&listener.inode)
                            .map_or(Attribution::Unclaimed, |&pid| Attribution::Claimed { pid }),
                        uid: Some(listener.uid),
                        port: listener.port,
                        address: hex_bytes(&listener.addr),
                    })
                    .collect();
            }
            // `/proc/net/tcp{,6}` is the only listener source on linux, so its
            // silence costs the whole listener set, claimed rows included.
            Err((source, err)) => snap.errors.push(source_error(source, Facet::Ports, err)),
        }
    }

    snap
}

/// Who holds one unix socket PATH.
///
/// Linux answers this authoritatively in two reads. `/proc/net/unix` is
/// world-readable and lists EVERY bound unix socket, so the path's absence
/// from it is proof that nobody holds it — never a shrug. The inode it carries
/// is then the socket's identity, and a walk of `/proc/<pid>/fd` says which
/// pids hold that identity.
///
/// An fd directory this process may not read is NOT reported per pid. The ask
/// names a path, so the pid set searched is the whole host — one `U` row per
/// foreign-uid process would be hundreds of rows saying the same thing, and
/// would drown the answer on a boot path. The blindness is reported where it
/// is decision-relevant instead: a bound socket that no readable pid claims
/// emits `unclaimed`, exactly as an unattributed listener does under OSF6.
pub fn socket_holders(args: &SocketHoldersArgs) -> SocketHolders {
    let mut out = SocketHolders::new();
    let table = match read_string("/proc/net/unix") {
        Ok(body) => body,
        // The only source of the bound-socket table on linux; its silence
        // costs the whole answer.
        Err(err) => {
            out.errors
                .push(source_error("proc_net_unix", Facet::SocketHolders, err));
            return out;
        }
    };
    let inodes = unix_socket_inodes(&table, args.path.as_encoded_bytes());
    if inodes.is_empty() {
        return out; // proof of absence: the table lists every bound socket
    }

    let pids = match host_pids() {
        Ok(pids) => pids,
        // We know the socket IS bound but cannot search for its holder — the
        // attribution half went blind, and saying "unclaimed" would assert a
        // search that never happened.
        Err(err) => {
            out.errors
                .push(source_error("proc_readdir", Facet::SocketHolders, err));
            return out;
        }
    };
    let mut claimed: Vec<u32> = Vec::new();
    for (pid, result) in socket_inodes_for_pids(&pids) {
        // A pid whose fds we cannot read is why `unclaimed` exists — see the
        // header. Every readable pid holding one of the path's inodes is a
        // holder, INCLUDING a child that inherited the listening descriptor.
        if result.is_ok_and(|held| inodes.iter().any(|inode| held.contains(inode))) {
            claimed.push(pid);
        }
    }
    if claimed.is_empty() {
        out.holders.push(Attribution::Unclaimed);
    } else {
        out.holders
            .extend(claimed.iter().map(|&pid| Attribution::Claimed { pid }));
    }

    if args.procs {
        for pid in claimed {
            let stat = read_string(&format!("/proc/{pid}/stat"));
            let cmdline = read_bytes(&format!("/proc/{pid}/cmdline"));
            match stat
                .as_deref()
                .map_err(|err| *err)
                .and_then(|stat| read_proc(pid, stat, cmdline.as_deref().map_err(|err| *err)))
            {
                Ok(row) => out.procs.push(Proc {
                    pid,
                    ppid: row.ppid,
                    name: row.name,
                }),
                Err(err) => out.push_unreadable(pid, Facet::Proc, err),
            }
        }
    }
    out
}

pub fn host(args: &HostArgs) -> HostSnapshot {
    let mut out = HostSnapshot::new();
    match uptime_us() {
        Ok(v) => out.uptime_us = Some(v),
        Err(e) => out
            .errors
            .push(source_error("proc_uptime", Facet::Uptime, e)),
    }
    if args.load {
        match read_load() {
            Ok(v) => out.load = Some(v),
            Err(e) => out
                .errors
                .push(source_error("proc_loadavg", Facet::Load, e)),
        }
    }
    if args.mem {
        match read_host_memory() {
            Ok((m, s)) => {
                out.memory = Some(m);
                out.swap = Some(s)
            }
            Err(e) => out.errors.push(source_error("proc_meminfo", Facet::Mem, e)),
        }
    }
    if args.cpu {
        match read_cpus() {
            Ok(v) => out.cpus = v,
            Err((source, e)) => out.errors.push(source_error(source, Facet::Cpu, e)),
        }
    }
    if args.net {
        match read_networks() {
            // `lo` is always present, so an empty parse means the file did not
            // have the shape this reader expects — blindness, not a host with
            // no interfaces. That is the same indistinguishable-empty condition
            // darwin's gated interface table hits, so it carries the same code
            // rather than a platform-specific errno.
            Ok(v) if v.is_empty() => out.errors.push(blind_or_empty("proc_net_dev", Facet::Net)),
            Ok(v) => out.networks = v,
            Err(e) => out.errors.push(source_error("proc_net_dev", Facet::Net, e)),
        }
    }
    if args.disk {
        match read_root_disk() {
            Ok(v) => out.disks.push(v),
            Err(e) => out
                .errors
                .push(source_error("statvfs_root", Facet::Disk, e)),
        }
    }
    out
}

fn collect_pids(scope: &Scope, snap: &mut Snapshot) -> Result<Vec<u32>, i32> {
    match scope {
        Scope::Host => host_pids(),
        Scope::Pids(list) => Ok(list.clone()),
        Scope::Roots(roots) => {
            let mut seen = HashSet::new();
            let mut out = Vec::new();
            for &root in roots {
                if !seen.insert(root) {
                    continue;
                }
                if !Path::new(&format!("/proc/{root}")).exists() {
                    snap.push_unreadable(root, Facet::Proc, libc::ENOENT);
                    continue;
                }
                out.push(root);
                if let Err(err) = descend(root, &mut seen, &mut out) {
                    snap.push_unreadable(root, Facet::Proc, err);
                }
            }
            Ok(out)
        }
    }
}

fn host_pids() -> Result<Vec<u32>, i32> {
    let mut p = Vec::new();
    // Not `if let Ok(..)`. `/proc` is how a host-wide snapshot learns which
    // pids exist, so a failed listing is total blindness — and swallowing it
    // hands the consumer a successful, empty, entirely plausible "this host
    // has no processes".
    let rd = fs::read_dir("/proc").map_err(|err| raw_errno(&err))?;
    for e in rd {
        // Not `.flatten()`. An entry that fails mid-listing drops a pid, and a
        // shorter-than-real process table looks exactly like a healthy one —
        // the same blindness as a failed open, one level down.
        let e = e.map_err(|err| raw_errno(&err))?;
        if let Ok(pid) = e.file_name().to_string_lossy().parse() {
            p.push(pid)
        }
    }
    p.sort_unstable();
    Ok(p)
}
fn descend(root: u32, seen: &mut HashSet<u32>, out: &mut Vec<u32>) -> Result<(), i32> {
    let mut q = vec![root];
    while let Some(pid) = q.pop() {
        for child in children_of(pid)? {
            if seen.insert(child) {
                out.push(child);
                q.push(child)
            }
        }
    }
    Ok(())
}
fn children_of(pid: u32) -> Result<Vec<u32>, i32> {
    let mut out = Vec::new();
    // A pid that vanished mid-walk has no task dir; that is an exit race, not
    // blindness, and the subtree below it is genuinely gone. An entry that
    // fails WHILE listing is different — it hides descendants that still
    // exist, so it travels up as the root's `U proc` row rather than shrinking
    // the subtree silently.
    let Ok(tasks) = fs::read_dir(format!("/proc/{pid}/task")) else {
        return Ok(out);
    };
    for task in tasks {
        let task = task.map_err(|err| raw_errno(&err))?;
        if let Ok(body) = read_string(&format!(
            "/proc/{pid}/task/{}/children",
            task.file_name().to_string_lossy()
        )) {
            for part in body.split_whitespace() {
                if let Ok(v) = part.parse() {
                    out.push(v)
                }
            }
        }
    }
    Ok(out)
}

struct ProcRow {
    ppid: u32,
    name: String,
}
fn read_proc(pid: u32, stat: &str, cmdline: Result<&[u8], i32>) -> Result<ProcRow, i32> {
    let ppid =
        parse_stat_field(stat, 1).and_then(|value| value.parse().map_err(|_| libc::EINVAL))?;
    Ok(ProcRow {
        ppid,
        name: process_name(pid, stat, cmdline),
    })
}
fn process_name(pid: u32, stat: &str, cmdline: Result<&[u8], i32>) -> String {
    if let Ok(cmdline) = cmdline {
        if let Some(argv0) = cmdline.split(|&b| b == 0).next() {
            if !argv0.is_empty() {
                let s = String::from_utf8_lossy(argv0);
                let base = s.rsplit('/').next().unwrap_or(&s);
                if !base.is_empty() {
                    return sanitize_name(base);
                }
            }
        }
    }
    sanitize_name(&parse_comm(stat).unwrap_or_else(|| pid.to_string()))
}
fn parse_comm(stat: &str) -> Option<String> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    (close > open).then(|| stat[open + 1..close].to_string())
}
/// `after_comm_index`: 0=state, 1=ppid, …, 19=starttime, 21=rss.
fn parse_stat_field(stat: &str, after_comm_index: usize) -> Result<&str, i32> {
    let close = stat.rfind(')').ok_or(libc::EINVAL)?;
    stat[close + 1..]
        .split_whitespace()
        .nth(after_comm_index)
        .ok_or(libc::EINVAL)
}
fn read_rss_from_stat(stat: &str, page_size: u64) -> Result<u64, i32> {
    let pages = parse_stat_field(stat, 21)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    pages.checked_mul(page_size).ok_or(libc::EOVERFLOW)
}
fn read_rss_from_statm(pid: u32, page_size: u64) -> Result<u64, i32> {
    let body = read_string(&format!("/proc/{pid}/statm"))?;
    let pages = body
        .split_whitespace()
        .nth(1)
        .ok_or(libc::EINVAL)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    pages.checked_mul(page_size).ok_or(libc::EOVERFLOW)
}
fn page_size() -> Result<u64, i32> {
    let value = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if value <= 0 {
        return Err(libc::EIO);
    }
    Ok(value as u64)
}
fn boot_time_us() -> Result<u64, i32> {
    let body = read_string("/proc/stat")?;
    let secs = body
        .lines()
        .find_map(|line| line.strip_prefix("btime "))
        .ok_or(libc::EINVAL)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    Ok(secs * 1_000_000)
}
fn clock_ticks() -> Result<u64, i32> {
    let v = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if v <= 0 {
        Err(libc::EIO)
    } else {
        Ok(v as u64)
    }
}
fn read_start_time(stat: &str, boot_us: u64, hz: u64) -> Result<u64, i32> {
    let ticks = parse_stat_field(stat, 19)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    Ok(boot_us + ticks.saturating_mul(1_000_000) / hz)
}

fn read_cpu_time(stat: &str, hz: u64) -> Result<u64, i32> {
    let user = parse_stat_field(stat, 11)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    let system = parse_stat_field(stat, 12)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    Ok(ticks_us(user.saturating_add(system), hz))
}

fn read_uid(pid: u32) -> Result<u32, i32> {
    let status = read_string(&format!("/proc/{pid}/status"))?;
    status
        .lines()
        .find_map(|line| line.strip_prefix("Uid:"))
        .and_then(|value| value.split_whitespace().next())
        .ok_or(libc::EINVAL)?
        .parse()
        .map_err(|_| libc::EINVAL)
}

fn read_cwd(pid: u32) -> Result<String, i32> {
    fs::read_link(format!("/proc/{pid}/cwd"))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|err| raw_errno(&err))
}

fn read_status(stat: &str) -> Result<(char, i32, u32), i32> {
    let state = parse_stat_field(stat, 0)?
        .chars()
        .next()
        .ok_or(libc::EINVAL)?;
    let nice = parse_stat_field(stat, 16)?
        .parse()
        .map_err(|_| libc::EINVAL)?;
    let threads = parse_stat_field(stat, 17)?
        .parse()
        .map_err(|_| libc::EINVAL)?;
    Ok((state, nice, threads))
}

fn read_argv(cmdline: &[u8]) -> Vec<String> {
    cmdline
        .split(|byte| *byte == 0)
        .filter(|arg| !arg.is_empty())
        .map(|arg| String::from_utf8_lossy(arg).into_owned())
        .collect()
}

struct Listener {
    inode: u64,
    uid: u32,
    port: u16,
    addr: Vec<u8>,
}
fn load_listeners() -> Result<Vec<Listener>, (&'static str, i32)> {
    let mut out = Vec::new();
    let tcp = read_string("/proc/net/tcp").map_err(|err| ("proc_net_tcp", err))?;
    parse_proc_net(&tcp, &mut out).map_err(|e| ("proc_net_tcp", raw_errno(&e)))?;
    match read_string("/proc/net/tcp6") {
        Ok(body) => {
            parse_proc_net(&body, &mut out).map_err(|e| ("proc_net_tcp6", raw_errno(&e)))?
        }
        Err(libc::ENOENT) => {}
        Err(err) => return Err(("proc_net_tcp6", err)),
    }
    // A proc snapshot can transiently repeat the same socket while its row is
    // moving between kernel tables. The inode is the socket identity used by
    // fd attribution, so collapse only exact identity repeats; distinct
    // SO_REUSEPORT sockets keep their distinct inodes and rows.
    let mut seen = HashSet::new();
    out.retain(|listener| seen.insert(listener.inode));
    Ok(out)
}
fn parse_proc_net(body: &str, out: &mut Vec<Listener>) -> io::Result<()> {
    let mut lines = body.lines();
    if !lines.any(|l| l.contains("local_address")) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "no local_address header",
        ));
    }
    for line in lines {
        let cols: Vec<_> = line.split_whitespace().collect();
        if cols.len() < 10 || cols[3] != TCP_LISTEN {
            continue;
        }
        let Some((hex_addr, hex_port)) = cols[1].rsplit_once(':') else {
            continue;
        };
        let (Ok(port), Ok(addr), Ok(uid), Ok(inode)) = (
            u16::from_str_radix(hex_port, 16),
            decode_proc_hex(hex_addr),
            cols[7].parse(),
            cols[9].parse(),
        ) else {
            continue;
        };
        if port > 0 && inode > 0 {
            out.push(Listener {
                inode,
                uid,
                port,
                addr,
            })
        }
    }
    Ok(())
}
fn socket_inodes(pid: u32) -> Result<HashSet<u64>, i32> {
    let mut out = HashSet::new();
    for name in read_dir_names(&format!("/proc/{pid}/fd"))? {
        if let Ok(target) = fs::read_link(format!("/proc/{pid}/fd/{name}")) {
            let s = target.to_string_lossy();
            if let Some(n) = s
                .strip_prefix("socket:[")
                .and_then(|s| s.strip_suffix(']'))
                .and_then(|s| s.parse().ok())
            {
                out.insert(n);
            }
        }
    }
    Ok(out)
}

fn socket_inodes_for_pids(pids: &[u32]) -> Vec<(u32, Result<HashSet<u64>, i32>)> {
    const PIDS_PER_WORKER: usize = 64;
    const MAX_WORKERS: usize = 8;

    let workers = pids.len().div_ceil(PIDS_PER_WORKER).min(MAX_WORKERS);
    if workers <= 1 {
        return pids.iter().map(|&pid| (pid, socket_inodes(pid))).collect();
    }
    let chunk_len = pids.len().div_ceil(workers);
    thread::scope(|scope| {
        pids.chunks(chunk_len)
            .map(|chunk| {
                scope.spawn(move || {
                    chunk
                        .iter()
                        .map(|&pid| (pid, socket_inodes(pid)))
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .flat_map(|worker| worker.join().expect("port scan worker panicked"))
            .collect()
    })
}

fn uptime_us() -> Result<u64, i32> {
    let s = read_string("/proc/uptime")?;
    decimal_seconds_to_us(s.split_whitespace().next().ok_or(libc::EINVAL)?)
}
fn decimal_seconds_to_us(s: &str) -> Result<u64, i32> {
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let whole = whole.parse::<u64>().map_err(|_| libc::EINVAL)?;
    let mut micros = frac.chars().take(6).collect::<String>();
    while micros.len() < 6 {
        micros.push('0')
    }
    Ok(whole * 1_000_000 + micros.parse::<u64>().map_err(|_| libc::EINVAL)?)
}
fn read_load() -> Result<Load, i32> {
    let s = read_string("/proc/loadavg")?;
    let mut f = s.split_whitespace();
    Ok(Load {
        one: f
            .next()
            .ok_or(libc::EINVAL)?
            .parse()
            .map_err(|_| libc::EINVAL)?,
        five: f
            .next()
            .ok_or(libc::EINVAL)?
            .parse()
            .map_err(|_| libc::EINVAL)?,
        fifteen: f
            .next()
            .ok_or(libc::EINVAL)?
            .parse()
            .map_err(|_| libc::EINVAL)?,
    })
}
fn read_host_memory() -> Result<(HostMemory, Swap), i32> {
    let s = read_string("/proc/meminfo")?;
    let mut m = HashMap::new();
    for line in s.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if let Some(n) = v
                .split_whitespace()
                .next()
                .and_then(|n| n.parse::<u64>().ok())
            {
                m.insert(k, n * 1024);
            }
        }
    }
    let total = *m.get("MemTotal").ok_or(libc::EINVAL)?;
    let available = *m.get("MemAvailable").ok_or(libc::EINVAL)?;
    let swap_total = *m.get("SwapTotal").ok_or(libc::EINVAL)?;
    let swap_free = *m.get("SwapFree").ok_or(libc::EINVAL)?;
    Ok((
        HostMemory {
            total_bytes: total,
            available_bytes: available,
        },
        Swap {
            total_bytes: swap_total,
            used_bytes: swap_total.saturating_sub(swap_free),
        },
    ))
}
fn ticks_us(v: u64, hz: u64) -> u64 {
    v.saturating_mul(1_000_000) / hz
}
fn read_cpus() -> Result<Vec<Cpu>, (&'static str, i32)> {
    let metadata = read_cpu_metadata()?;
    let s = read_string("/proc/stat").map_err(|err| ("proc_stat_cpu", err))?;
    let hz = clock_ticks().map_err(|err| ("sysconf_clk_tck", err))?;
    let mut out = Vec::new();
    for line in s.lines() {
        let mut f = line.split_whitespace();
        let Some(name) = f.next() else { continue };
        let Some(core_s) = name.strip_prefix("cpu") else {
            continue;
        };
        if core_s.is_empty() {
            continue;
        }
        let Ok(core) = core_s.parse() else { continue };
        let vals: Vec<u64> = f
            .map(|value| value.parse().map_err(|_| ("proc_stat_cpu", libc::EINVAL)))
            .collect::<Result<_, _>>()?;
        if vals.len() < 4 {
            return Err(("proc_stat_cpu", libc::EINVAL));
        }
        let get = |i| *vals.get(i).unwrap_or(&0);
        let (model, frequency_mhz) = metadata.get(&core).ok_or(("proc_cpuinfo", libc::EINVAL))?;
        out.push(Cpu {
            core,
            user_us: ticks_us(get(0) + get(1), hz),
            system_us: ticks_us(get(2), hz),
            idle_us: ticks_us(get(3), hz),
            other_us: ticks_us(get(4) + get(5) + get(6) + get(7) + get(8) + get(9), hz),
            model: model.clone(),
            frequency_mhz: *frequency_mhz,
        })
    }
    if out.is_empty() {
        Err(("proc_stat_cpu", libc::EINVAL))
    } else {
        Ok(out)
    }
}

fn read_cpu_metadata() -> Result<HashMap<u32, (String, Option<u64>)>, (&'static str, i32)> {
    let body = read_string("/proc/cpuinfo").map_err(|err| ("proc_cpuinfo", err))?;
    let mut out = HashMap::new();
    for block in body.split("\n\n") {
        let mut core = None;
        let mut model = None;
        let mut frequency_mhz = None;
        for line in block.lines() {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            match key.trim() {
                "processor" => {
                    core = Some(
                        value
                            .trim()
                            .parse::<u32>()
                            .map_err(|_| ("proc_cpuinfo", libc::EINVAL))?,
                    )
                }
                "model name" => model = Some(value.trim().to_owned()),
                "cpu MHz" => {
                    let mhz = value
                        .trim()
                        .parse::<f64>()
                        .map_err(|_| ("proc_cpuinfo", libc::EINVAL))?;
                    if !mhz.is_finite() || mhz < 0.0 {
                        return Err(("proc_cpuinfo", libc::EINVAL));
                    }
                    frequency_mhz = (mhz.round() as u64 > 0).then_some(mhz.round() as u64);
                }
                _ => {}
            }
        }
        if let Some(core) = core {
            let model = model
                .filter(|value| !value.is_empty())
                .ok_or(("proc_cpuinfo", libc::EINVAL))?;
            out.insert(core, (model, frequency_mhz));
        }
    }
    if out.is_empty() {
        Err(("proc_cpuinfo", libc::EINVAL))
    } else {
        Ok(out)
    }
}
fn read_networks() -> Result<Vec<Network>, i32> {
    let s = read_string("/proc/net/dev")?;
    let mut out = Vec::new();
    for line in s.lines().skip(2) {
        let Some((name, vals)) = line.split_once(':') else {
            continue;
        };
        let f: Vec<_> = vals.split_whitespace().collect();
        if f.len() < 9 {
            continue;
        }
        let (Ok(rx), Ok(tx)) = (f[0].parse(), f[8].parse()) else {
            continue;
        };
        out.push(Network {
            name: sanitize_name(name.trim()),
            rx_bytes: rx,
            tx_bytes: tx,
        })
    }
    // Emptiness is not this reader's to judge — `host` reads it as blindness.
    Ok(out)
}
fn read_root_disk() -> Result<Disk, i32> {
    let path = CString::new("/").unwrap();
    let mut st = unsafe { std::mem::zeroed::<libc::statvfs>() };
    if unsafe { libc::statvfs(path.as_ptr(), &raw mut st) } != 0 {
        return Err(last_errno());
    }
    let block = st.f_frsize as u64;
    Ok(Disk {
        mount: "/".into(),
        total_bytes: (st.f_blocks as u64).saturating_mul(block),
        available_bytes: (st.f_bavail as u64).saturating_mul(block),
        free_bytes: (st.f_bfree as u64).saturating_mul(block),
    })
}

fn read_string(path: &str) -> Result<String, i32> {
    let mut file = fs::File::open(path).map_err(|err| raw_errno(&err))?;
    let mut body = String::with_capacity(4096);
    file.read_to_string(&mut body)
        .map_err(|err| raw_errno(&err))?;
    Ok(body)
}
fn read_bytes(path: &str) -> Result<Vec<u8>, i32> {
    let mut file = fs::File::open(path).map_err(|err| raw_errno(&err))?;
    let mut body = Vec::with_capacity(4096);
    file.read_to_end(&mut body).map_err(|err| raw_errno(&err))?;
    Ok(body)
}
fn read_dir_names(path: &str) -> Result<Vec<String>, i32> {
    // Every entry is propagated, not flattened away: a dropped fd entry is a
    // listener this scan never sees, reported as a complete walk.
    let rd = fs::read_dir(path).map_err(|e| raw_errno(&e))?;
    rd.map(|entry| {
        entry
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .map_err(|e| raw_errno(&e))
    })
    .collect()
}
fn raw_errno(e: &io::Error) -> i32 {
    e.raw_os_error().unwrap_or(libc::EIO)
}
fn last_errno() -> i32 {
    io::Error::last_os_error()
        .raw_os_error()
        .unwrap_or(libc::EIO)
}
