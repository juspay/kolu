//! Linux readers. OS failures stay typed: per-pid failures become `U`, global
//! requested-source failures become `E` and a non-zero command exit.

use crate::cli::{HostArgs, Scope, SnapshotArgs};
use osfacts::{
    decode_proc_hex, errno_name, hex_bytes, sanitize_name, Attribution, Cpu, Disk, HostMemory,
    HostSnapshot, Load, Memory, Network, Port, Proc, ProcessArgv, ProcessCpuTime, ProcessCwd,
    ProcessStatus, ProcessUid, Snapshot, SourceError, StartTime, Swap, Unreadable,
};
use std::collections::{HashMap, HashSet};
use std::ffi::CString;
use std::fs;
use std::io;
use std::path::Path;

const TCP_LISTEN: &str = "0A";

pub fn snapshot(args: &SnapshotArgs) -> Snapshot {
    let mut snap = Snapshot::new();
    let pids = collect_pids(&args.scope, &mut snap);
    let boot_us = if args.start_time {
        match boot_time_us() {
            Ok(value) => Some(value),
            Err(err) => {
                snap.errors.push(source_error("proc_stat_btime", err));
                None
            }
        }
    } else {
        None
    };
    let cpu_hz = if args.cpu_time {
        match clock_ticks() {
            Ok(value) => Some(value),
            Err(err) => {
                snap.errors.push(source_error("sysconf_clk_tck", err));
                None
            }
        }
    } else {
        None
    };

    for &pid in &pids {
        if args.procs {
            match read_proc(pid) {
                Ok(row) => snap.procs.push(Proc {
                    pid,
                    ppid: row.ppid,
                    name: row.name,
                }),
                Err(err) => push_unreadable(&mut snap, pid, "proc", err),
            }
        }
        if args.mem {
            match read_rss(pid) {
                Ok(rss_bytes) => snap.memory.push(Memory { pid, rss_bytes }),
                Err(err) => push_unreadable(&mut snap, pid, "mem", err),
            }
        }
        if let Some(boot_us) = boot_us {
            match read_start_time(pid, boot_us) {
                Ok(start_unix_us) => snap.start_times.push(StartTime { pid, start_unix_us }),
                Err(err) => push_unreadable(&mut snap, pid, "start_time", err),
            }
        }
        if let Some(cpu_hz) = cpu_hz {
            match read_cpu_time(pid, cpu_hz) {
                Ok(cpu_time_us) => snap.cpu_times.push(ProcessCpuTime { pid, cpu_time_us }),
                Err(err) => push_unreadable(&mut snap, pid, "cpu_time", err),
            }
        }
        if args.uid {
            match read_uid(pid) {
                Ok(uid) => snap.uids.push(ProcessUid { pid, uid }),
                Err(err) => push_unreadable(&mut snap, pid, "uid", err),
            }
        }
        if args.cwd {
            match read_cwd(pid) {
                Ok(cwd) => snap.cwds.push(ProcessCwd { pid, cwd }),
                Err(err) => push_unreadable(&mut snap, pid, "cwd", err),
            }
        }
        if args.status {
            match read_status(pid) {
                Ok((state, nice, threads)) => snap.statuses.push(ProcessStatus {
                    pid,
                    state,
                    nice,
                    threads: Some(threads),
                }),
                Err(err) => push_unreadable(&mut snap, pid, "status", err),
            }
        }
        if args.argv {
            match read_argv(pid) {
                Ok(argv) => snap.argv.push(ProcessArgv { pid, argv }),
                Err(err) => push_unreadable(&mut snap, pid, "argv", err),
            }
        }
    }

    if args.ports {
        match load_listeners() {
            Ok(listeners) => {
                let mut claims = HashMap::<u64, u32>::new();
                for &pid in &pids {
                    match socket_inodes(pid) {
                        Ok(inodes) => {
                            for inode in inodes {
                                claims.entry(inode).or_insert(pid);
                            }
                        }
                        Err(err) => push_unreadable(&mut snap, pid, "ports", err),
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
            Err((source, err)) => snap.errors.push(source_error(source, err)),
        }
    }

    snap.procs.sort_by_key(|row| row.pid);
    snap.memory.sort_by_key(|row| row.pid);
    snap.start_times.sort_by_key(|row| row.pid);
    snap.cpu_times.sort_by_key(|row| row.pid);
    snap.uids.sort_by_key(|row| row.pid);
    snap.cwds.sort_by_key(|row| row.pid);
    snap.statuses.sort_by_key(|row| row.pid);
    snap.argv.sort_by_key(|row| row.pid);
    snap.ports.sort_by_key(|row| {
        let pid = match row.attribution {
            Attribution::Claimed { pid } => pid,
            Attribution::Unclaimed => u32::MAX,
        };
        (row.port, pid)
    });
    snap.unreadable
        .sort_by_key(|row| (row.pid, row.facet.clone()));
    snap
}

pub fn host(args: &HostArgs) -> HostSnapshot {
    let mut out = HostSnapshot::new();
    match uptime_us() {
        Ok(v) => out.uptime_us = v,
        Err(e) => out.errors.push(source_error("proc_uptime", e)),
    }
    if args.load {
        match read_load() {
            Ok(v) => out.load = Some(v),
            Err(e) => out.errors.push(source_error("proc_loadavg", e)),
        }
    }
    if args.mem {
        match read_host_memory() {
            Ok((m, s)) => {
                out.memory = Some(m);
                out.swap = Some(s)
            }
            Err(e) => out.errors.push(source_error("proc_meminfo", e)),
        }
    }
    if args.cpu {
        match read_cpus() {
            Ok(v) => out.cpus = v,
            Err((source, e)) => out.errors.push(source_error(source, e)),
        }
    }
    if args.net {
        match read_networks() {
            Ok(v) => out.networks = v,
            Err(e) => out.errors.push(source_error("proc_net_dev", e)),
        }
    }
    if args.disk {
        match read_root_disk() {
            Ok(v) => out.disks.push(v),
            Err(e) => out.errors.push(source_error("statvfs_root", e)),
        }
    }
    out
}

fn collect_pids(scope: &Scope, snap: &mut Snapshot) -> Vec<u32> {
    match scope {
        Scope::Host => host_pids(),
        Scope::Pids(list) => list.clone(),
        Scope::Roots(roots) => {
            let mut seen = HashSet::new();
            let mut out = Vec::new();
            for &root in roots {
                if !seen.insert(root) {
                    continue;
                }
                if !Path::new(&format!("/proc/{root}")).exists() {
                    push_unreadable(snap, root, "proc", libc::ENOENT);
                    continue;
                }
                out.push(root);
                descend(root, &mut seen, &mut out);
            }
            out
        }
    }
}

fn host_pids() -> Vec<u32> {
    let mut p = Vec::new();
    if let Ok(rd) = fs::read_dir("/proc") {
        for e in rd.flatten() {
            if let Ok(pid) = e.file_name().to_string_lossy().parse() {
                p.push(pid)
            }
        }
    }
    p.sort_unstable();
    p
}
fn descend(root: u32, seen: &mut HashSet<u32>, out: &mut Vec<u32>) {
    let mut q = vec![root];
    while let Some(pid) = q.pop() {
        for child in children_of(pid) {
            if seen.insert(child) {
                out.push(child);
                q.push(child)
            }
        }
    }
}
fn children_of(pid: u32) -> Vec<u32> {
    let mut out = Vec::new();
    if let Ok(tasks) = fs::read_dir(format!("/proc/{pid}/task")) {
        for task in tasks.flatten() {
            if let Ok(body) = fs::read_to_string(format!(
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
    }
    out
}

struct ProcRow {
    ppid: u32,
    name: String,
}
fn read_proc(pid: u32) -> Result<ProcRow, i32> {
    let stat = read_string(&format!("/proc/{pid}/stat"))?;
    let ppid = parse_stat_field(&stat, 1)?
        .parse()
        .map_err(|_| libc::EINVAL)?;
    Ok(ProcRow {
        ppid,
        name: process_name(pid, &stat),
    })
}
fn process_name(pid: u32, stat: &str) -> String {
    if let Ok(cmdline) = fs::read(format!("/proc/{pid}/cmdline")) {
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
/// `after_comm_index`: 0=state, 1=ppid, …, 19=starttime.
fn parse_stat_field(stat: &str, after_comm_index: usize) -> Result<&str, i32> {
    let close = stat.rfind(')').ok_or(libc::EINVAL)?;
    stat[close + 1..]
        .split_whitespace()
        .nth(after_comm_index)
        .ok_or(libc::EINVAL)
}
fn read_rss(pid: u32) -> Result<u64, i32> {
    let body = read_string(&format!("/proc/{pid}/statm"))?;
    let pages = body
        .split_whitespace()
        .nth(1)
        .ok_or(libc::EINVAL)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page <= 0 {
        return Err(libc::EIO);
    }
    pages.checked_mul(page as u64).ok_or(libc::EOVERFLOW)
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
fn read_start_time(pid: u32, boot_us: u64) -> Result<u64, i32> {
    let stat = read_string(&format!("/proc/{pid}/stat"))?;
    let ticks = parse_stat_field(&stat, 19)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    Ok(boot_us + ticks.saturating_mul(1_000_000) / clock_ticks()?)
}

fn read_cpu_time(pid: u32, hz: u64) -> Result<u64, i32> {
    let stat = read_string(&format!("/proc/{pid}/stat"))?;
    let user = parse_stat_field(&stat, 11)?
        .parse::<u64>()
        .map_err(|_| libc::EINVAL)?;
    let system = parse_stat_field(&stat, 12)?
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

fn read_status(pid: u32) -> Result<(char, i32, u32), i32> {
    let stat = read_string(&format!("/proc/{pid}/stat"))?;
    let state = parse_stat_field(&stat, 0)?
        .chars()
        .next()
        .ok_or(libc::EINVAL)?;
    let nice = parse_stat_field(&stat, 16)?
        .parse()
        .map_err(|_| libc::EINVAL)?;
    let threads = parse_stat_field(&stat, 17)?
        .parse()
        .map_err(|_| libc::EINVAL)?;
    Ok((state, nice, threads))
}

fn read_argv(pid: u32) -> Result<Vec<String>, i32> {
    let bytes = fs::read(format!("/proc/{pid}/cmdline")).map_err(|err| raw_errno(&err))?;
    Ok(bytes
        .split(|byte| *byte == 0)
        .filter(|arg| !arg.is_empty())
        .map(|arg| String::from_utf8_lossy(arg).into_owned())
        .collect())
}

struct Listener {
    inode: u64,
    uid: u32,
    port: u16,
    addr: Vec<u8>,
}
fn load_listeners() -> Result<Vec<Listener>, (&'static str, i32)> {
    let mut out = Vec::new();
    let tcp = fs::read_to_string("/proc/net/tcp").map_err(|e| ("proc_net_tcp", raw_errno(&e)))?;
    parse_proc_net(&tcp, &mut out).map_err(|e| ("proc_net_tcp", raw_errno(&e)))?;
    match fs::read_to_string("/proc/net/tcp6") {
        Ok(body) => {
            parse_proc_net(&body, &mut out).map_err(|e| ("proc_net_tcp6", raw_errno(&e)))?
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(("proc_net_tcp6", raw_errno(&e))),
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

fn push_unreadable(s: &mut Snapshot, pid: u32, facet: &str, err: i32) {
    if !s
        .unreadable
        .iter()
        .any(|u| u.pid == pid && u.facet == facet)
    {
        s.unreadable.push(Unreadable {
            pid,
            facet: facet.into(),
            errno: errno_name(err),
        })
    }
}
fn source_error(source: &str, err: i32) -> SourceError {
    SourceError {
        source: source.into(),
        code: errno_name(err),
    }
}
fn read_string(path: &str) -> Result<String, i32> {
    fs::read_to_string(path).map_err(|e| raw_errno(&e))
}
fn read_dir_names(path: &str) -> Result<Vec<String>, i32> {
    fs::read_dir(path)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .map_err(|e| raw_errno(&e))
}
fn raw_errno(e: &io::Error) -> i32 {
    e.raw_os_error().unwrap_or(libc::EIO)
}
fn last_errno() -> i32 {
    io::Error::last_os_error()
        .raw_os_error()
        .unwrap_or(libc::EIO)
}
