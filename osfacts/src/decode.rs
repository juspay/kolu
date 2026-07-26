//! Vendored darwin `insi_vflag` address-slot decode.
//!
//! Source: the upstream-merged fix in GyulyVGC/listeners (PR #57, merge
//! `226273e5`, 2026-07-25) — the same flag order proved in
//! `packages/port-scan/native/portScanDarwin.c`.
//!
//! Why vendor, not depend: `listeners` as a crate re-imports the host-wide fd
//! walk that `--roots` exists to avoid. The decode is the only part that
//! earned its keep; the scar-tissue fixtures ride it here.
//!
//! `soi_family` does NOT say which slot of `insi_laddr` holds the address —
//! `insi_vflag` does. Order is load-bearing:
//!
//! | bind             | soi_family | insi_vflag      | correct slot |
//! | ---------------- | ---------- | --------------- | ------------ |
//! | ::ffff:127.0.0.1 | AF_INET6   | 0x01 (v4 only)  | v4           |
//! | ::  (dual-stack) | AF_INET6   | 0x03 (BOTH)     | v6           |
//! | ::1              | AF_INET6   | 0x02 (v6 only)  | v6           |
//! | 127.0.0.1        | AF_INET    | 0x01            | v4           |
//!
//! INI_IPV6 must be tested FIRST: a dual-stack socket sets BOTH flags, and
//! testing IPV4 first reports a `::` bind as `0.0.0.0`.

/// Darwin `AF_INET` (matches `<sys/socket.h>` on macOS).
pub const AF_INET: i32 = 2;
/// Darwin `AF_INET6` — 30 on macOS, not the linux 10.
pub const AF_INET6: i32 = 30;

/// `INI_IPV4` from `<netinet/in_pcb.h>`.
pub const INI_IPV4: u8 = 0x1;
/// `INI_IPV6` from `<netinet/in_pcb.h>`.
pub const INI_IPV6: u8 = 0x2;

/// Which slot of `insi_laddr` holds the bind address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressSlot {
    /// 4-byte `i46a_addr4` slot (AF_INET or v4-mapped).
    V4,
    /// 16-byte `ina_6` slot (genuine v6, including dual-stack `::`).
    V6,
}

/// Decide the address slot from `soi_family` + `insi_vflag`.
///
/// Pure: no libproc, no OS — fixtures run on every host.
pub fn slot_from_vflag(family: i32, vflag: u8) -> AddressSlot {
    if family == AF_INET {
        AddressSlot::V4
    } else if vflag & INI_IPV6 != 0 {
        // Genuine v6, INCLUDING dual-stack (both flags set).
        AddressSlot::V6
    } else if vflag & INI_IPV4 != 0 {
        // v4-mapped: address lives in the 4-byte slot.
        AddressSlot::V4
    } else {
        // Neither flag: trust the family rather than invent a slot.
        AddressSlot::V6
    }
}
