//! Unit tests for the vendored darwin `insi_vflag` address-slot decode.
//!
//! These run on linux too — they exercise pure fixtures, not live libproc —
//! because the dual-stack flag-ordering bug is in the *decode*, and the scar
//! tissue must travel with the code on every host.

// The decode lives in the binary crate; integration tests reach it via the
// same logic re-exported for tests, or we duplicate the pure decision here
// against the public contract. We import through the binary's library face
// once it exists; until then this module fails to compile — which is the
// red we want.

// When the library is wired, these become:
//   use osfacts::decode::{slot_from_vflag, AddressSlot, INI_IPV4, INI_IPV6};
// For the red phase we assert the contract inline by calling a free function
// that the implementation must provide.

#[path = "../src/decode.rs"]
mod decode;

use decode::{slot_from_vflag, AddressSlot, AF_INET, AF_INET6, INI_IPV4, INI_IPV6};

#[test]
fn af_inet_is_always_v4() {
    assert_eq!(slot_from_vflag(AF_INET, 0), AddressSlot::V4);
    assert_eq!(slot_from_vflag(AF_INET, INI_IPV4), AddressSlot::V4);
    assert_eq!(
        slot_from_vflag(AF_INET, INI_IPV4 | INI_IPV6),
        AddressSlot::V4
    );
}

#[test]
fn dual_stack_wildcard_checks_ipv6_first() {
    // Measured: a `::` bind sets BOTH bits (vflag = 0x03). Testing IPV4 first
    // collapses it to 0.0.0.0 — two tools and our own C helper each had this.
    let vflag = INI_IPV4 | INI_IPV6;
    assert_eq!(
        slot_from_vflag(AF_INET6, vflag),
        AddressSlot::V6,
        "dual-stack :: must take the v6 slot, not the v4 wildcard"
    );
}

#[test]
fn v4_mapped_uses_v4_slot() {
    // ::ffff:127.0.0.1 → soi_family=AF_INET6, vflag=INI_IPV4 only.
    // Reading the v6 slot produces the deprecated IPv4-compatible form
    // (::127.0.0.1) — the upstream listeners bug.
    assert_eq!(
        slot_from_vflag(AF_INET6, INI_IPV4),
        AddressSlot::V4,
        "v4-mapped must read the 4-byte slot"
    );
}

#[test]
fn genuine_v6_loopback() {
    // ::1 → vflag = INI_IPV6 only. The v4 slot holds garbage (00000001).
    assert_eq!(slot_from_vflag(AF_INET6, INI_IPV6), AddressSlot::V6);
}

#[test]
fn neither_flag_falls_back_to_family() {
    assert_eq!(slot_from_vflag(AF_INET6, 0), AddressSlot::V6);
}
