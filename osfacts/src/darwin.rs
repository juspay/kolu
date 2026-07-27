//! Darwin readers. `proc_*` supplies scoped process facts and attribution;
//! `net.inet.tcp.pcblist_n` is the independent, host-wide listener truth.

#![cfg(target_os = "macos")]

use crate::cli::{HostArgs, Scope, SnapshotArgs};
use osfacts::{
    errno_name, hex_bytes, sanitize_name, slot_from_vflag, AddressSlot, Attribution, Cpu, Disk,
    HostMemory, HostSnapshot, Load, Memory, Network, Port, Proc, Snapshot, SourceError, StartTime,
    Swap, Unreadable,
};
use std::collections::{HashMap, HashSet};
use std::ffi::{CStr, CString};
use std::mem;
use std::os::raw::{c_char, c_int, c_uint, c_void};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const PROC_ALL_PIDS: u32 = 1;
const PROC_PIDTBSDINFO: c_int = 3;
const PROC_PIDTASKINFO: c_int = 4;
const PROC_PIDLISTFDS: c_int = 1;
const PROC_PIDPATHINFO_MAXSIZE: usize = 4 * 1024;
const PROC_PIDFDSOCKETINFO: c_int = 3;
const PROX_FDTYPE_SOCKET: u32 = 2;
const SOCKINFO_TCP: c_int = 2;
const TSI_S_LISTEN: c_int = 1;
const AF_LINK: u8 = 18;
const XSO_INPCB: u32 = 0x010;
const XSO_TCPCB: u32 = 0x020;
const INP_IPV6: u8 = 0x2;
const PROCESSOR_CPU_LOAD_INFO: c_int = 2;

#[repr(C)]
struct ProcBsdInfo {
    pbi_flags: u32,
    pbi_status: u32,
    pbi_xstatus: u32,
    pbi_pid: u32,
    pbi_ppid: u32,
    pbi_uid: u32,
    pbi_gid: u32,
    pbi_ruid: u32,
    pbi_rgid: u32,
    pbi_svuid: u32,
    pbi_svgid: u32,
    rfu_1: u32,
    pbi_comm: [u8; 16],
    pbi_name: [u8; 32],
    pbi_nfiles: u32,
    pbi_pgid: u32,
    pbi_pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
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
const _: () = assert!(mem::size_of::<ProcBsdInfo>() == 136);

extern "C" {
    fn proc_listpids(type_: u32, typeinfo: u32, buffer: *mut c_void, buffersize: c_int) -> c_int;
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
    let all = match list_pids() {
        Ok(pids) => pids,
        Err(err) => {
            snap.errors.push(source_error("proc_listpids", err));
            return snap;
        }
    };
    let wanted = select_pids(&args.scope, &all, &mut snap);

    for &pid in &wanted {
        let bsd = if args.procs || args.start_time {
            Some(read_bsd(pid))
        } else {
            None
        };
        if args.procs {
            match bsd.as_ref().expect("bsd requested") {
                Ok(row) => snap.procs.push(Proc {
                    pid,
                    ppid: row.ppid,
                    name: row.name.clone(),
                }),
                Err(err) => push_unreadable(&mut snap, pid, "proc", *err),
            }
        }
        if args.mem {
            match read_rss(pid) {
                Ok(rss_bytes) => snap.memory.push(Memory { pid, rss_bytes }),
                Err(err) => push_unreadable(&mut snap, pid, "mem", err),
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
            Ok(rows) if rows.is_empty() => snap.errors.push(SourceError {
                source: "darwin_tcp_pcblist".into(),
                code: "BLIND_OR_EMPTY".into(),
            }),
            Ok(rows) => {
                snap.ports = rows
                    .into_iter()
                    .map(|(port, address)| Port {
                        attribution: claims
                            .get(&(port, address.clone()))
                            .and_then(|pids| pids.first())
                            .map_or(Attribution::Unclaimed, |&pid| Attribution::Claimed { pid }),
                        uid: None,
                        port,
                        address,
                    })
                    .collect();
            }
            Err(err) => snap.errors.push(source_error("darwin_tcp_pcblist", err)),
        }
    }

    snap.procs.sort_by_key(|row| row.pid);
    snap.memory.sort_by_key(|row| row.pid);
    snap.start_times.sort_by_key(|row| row.pid);
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
            Err(err) => out.errors.push(source_error("host_processor_info", err)),
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

#[derive(Clone)]
struct BsdRow {
    ppid: u32,
    name: String,
    start_unix_us: u64,
}

fn select_pids(scope: &Scope, all: &[u32], snap: &mut Snapshot) -> Vec<u32> {
    match scope {
        Scope::Host => all.to_vec(),
        Scope::Pids(pids) => pids.clone(),
        Scope::Roots(roots) => subtree(roots, all, snap),
    }
}

fn subtree(roots: &[u32], all: &[u32], snap: &mut Snapshot) -> Vec<u32> {
    let mut children = HashMap::<u32, Vec<u32>>::new();
    let mut readable = HashSet::new();
    let listed: HashSet<u32> = all.iter().copied().collect();
    for &pid in all {
        if let Ok(row) = read_bsd(pid) {
            children.entry(row.ppid).or_default().push(pid);
            readable.insert(pid);
        }
    }
    let mut seen = HashSet::new();
    let mut queue = Vec::new();
    for &root in roots {
        if !readable.contains(&root) {
            let err = if listed.contains(&root) {
                read_bsd(root).err().unwrap_or(libc::EIO)
            } else {
                libc::ESRCH
            };
            push_unreadable(snap, root, "proc", err);
        } else if seen.insert(root) {
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

fn list_pids() -> Result<Vec<u32>, i32> {
    unsafe {
        let bytes = proc_listpids(PROC_ALL_PIDS, 0, std::ptr::null_mut(), 0);
        if bytes <= 0 {
            return Err(errno());
        }
        let size = bytes + 64 * mem::size_of::<c_int>() as c_int;
        let mut buf = vec![0i32; size as usize / mem::size_of::<c_int>()];
        let used = proc_listpids(PROC_ALL_PIDS, 0, buf.as_mut_ptr().cast(), size);
        if used <= 0 {
            return Err(errno());
        }
        let mut out: Vec<u32> = buf[..used as usize / mem::size_of::<c_int>()]
            .iter()
            .copied()
            .filter(|&pid| pid > 0)
            .map(|pid| pid as u32)
            .collect();
        out.sort_unstable();
        Ok(out)
    }
}

fn read_bsd(pid: u32) -> Result<BsdRow, i32> {
    unsafe {
        let mut bsd = mem::zeroed::<ProcBsdInfo>();
        let n = proc_pidinfo(
            pid as c_int,
            PROC_PIDTBSDINFO,
            0,
            (&raw mut bsd).cast(),
            mem::size_of::<ProcBsdInfo>() as c_int,
        );
        if n < mem::size_of::<ProcBsdInfo>() as c_int {
            return Err(errno());
        }
        let name = path_basename(pid)
            .or_else(|| cstr_field(&bsd.pbi_name))
            .or_else(|| cstr_field(&bsd.pbi_comm))
            .unwrap_or_else(|| pid.to_string());
        Ok(BsdRow {
            ppid: bsd.pbi_ppid,
            name: sanitize_name(&name),
            start_unix_us: bsd
                .pbi_start_tvsec
                .saturating_mul(1_000_000)
                .saturating_add(bsd.pbi_start_tvusec),
        })
    }
}

fn read_rss(pid: u32) -> Result<u64, i32> {
    unsafe {
        let mut task = [0u8; 96];
        let n = proc_pidinfo(
            pid as c_int,
            PROC_PIDTASKINFO,
            0,
            task.as_mut_ptr().cast(),
            task.len() as c_int,
        );
        if n < 16 {
            return Err(errno());
        }
        Ok(u64::from_ne_bytes(
            task[8..16].try_into().expect("fixed slice"),
        ))
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
            let raw_port = u16::from_ne_bytes(bytes[offset + 18..offset + 20].try_into().unwrap());
            let port = u16::from_be(raw_port);
            let vflag = bytes[offset + 48];
            let local = &bytes[offset + 68..offset + 84];
            let address = if vflag & INP_IPV6 != 0 {
                hex_bytes(local)
            } else {
                hex_bytes(&local[12..16])
            };
            pending = Some((port, address));
        } else if kind == XSO_TCPCB && len >= 40 {
            let state = i32::from_ne_bytes(bytes[offset + 36..offset + 40].try_into().unwrap());
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
    let page = sysctl_u64_any("hw.pagesize").map_err(|e| ("hw_pagesize", e))?;
    let free = sysctl_u64_any("vm.page_free_count").map_err(|e| ("vm_page_free", e))?;
    let inactive = sysctl_u64_any("vm.page_inactive_count").map_err(|e| ("vm_page_inactive", e))?;
    let speculative =
        sysctl_u64_any("vm.page_speculative_count").map_err(|e| ("vm_page_speculative", e))?;
    let swap = sysctl_bytes("vm.swapusage").map_err(|e| ("vm_swapusage", e))?;
    if swap.len() < 24 {
        return Err(("vm_swapusage", libc::EINVAL));
    }
    Ok((
        HostMemory {
            total_bytes: total,
            available_bytes: free
                .saturating_add(inactive)
                .saturating_add(speculative)
                .saturating_mul(page),
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

fn read_cpus() -> Result<Vec<Cpu>, i32> {
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
            return Err(status);
        }
        if info.is_null() {
            return Err(libc::EINVAL);
        }
        if count < cores.saturating_mul(4) {
            let _ = libc::vm_deallocate(
                libc::mach_task_self(),
                info as libc::vm_address_t,
                count as libc::vm_size_t * mem::size_of::<c_int>(),
            );
            return Err(libc::EINVAL);
        }
        let ticks = std::slice::from_raw_parts(info, count as usize);
        let hz = libc::sysconf(libc::_SC_CLK_TCK);
        if hz <= 0 {
            let _ = libc::vm_deallocate(
                libc::mach_task_self(),
                info as libc::vm_address_t,
                count as libc::vm_size_t * mem::size_of::<c_int>(),
            );
            return Err(libc::EINVAL);
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
                }
            })
            .collect();
        let status = libc::vm_deallocate(
            libc::mach_task_self(),
            info as libc::vm_address_t,
            count as libc::vm_size_t * mem::size_of::<c_int>(),
        );
        if status == 0 { Ok(rows) } else { Err(status) }
    }
}

fn read_networks() -> Result<Vec<Network>, i32> {
    unsafe {
        let mut head = std::ptr::null_mut();
        if libc::getifaddrs(&mut head) != 0 {
            return Err(errno());
        }
        let mut rows = HashMap::<String, (u64, u64)>::new();
        let mut cursor = head;
        while !cursor.is_null() {
            let ifa = &*cursor;
            if !ifa.ifa_addr.is_null()
                && (*ifa.ifa_addr).sa_family == AF_LINK
                && !ifa.ifa_data.is_null()
            {
                let data = std::slice::from_raw_parts(ifa.ifa_data.cast::<u8>(), 80);
                let rx = u64::from_ne_bytes(data[64..72].try_into().unwrap());
                let tx = u64::from_ne_bytes(data[72..80].try_into().unwrap());
                let name = CStr::from_ptr(ifa.ifa_name).to_string_lossy().into_owned();
                rows.insert(name, (rx, tx));
            }
            cursor = ifa.ifa_next;
        }
        libc::freeifaddrs(head);
        let mut out: Vec<_> = rows
            .into_iter()
            .map(|(name, (rx_bytes, tx_bytes))| Network {
                name,
                rx_bytes,
                tx_bytes,
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }
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
            total_bytes: stat.f_blocks.saturating_mul(stat.f_frsize),
            available_bytes: stat.f_bavail.saturating_mul(stat.f_frsize),
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

fn sysctl_u64_any(name: &str) -> Result<u64, i32> {
    let bytes = sysctl_bytes(name)?;
    match bytes.len() {
        4 => Ok(u32::from_ne_bytes(bytes[0..4].try_into().unwrap()) as u64),
        8.. => Ok(u64::from_ne_bytes(bytes[0..8].try_into().unwrap())),
        _ => Err(libc::EINVAL),
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, i32> {
    bytes
        .get(offset..offset + 4)
        .and_then(|slice| slice.try_into().ok())
        .map(u32::from_ne_bytes)
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
