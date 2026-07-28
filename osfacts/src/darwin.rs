//! Darwin readers. `kern.proc.all` supplies the unprivileged process table,
//! `proc_*` supplies protected task/path/fd facts, and
//! `net.inet.tcp.pcblist_n` is the independent, host-wide listener truth.

#![cfg(target_os = "macos")]

use crate::cli::{HostArgs, Scope, SnapshotArgs};
use osfacts::{
    errno_name, hex_bytes, sanitize_name, slot_from_vflag, AddressSlot, Attribution, Cpu, Disk,
    HostMemory, HostSnapshot, Load, Memory, Network, Port, Proc, ProcessArgv, ProcessCpuTime,
    ProcessCwd, ProcessStatus, ProcessUid, Snapshot, SourceError, StartTime, Swap, Unreadable,
};
use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, CString};
use std::mem;
use std::os::raw::{c_int, c_uint, c_void};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const PROC_PIDTASKINFO: c_int = 4;
const PROC_PIDVNODEPATHINFO: c_int = 9;
const PROC_PIDLISTFDS: c_int = 1;
const PROC_PIDPATHINFO_MAXSIZE: usize = 4 * 1024;
const PROC_PIDFDSOCKETINFO: c_int = 3;
const PROX_FDTYPE_SOCKET: u32 = 2;
const SOCKINFO_TCP: c_int = 2;
const TSI_S_LISTEN: c_int = 1;
const XSO_INPCB: u32 = 0x010;
const XSO_TCPCB: u32 = 0x020;
const INP_IPV6: u8 = 0x2;
const PROCESSOR_CPU_LOAD_INFO: c_int = 2;
const PROC_VNODEPATHINFO_SIZE: usize = 2_352;
const VNODE_CDIR_PATH_OFFSET: usize = 152;
const MAXPATHLEN: usize = 1_024;
const CTL_KERN: c_int = 1;
const KERN_PROCARGS2: c_int = 49;
const KINFO_PROC_SIZE: usize = 648;
const KINFO_START_SEC_OFFSET: usize = 0;
const KINFO_START_USEC_OFFSET: usize = 8;
const KINFO_STATUS_OFFSET: usize = 36;
const KINFO_PID_OFFSET: usize = 40;
const KINFO_NICE_OFFSET: usize = 242;
const KINFO_COMM_OFFSET: usize = 243;
const KINFO_COMM_SIZE: usize = 17;
const KINFO_RUID_OFFSET: usize = 392;
const KINFO_PPID_OFFSET: usize = 560;

// Apple XNU declares `xinpcb_n` under `#pragma pack(4)`. Keep these offsets
// beside the decoder: lport follows xi_inpp + fport, while vflag and the local
// 16-byte address follow the generation/flags/flow prefix. The corresponding
// `xtcpcb_n` state follows t_segq, dupacks, and four timers.
const XINPCB_LPORT_OFFSET: usize = 18;
const XINPCB_VFLAG_OFFSET: usize = 44;
const XINPCB_LADDR_OFFSET: usize = 64;
const XTCPCB_STATE_OFFSET: usize = 36;

#[repr(C)]
struct ProcTaskInfo {
    _pti_virtual_size: u64,
    pti_resident_size: u64,
    pti_total_user: u64,
    pti_total_system: u64,
    _pti_threads_user: u64,
    _pti_threads_system: u64,
    _pti_policy: i32,
    _pti_faults: i32,
    _pti_pageins: i32,
    _pti_cow_faults: i32,
    _pti_messages_sent: i32,
    _pti_messages_received: i32,
    _pti_syscalls_mach: i32,
    _pti_syscalls_unix: i32,
    _pti_csw: i32,
    pti_threadnum: i32,
    _pti_numrunning: i32,
    _pti_priority: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ProcFdInfo {
    proc_fd: i32,
    proc_fdtype: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct In4In6Addr {
    i46a_pad32: [u32; 3],
    i46a_addr4: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
union InSockAddr {
    ina_46: In4In6Addr,
    ina_6: [u8; 16],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct InSockInfo {
    insi_fport: c_int,
    insi_lport: c_int,
    insi_gencnt: u64,
    insi_flags: u32,
    insi_flow: u32,
    insi_vflag: u8,
    insi_ip_ttl: u8,
    _pad: u16,
    rfu_1: u32,
    insi_faddr: InSockAddr,
    insi_laddr: InSockAddr,
    _tail: [u8; 16],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct TcpSockInfo {
    tcpsi_ini: InSockInfo,
    tcpsi_state: c_int,
    _rest: [u8; 36],
}

#[repr(C)]
#[derive(Clone, Copy)]
union SocketInfoProto {
    pri_tcp: TcpSockInfo,
    _pad: [u8; 528],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SocketInfo {
    _soi_stat: [u8; 136],
    _soi_so: u64,
    _soi_pcb: u64,
    _soi_type: c_int,
    _soi_protocol: c_int,
    soi_family: c_int,
    _soi_options: i16,
    _soi_linger: i16,
    _soi_state: i16,
    _soi_qlen: i16,
    _soi_incqlen: i16,
    _soi_qlimit: i16,
    _soi_timeo: i16,
    _soi_error: u16,
    _soi_oobmark: u32,
    _soi_rcv: [u8; 24],
    _soi_snd: [u8; 24],
    soi_kind: c_int,
    _rfu_1: u32,
    soi_proto: SocketInfoProto,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SocketFdInfo {
    _pfi: [u8; 24],
    psi: SocketInfo,
}

const _: () = assert!(mem::size_of::<ProcFdInfo>() == 8);
const _: () = assert!(mem::size_of::<InSockInfo>() == 80);
const _: () = assert!(mem::size_of::<TcpSockInfo>() == 120);
const _: () = assert!(mem::size_of::<SocketInfo>() == 768);
const _: () = assert!(mem::size_of::<SocketFdInfo>() == 792);
const _: () = assert!(mem::size_of::<ProcTaskInfo>() == 96);

extern "C" {
    fn proc_pidinfo(
        pid: c_int,
        flavor: c_int,
        arg: u64,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
    fn proc_pidpath(pid: c_int, buffer: *mut c_void, buffersize: u32) -> c_int;
    fn proc_pidfdinfo(
        pid: c_int,
        fd: c_int,
        flavor: c_int,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
    fn getloadavg(loadavg: *mut f64, nelem: c_int) -> c_int;
    fn host_processor_info(
        host: c_uint,
        flavor: c_int,
        count: *mut c_uint,
        info: *mut *mut c_int,
        info_count: *mut c_uint,
    ) -> c_int;
    fn mach_host_self() -> c_uint;
}

pub fn snapshot(args: &SnapshotArgs) -> Snapshot {
    let mut snap = Snapshot::new();
    let timebase = args.cpu_time.then(read_mach_timebase);
    let process_table = match read_process_table() {
        Ok(rows) => rows,
        Err(err) => {
            snap.errors.push(source_error("kern_proc_all", err));
            return snap;
        }
    };
    let wanted = select_pids(&args.scope, &process_table, &mut snap);

    for &pid in &wanted {
        let bsd = if args.procs || args.start_time || args.uid || args.status {
            Some(process_table.get(&pid).cloned().ok_or(libc::ESRCH))
        } else {
            None
        };
        if args.procs {
            match bsd.as_ref().expect("bsd requested") {
                Ok(row) => snap.procs.push(Proc {
                    pid,
                    ppid: row.ppid,
                    name: process_name(pid, &row.name),
                }),
                Err(err) => push_unreadable(&mut snap, pid, "proc", *err),
            }
        }
        let task = if args.mem || args.cpu_time || args.status {
            Some(read_task(pid))
        } else {
            None
        };
        if args.mem {
            match task.as_ref().expect("task requested") {
                Ok(row) => snap.memory.push(Memory {
                    pid,
                    rss_bytes: row.pti_resident_size,
                }),
                Err(err) => push_unreadable(&mut snap, pid, "mem", *err),
            }
        }
        if args.start_time {
            match bsd.as_ref().expect("bsd requested") {
                Ok(row) => snap.start_times.push(StartTime {
                    pid,
                    start_unix_us: row.start_unix_us,
                }),
                Err(err) => push_unreadable(&mut snap, pid, "start_time", *err),
            }
        }
        if args.cpu_time {
            match (
                task.as_ref().expect("task requested"),
                timebase.as_ref().expect("timebase requested"),
            ) {
                (Ok(row), Ok(timebase)) => snap.cpu_times.push(ProcessCpuTime {
                    pid,
                    cpu_time_us: mach_ticks_to_us(
                        row.pti_total_user,
                        row.pti_total_system,
                        *timebase,
                    ),
                }),
                (Err(err), _) | (_, Err(err)) => push_unreadable(&mut snap, pid, "cpu_time", *err),
            }
        }
        if args.uid {
            match bsd.as_ref().expect("bsd requested") {
                Ok(row) => snap.uids.push(ProcessUid { pid, uid: row.uid }),
                Err(err) => push_unreadable(&mut snap, pid, "uid", *err),
            }
        }
        if args.cwd {
            match read_cwd(pid) {
                Ok(cwd) => snap.cwds.push(ProcessCwd { pid, cwd }),
                Err(err) => push_unreadable(&mut snap, pid, "cwd", err),
            }
        }
        if args.status {
            match bsd.as_ref().expect("bsd requested") {
                Ok(row) => match darwin_state(row.status) {
                    Ok(state) => snap.statuses.push(ProcessStatus {
                        pid,
                        state,
                        nice: row.nice,
                        threads: task
                            .as_ref()
                            .and_then(|result| result.as_ref().ok())
                            .and_then(|task| {
                                (task.pti_threadnum > 0).then_some(task.pti_threadnum as u32)
                            }),
                    }),
                    Err(err) => push_unreadable(&mut snap, pid, "status", err),
                },
                Err(err) => push_unreadable(&mut snap, pid, "status", *err),
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
        let mut claims = HashMap::<(u16, String), Vec<u32>>::new();
        for &pid in &wanted {
            match listener_claims(pid) {
                Ok(rows) => {
                    for (port, address) in rows {
                        claims.entry((port, address)).or_default().push(pid);
                    }
                }
                Err(err) => push_unreadable(&mut snap, pid, "ports", err),
            }
        }
        match host_listeners() {
            Ok(rows) => {
                let host_table_blind = rows.is_empty();
                snap.ports = attribute_host_listeners(rows, &claims);
                if host_table_blind {
                    snap.errors.push(SourceError {
                        source: "darwin_tcp_pcblist".into(),
                        code: "BLIND_OR_EMPTY".into(),
                    });
                }
            }
            Err(err) => snap.errors.push(source_error("darwin_tcp_pcblist", err)),
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
    snap.ports.sort_by_key(|row| row.port);
    snap.unreadable
        .sort_by_key(|row| (row.pid, row.facet.clone()));
    snap
}

pub fn host(args: &HostArgs) -> HostSnapshot {
    let mut out = HostSnapshot::new();
    match uptime_us() {
        Ok(value) => out.uptime_us = value,
        Err(err) => out.errors.push(source_error("kern_boottime", err)),
    }
    if args.load {
        match read_load() {
            Ok(value) => out.load = Some(value),
            Err(err) => out.errors.push(source_error("getloadavg", err)),
        }
    }
    if args.mem {
        match read_host_memory() {
            Ok((memory, swap)) => {
                out.memory = Some(memory);
                out.swap = Some(swap);
            }
            Err((source, err)) => out.errors.push(source_error(source, err)),
        }
    }
    if args.cpu {
        match read_cpus() {
            Ok(value) => out.cpus = value,
            Err((source, err)) => out.errors.push(source_error(source, err)),
        }
    }
    if args.net {
        match read_networks() {
            Ok(value) => out.networks = value,
            Err(err) => out.errors.push(source_error("getifaddrs", err)),
        }
    }
    if args.disk {
        match read_root_disk() {
            Ok(value) => out.disks.push(value),
            Err(err) => out.errors.push(source_error("statvfs_root", err)),
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct BsdRow {
    ppid: u32,
    name: String,
    start_unix_us: u64,
    uid: u32,
    status: u32,
    nice: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MachTimebase {
    numer: u32,
    denom: u32,
}

fn read_mach_timebase() -> Result<MachTimebase, i32> {
    unsafe {
        let mut info = libc::mach_timebase_info { numer: 0, denom: 0 };
        if libc::mach_timebase_info(&mut info) != libc::KERN_SUCCESS || info.denom == 0 {
            return Err(libc::EIO);
        }
        Ok(MachTimebase {
            numer: info.numer,
            denom: info.denom,
        })
    }
}

fn mach_ticks_to_us(user: u64, system: u64, timebase: MachTimebase) -> u64 {
    let ticks = u128::from(user).saturating_add(u128::from(system));
    let nanoseconds = ticks.saturating_mul(u128::from(timebase.numer)) / u128::from(timebase.denom);
    u64::try_from(nanoseconds / 1_000).unwrap_or(u64::MAX)
}

fn select_pids(
    scope: &Scope,
    process_table: &HashMap<u32, BsdRow>,
    snap: &mut Snapshot,
) -> Vec<u32> {
    match scope {
        Scope::Host => {
            let mut pids = process_table.keys().copied().collect::<Vec<_>>();
            pids.sort_unstable();
            pids
        }
        Scope::Pids(pids) => pids.clone(),
        Scope::Roots(roots) => subtree(roots, process_table, snap),
    }
}

fn subtree(roots: &[u32], process_table: &HashMap<u32, BsdRow>, snap: &mut Snapshot) -> Vec<u32> {
    let mut children = HashMap::<u32, Vec<u32>>::new();
    for (&pid, row) in process_table {
        children.entry(row.ppid).or_default().push(pid);
    }
    let mut seen = HashSet::new();
    let mut queue = Vec::new();
    for &root in roots {
        if !process_table.contains_key(&root) {
            push_unreadable(snap, root, "proc", libc::ESRCH);
            continue;
        }
        if seen.insert(root) {
            queue.push(root);
        }
    }
    let mut cursor = 0;
    while cursor < queue.len() {
        if let Some(kids) = children.get(&queue[cursor]) {
            for &child in kids {
                if seen.insert(child) {
                    queue.push(child);
                }
            }
        }
        cursor += 1;
    }
    queue
}

fn read_process_table() -> Result<HashMap<u32, BsdRow>, i32> {
    decode_process_table(&kern_proc_all()?)
}

fn kern_proc_all() -> Result<Vec<u8>, i32> {
    unsafe {
        let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_ALL];
        for _ in 0..3 {
            let mut len = 0;
            if libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as c_uint,
                std::ptr::null_mut(),
                &mut len,
                std::ptr::null_mut(),
                0,
            ) != 0
            {
                return Err(errno());
            }
            len = len.saturating_add(16 * KINFO_PROC_SIZE);
            let mut bytes = vec![0u8; len];
            if libc::sysctl(
                mib.as_mut_ptr(),
                mib.len() as c_uint,
                bytes.as_mut_ptr().cast(),
                &mut len,
                std::ptr::null_mut(),
                0,
            ) == 0
            {
                bytes.truncate(len);
                return Ok(bytes);
            }
            if errno() != libc::ENOMEM {
                return Err(errno());
            }
        }
        Err(libc::ENOMEM)
    }
}

fn decode_process_table(bytes: &[u8]) -> Result<HashMap<u32, BsdRow>, i32> {
    if !bytes.len().is_multiple_of(KINFO_PROC_SIZE) {
        return Err(libc::EINVAL);
    }
    let mut rows = HashMap::new();
    for raw in bytes.chunks_exact(KINFO_PROC_SIZE) {
        let Some((pid, row)) = decode_kinfo_proc(raw)? else {
            continue;
        };
        if rows.insert(pid, row).is_some() {
            return Err(libc::EINVAL);
        }
    }
    Ok(rows)
}

fn decode_kinfo_proc(bytes: &[u8]) -> Result<Option<(u32, BsdRow)>, i32> {
    if bytes.len() != KINFO_PROC_SIZE {
        return Err(libc::EINVAL);
    }
    let pid = read_i32(bytes, KINFO_PID_OFFSET)?;
    if pid == 0 {
        return Ok(None);
    }
    if pid < 0 {
        return Err(libc::EINVAL);
    }
    let ppid = read_i32(bytes, KINFO_PPID_OFFSET)?;
    let start_sec = read_i64(bytes, KINFO_START_SEC_OFFSET)?;
    let start_usec = read_i32(bytes, KINFO_START_USEC_OFFSET)?;
    if ppid < 0 || start_sec < 0 || !(0..1_000_000).contains(&start_usec) {
        return Err(libc::EINVAL);
    }
    let comm = cstr_field(&bytes[KINFO_COMM_OFFSET..KINFO_COMM_OFFSET + KINFO_COMM_SIZE])
        .ok_or(libc::EINVAL)?;
    Ok(Some((
        pid as u32,
        BsdRow {
            ppid: ppid as u32,
            name: sanitize_name(&comm),
            start_unix_us: (start_sec as u64)
                .saturating_mul(1_000_000)
                .saturating_add(start_usec as u64),
            uid: read_u32(bytes, KINFO_RUID_OFFSET)?,
            status: u32::from(bytes[KINFO_STATUS_OFFSET]),
            nice: i32::from(bytes[KINFO_NICE_OFFSET] as i8),
        },
    )))
}

fn process_name(pid: u32, comm: &str) -> String {
    path_basename(pid)
        .map(|name| sanitize_name(&name))
        .unwrap_or_else(|| comm.to_owned())
}

fn darwin_state(status: u32) -> Result<char, i32> {
    match status {
        1 => Ok('I'),
        2 => Ok('R'),
        3 => Ok('S'),
        4 => Ok('T'),
        5 => Ok('Z'),
        _ => Err(libc::EINVAL),
    }
}

fn read_cwd(pid: u32) -> Result<String, i32> {
    unsafe {
        let mut bytes = [0u8; PROC_VNODEPATHINFO_SIZE];
        let count = proc_pidinfo(
            pid as c_int,
            PROC_PIDVNODEPATHINFO,
            0,
            bytes.as_mut_ptr().cast(),
            bytes.len() as c_int,
        );
        if count < bytes.len() as c_int {
            return Err(errno());
        }
        let path = &bytes[VNODE_CDIR_PATH_OFFSET..VNODE_CDIR_PATH_OFFSET + MAXPATHLEN];
        let end = path
            .iter()
            .position(|byte| *byte == 0)
            .ok_or(libc::EINVAL)?;
        if end == 0 {
            return Err(libc::EINVAL);
        }
        Ok(String::from_utf8_lossy(&path[..end]).into_owned())
    }
}

fn read_argv(pid: u32) -> Result<Vec<String>, i32> {
    unsafe {
        let mut mib = [CTL_KERN, KERN_PROCARGS2, pid as c_int];
        let mut len = 0;
        if libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as c_uint,
            std::ptr::null_mut(),
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return Err(errno());
        }
        let mut bytes = vec![0u8; len];
        if libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as c_uint,
            bytes.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return Err(errno());
        }
        bytes.truncate(len);
        parse_procargs2(&bytes)
    }
}

fn parse_procargs2(bytes: &[u8]) -> Result<Vec<String>, i32> {
    let argc = bytes
        .get(..4)
        .and_then(|raw| raw.try_into().ok())
        .map(i32::from_ne_bytes)
        .filter(|argc| *argc >= 0)
        .ok_or(libc::EINVAL)? as usize;
    let mut cursor = 4;
    cursor += bytes[cursor..]
        .iter()
        .position(|byte| *byte == 0)
        .ok_or(libc::EINVAL)?;
    while cursor < bytes.len() && bytes[cursor] == 0 {
        cursor += 1;
    }
    let mut out = Vec::with_capacity(argc);
    while out.len() < argc {
        let rest = bytes.get(cursor..).ok_or(libc::EINVAL)?;
        let end = rest
            .iter()
            .position(|byte| *byte == 0)
            .ok_or(libc::EINVAL)?;
        out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        cursor = cursor.saturating_add(end + 1);
    }
    Ok(out)
}

fn read_task(pid: u32) -> Result<ProcTaskInfo, i32> {
    unsafe {
        let mut task = mem::zeroed::<ProcTaskInfo>();
        let n = proc_pidinfo(
            pid as c_int,
            PROC_PIDTASKINFO,
            0,
            (&raw mut task).cast(),
            mem::size_of::<ProcTaskInfo>() as c_int,
        );
        if n < mem::size_of::<ProcTaskInfo>() as c_int {
            return Err(errno());
        }
        Ok(task)
    }
}

fn path_basename(pid: u32) -> Option<String> {
    unsafe {
        let mut buf = [0u8; PROC_PIDPATHINFO_MAXSIZE];
        let n = proc_pidpath(pid as c_int, buf.as_mut_ptr().cast(), buf.len() as u32);
        if n <= 0 {
            return None;
        }
        let path = CStr::from_ptr(buf.as_ptr().cast()).to_string_lossy();
        Path::new(path.as_ref())
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
    }
}

fn cstr_field(buf: &[u8]) -> Option<String> {
    let end = buf.iter().position(|&byte| byte == 0).unwrap_or(buf.len());
    (end != 0).then(|| String::from_utf8_lossy(&buf[..end]).into_owned())
}

fn listener_claims(pid: u32) -> Result<Vec<(u16, String)>, i32> {
    unsafe {
        *libc::__error() = 0;
        let size = proc_pidinfo(pid as c_int, PROC_PIDLISTFDS, 0, std::ptr::null_mut(), 0);
        if size <= 0 {
            let err = errno();
            return if err == 0 { Ok(Vec::new()) } else { Err(err) };
        }
        let size = size + 32 * mem::size_of::<ProcFdInfo>() as c_int;
        let mut fds =
            vec![mem::zeroed::<ProcFdInfo>(); size as usize / mem::size_of::<ProcFdInfo>()];
        *libc::__error() = 0;
        let used = proc_pidinfo(
            pid as c_int,
            PROC_PIDLISTFDS,
            0,
            fds.as_mut_ptr().cast(),
            size,
        );
        if used <= 0 {
            let err = errno();
            return if err == 0 { Ok(Vec::new()) } else { Err(err) };
        }
        let mut out = Vec::new();
        for fd in &fds[..used as usize / mem::size_of::<ProcFdInfo>()] {
            if fd.proc_fdtype != PROX_FDTYPE_SOCKET {
                continue;
            }
            let mut socket = mem::zeroed::<SocketFdInfo>();
            let got = proc_pidfdinfo(
                pid as c_int,
                fd.proc_fd,
                PROC_PIDFDSOCKETINFO,
                (&raw mut socket).cast(),
                mem::size_of::<SocketFdInfo>() as c_int,
            );
            if got < mem::size_of::<SocketFdInfo>() as c_int || socket.psi.soi_kind != SOCKINFO_TCP
            {
                continue;
            }
            let tcp = socket.psi.soi_proto.pri_tcp;
            if tcp.tcpsi_state != TSI_S_LISTEN {
                continue;
            }
            let port = u16::from_be(tcp.tcpsi_ini.insi_lport as u16);
            if port == 0 {
                continue;
            }
            let address = match slot_from_vflag(socket.psi.soi_family, tcp.tcpsi_ini.insi_vflag) {
                AddressSlot::V4 => {
                    hex_bytes(&tcp.tcpsi_ini.insi_laddr.ina_46.i46a_addr4.to_ne_bytes())
                }
                AddressSlot::V6 => hex_bytes(&tcp.tcpsi_ini.insi_laddr.ina_6),
            };
            out.push((port, address));
        }
        Ok(out)
    }
}

fn host_listeners() -> Result<Vec<(u16, String)>, i32> {
    let bytes = sysctl_bytes("net.inet.tcp.pcblist_n")?;
    decode_host_listeners(&bytes)
}

fn decode_host_listeners(bytes: &[u8]) -> Result<Vec<(u16, String)>, i32> {
    if bytes.len() < 4 {
        return Ok(Vec::new());
    }
    let header_len = read_u32(&bytes, 0)? as usize;
    let mut offset = round_up_8(header_len);
    let mut pending: Option<(u16, String)> = None;
    let mut out = Vec::new();
    while offset + 8 <= bytes.len() {
        let len = read_u32(&bytes, offset)? as usize;
        if len <= 24 || offset + len > bytes.len() {
            break;
        }
        let kind = read_u32(&bytes, offset + 4)?;
        if kind == XSO_INPCB && len >= 84 {
            let raw_port = u16::from_ne_bytes(
                bytes[offset + XINPCB_LPORT_OFFSET..offset + XINPCB_LPORT_OFFSET + 2]
                    .try_into()
                    .unwrap(),
            );
            let port = u16::from_be(raw_port);
            let vflag = bytes[offset + XINPCB_VFLAG_OFFSET];
            let local = &bytes[offset + XINPCB_LADDR_OFFSET..offset + XINPCB_LADDR_OFFSET + 16];
            let address = if vflag & INP_IPV6 != 0 {
                hex_bytes(local)
            } else {
                hex_bytes(&local[12..16])
            };
            pending = Some((port, address));
        } else if kind == XSO_TCPCB && len >= 40 {
            let state = i32::from_ne_bytes(
                bytes[offset + XTCPCB_STATE_OFFSET..offset + XTCPCB_STATE_OFFSET + 4]
                    .try_into()
                    .unwrap(),
            );
            if state == TSI_S_LISTEN {
                if let Some(row) = pending.take() {
                    if row.0 != 0 {
                        out.push(row);
                    }
                }
            } else {
                pending = None;
            }
        }
        offset = offset.saturating_add(round_up_8(len));
    }
    Ok(out)
}

fn attribute_host_listeners(
    mut rows: Vec<(u16, String)>,
    claims: &HashMap<(u16, String), Vec<u32>>,
) -> Vec<Port> {
    if rows.is_empty() {
        rows.extend(claims.keys().cloned());
        rows.sort();
    }
    rows.into_iter()
        .map(|(port, address)| Port {
            attribution: claims
                .get(&(port, address.clone()))
                .and_then(|pids| pids.first())
                .map_or(Attribution::Unclaimed, |&pid| Attribution::Claimed { pid }),
            uid: None,
            port,
            address,
        })
        .collect()
}

fn read_load() -> Result<Load, i32> {
    unsafe {
        let mut values = [0.0; 3];
        if getloadavg(values.as_mut_ptr(), 3) != 3 {
            return Err(errno());
        }
        Ok(Load {
            one: values[0],
            five: values[1],
            fifteen: values[2],
        })
    }
}

fn read_host_memory() -> Result<(HostMemory, Swap), (&'static str, i32)> {
    let total = sysctl_u64("hw.memsize").map_err(|e| ("hw_memsize", e))?;
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page <= 0 {
        return Err(("sysconf_pagesize", libc::EINVAL));
    }
    let mut stats = unsafe { mem::zeroed::<libc::vm_statistics64>() };
    let mut count = libc::HOST_VM_INFO64_COUNT;
    let status = unsafe {
        libc::host_statistics64(
            mach_host_self(),
            libc::HOST_VM_INFO64,
            (&raw mut stats).cast(),
            &mut count,
        )
    };
    if status != 0 {
        return Err(("host_vm_info64", status));
    }
    // `vm_stat` exposes the same cache-aware classes Drishti used: free,
    // inactive, speculative, and purgeable. XNU's HOST_VM_INFO64 free_count
    // already includes speculative_count, so add it only once here.
    let available_pages = u64::from(stats.free_count)
        .saturating_add(u64::from(stats.inactive_count))
        .saturating_add(u64::from(stats.purgeable_count));
    let swap = sysctl_bytes("vm.swapusage").map_err(|e| ("vm_swapusage", e))?;
    if swap.len() < 24 {
        return Err(("vm_swapusage", libc::EINVAL));
    }
    Ok((
        HostMemory {
            total_bytes: total,
            available_bytes: available_pages.saturating_mul(page as u64),
        },
        Swap {
            total_bytes: u64::from_ne_bytes(swap[0..8].try_into().unwrap()),
            used_bytes: u64::from_ne_bytes(swap[16..24].try_into().unwrap()),
        },
    ))
}

fn uptime_us() -> Result<u64, i32> {
    let boot = sysctl_bytes("kern.boottime")?;
    if boot.len() < 16 {
        return Err(libc::EINVAL);
    }
    let sec = i64::from_ne_bytes(boot[0..8].try_into().unwrap());
    let usec = i64::from_ne_bytes(boot[8..16].try_into().unwrap());
    let boot_us = sec.saturating_mul(1_000_000).saturating_add(usec) as u64;
    let now_us = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| libc::EINVAL)?
        .as_micros() as u64;
    Ok(now_us.saturating_sub(boot_us))
}

fn read_cpus() -> Result<Vec<Cpu>, (&'static str, i32)> {
    let model = sysctl_string("machdep.cpu.brand_string")
        .map_err(|err| ("machdep_cpu_brand_string", err))?;
    if model.is_empty() {
        return Err(("machdep_cpu_brand_string", libc::EINVAL));
    }
    let frequency_mhz = match sysctl_bytes("hw.cpufrequency") {
        Ok(bytes) if bytes.is_empty() => None,
        Ok(bytes) if bytes.len() >= 8 => {
            let hz = u64::from_ne_bytes(bytes[0..8].try_into().unwrap());
            let mhz = hz / 1_000_000;
            (mhz > 0).then_some(mhz)
        }
        Ok(bytes) if bytes.len() >= 4 => {
            let hz = u32::from_ne_bytes(bytes[0..4].try_into().unwrap()) as u64;
            let mhz = hz / 1_000_000;
            (mhz > 0).then_some(mhz)
        }
        Ok(_) => return Err(("hw_cpufrequency", libc::EINVAL)),
        Err(libc::ENOENT) => None,
        Err(err) => return Err(("hw_cpufrequency", err)),
    };
    unsafe {
        let mut cores = 0;
        let mut info = std::ptr::null_mut();
        let mut count = 0;
        let status = host_processor_info(
            mach_host_self(),
            PROCESSOR_CPU_LOAD_INFO,
            &mut cores,
            &mut info,
            &mut count,
        );
        if status != 0 {
            return Err(("host_processor_info", status));
        }
        if info.is_null() {
            return Err(("host_processor_info", libc::EINVAL));
        }
        if count < cores.saturating_mul(4) {
            let _ = libc::vm_deallocate(
                libc::mach_task_self_,
                info as libc::vm_address_t,
                count as libc::vm_size_t * mem::size_of::<c_int>(),
            );
            return Err(("host_processor_info", libc::EINVAL));
        }
        let ticks = std::slice::from_raw_parts(info, count as usize);
        let hz = libc::sysconf(libc::_SC_CLK_TCK);
        if hz <= 0 {
            let _ = libc::vm_deallocate(
                libc::mach_task_self_,
                info as libc::vm_address_t,
                count as libc::vm_size_t * mem::size_of::<c_int>(),
            );
            return Err(("sysconf_clk_tck", libc::EINVAL));
        }
        let to_us = |value: c_int| (value as u64).saturating_mul(1_000_000) / hz as u64;
        let rows = (0..cores as usize)
            .map(|core| {
                let base = core * 4;
                Cpu {
                    core: core as u32,
                    user_us: to_us(ticks[base]),
                    system_us: to_us(ticks[base + 1]),
                    idle_us: to_us(ticks[base + 2]),
                    other_us: to_us(ticks[base + 3]),
                    model: model.clone(),
                    frequency_mhz,
                }
            })
            .collect();
        let status = libc::vm_deallocate(
            libc::mach_task_self_,
            info as libc::vm_address_t,
            count as libc::vm_size_t * mem::size_of::<c_int>(),
        );
        if status == 0 {
            Ok(rows)
        } else {
            Err(("vm_deallocate", status))
        }
    }
}

fn read_networks() -> Result<Vec<Network>, i32> {
    let networks = sysinfo::Networks::new_with_refreshed_list();
    let mut out: Vec<_> = networks
        .iter()
        .map(|(name, data)| Network {
            name: name.clone(),
            rx_bytes: data.total_received(),
            tx_bytes: data.total_transmitted(),
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn read_root_disk() -> Result<Disk, i32> {
    unsafe {
        let path = CString::new("/").expect("literal");
        let mut stat = mem::zeroed::<libc::statvfs>();
        if libc::statvfs(path.as_ptr(), &mut stat) != 0 {
            return Err(errno());
        }
        Ok(Disk {
            mount: "/".into(),
            total_bytes: u64::from(stat.f_blocks).saturating_mul(stat.f_frsize),
            available_bytes: u64::from(stat.f_bavail).saturating_mul(stat.f_frsize),
            free_bytes: u64::from(stat.f_bfree).saturating_mul(stat.f_frsize),
        })
    }
}

fn sysctl_bytes(name: &str) -> Result<Vec<u8>, i32> {
    unsafe {
        let name = CString::new(name).expect("sysctl name");
        let mut len = 0;
        if libc::sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return Err(errno());
        }
        let mut bytes = vec![0u8; len];
        if libc::sysctlbyname(
            name.as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return Err(errno());
        }
        bytes.truncate(len);
        Ok(bytes)
    }
}

fn sysctl_u64(name: &str) -> Result<u64, i32> {
    let bytes = sysctl_bytes(name)?;
    (bytes.len() >= 8)
        .then(|| u64::from_ne_bytes(bytes[0..8].try_into().unwrap()))
        .ok_or(libc::EINVAL)
}

fn sysctl_string(name: &str) -> Result<String, i32> {
    let bytes = sysctl_bytes(name)?;
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8(bytes[..end].to_vec()).map_err(|_| libc::EINVAL)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, i32> {
    bytes
        .get(offset..offset + 4)
        .and_then(|slice| slice.try_into().ok())
        .map(u32::from_ne_bytes)
        .ok_or(libc::EINVAL)
}

fn read_i32(bytes: &[u8], offset: usize) -> Result<i32, i32> {
    bytes
        .get(offset..offset + 4)
        .and_then(|slice| slice.try_into().ok())
        .map(i32::from_ne_bytes)
        .ok_or(libc::EINVAL)
}

fn read_i64(bytes: &[u8], offset: usize) -> Result<i64, i32> {
    bytes
        .get(offset..offset + 8)
        .and_then(|slice| slice.try_into().ok())
        .map(i64::from_ne_bytes)
        .ok_or(libc::EINVAL)
}

fn round_up_8(value: usize) -> usize {
    value.saturating_add(7) & !7
}

fn push_unreadable(snap: &mut Snapshot, pid: u32, facet: &str, err: i32) {
    if !snap
        .unreadable
        .iter()
        .any(|row| row.pid == pid && row.facet == facet)
    {
        snap.unreadable.push(Unreadable {
            pid,
            facet: facet.into(),
            errno: errno_name(err),
        });
    }
}

fn source_error(source: &str, err: i32) -> SourceError {
    SourceError {
        source: source.into(),
        code: errno_name(err),
    }
}

fn errno() -> i32 {
    unsafe { *libc::__error() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinfo_proc_fixture_decodes_public_process_identity() {
        let mut bytes = [0u8; KINFO_PROC_SIZE];
        bytes[KINFO_START_SEC_OFFSET..KINFO_START_SEC_OFFSET + 8]
            .copy_from_slice(&1_700_000_000i64.to_ne_bytes());
        bytes[KINFO_START_USEC_OFFSET..KINFO_START_USEC_OFFSET + 4]
            .copy_from_slice(&123_456i32.to_ne_bytes());
        bytes[KINFO_STATUS_OFFSET] = 3;
        bytes[KINFO_PID_OFFSET..KINFO_PID_OFFSET + 4].copy_from_slice(&4242i32.to_ne_bytes());
        bytes[KINFO_NICE_OFFSET] = (-5i8) as u8;
        bytes[KINFO_COMM_OFFSET..KINFO_COMM_OFFSET + 7].copy_from_slice(b"foreign");
        bytes[KINFO_RUID_OFFSET..KINFO_RUID_OFFSET + 4].copy_from_slice(&501u32.to_ne_bytes());
        bytes[KINFO_PPID_OFFSET..KINFO_PPID_OFFSET + 4].copy_from_slice(&42i32.to_ne_bytes());

        let decoded = decode_kinfo_proc(&bytes).expect("decode");

        assert_eq!(
            decoded,
            Some((
                4242,
                BsdRow {
                    ppid: 42,
                    name: "foreign".into(),
                    start_unix_us: 1_700_000_000_123_456,
                    uid: 501,
                    status: 3,
                    nice: -5,
                }
            ))
        );
    }

    #[test]
    fn subtree_uses_the_host_process_table() {
        let row = |ppid: u32, name: &str| BsdRow {
            ppid,
            name: name.into(),
            start_unix_us: 1,
            uid: 501,
            status: 2,
            nice: 0,
        };
        let process_table = HashMap::from([
            (1, row(0, "root")),
            (2, row(1, "child")),
            (3, row(2, "grandchild")),
        ]);
        let mut snap = Snapshot::new();
        let selected = subtree(&[1], &process_table, &mut snap);

        assert_eq!(selected, vec![1, 2, 3]);
        assert!(snap.unreadable.is_empty());
    }

    #[test]
    fn mach_ticks_use_the_apple_silicon_timebase() {
        assert_eq!(
            mach_ticks_to_us(
                9_000,
                3_000,
                MachTimebase {
                    numer: 125,
                    denom: 3,
                },
            ),
            500
        );
    }

    #[test]
    fn mach_ticks_keep_the_intel_one_to_one_timebase() {
        assert_eq!(
            mach_ticks_to_us(750_000, 250_000, MachTimebase { numer: 1, denom: 1 }),
            1_000
        );
    }

    #[test]
    fn macos_27_platform_pcblist_decodes_every_netstat_listener() {
        let bytes = include_bytes!("../tests/fixtures/darwin/macos27-pcblist-platform.bin");
        let rows = decode_host_listeners(bytes).expect("decode platform-signed capture");

        assert_eq!(bytes.len(), 54_872);
        assert_eq!(rows.len(), 29);
        assert!(rows
            .iter()
            .all(|(port, address)| *port != 0 && !address.is_empty()));
    }

    #[test]
    fn macos_27_adhoc_pcblist_is_the_detectable_empty_shape() {
        let bytes = include_bytes!("../tests/fixtures/darwin/macos27-pcblist-adhoc.bin");
        let rows = decode_host_listeners(bytes).expect("decode ad-hoc capture");

        assert_eq!(bytes.len(), 48);
        assert!(
            rows.is_empty(),
            "the empty table must reach BLIND_OR_EMPTY detection"
        );
    }

    #[test]
    fn macos_27_gate_keeps_same_uid_fd_claims() {
        let bytes = include_bytes!("../tests/fixtures/darwin/macos27-pcblist-adhoc.bin");
        let host_rows = decode_host_listeners(bytes).expect("decode ad-hoc capture");
        let claims = HashMap::from([((54314, "7f000001".into()), vec![4242])]);

        let rows = attribute_host_listeners(host_rows, &claims);

        assert_eq!(rows.len(), 1);
        assert!(matches!(
            rows[0].attribution,
            Attribution::Claimed { pid: 4242 }
        ));
        assert_eq!(rows[0].port, 54314);
        assert_eq!(rows[0].address, "7f000001");
    }
}
