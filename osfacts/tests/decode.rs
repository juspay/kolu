//! Unit tests for the vendored darwin `insi_vflag` address-slot decode.
//! Fixtures run on every host — the dual-stack flag-ordering bug is in the
//! *decode*, and the scar tissue travels with the code.

use osfacts::{slot_from_vflag, AddressSlot, AF_INET, AF_INET6, INI_IPV4, INI_IPV6};

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
    let vflag = INI_IPV4 | INI_IPV6;
    assert_eq!(
        slot_from_vflag(AF_INET6, vflag),
        AddressSlot::V6,
        "dual-stack :: must take the v6 slot, not the v4 wildcard"
    );
}

#[test]
fn v4_mapped_uses_v4_slot() {
    assert_eq!(
        slot_from_vflag(AF_INET6, INI_IPV4),
        AddressSlot::V4,
        "v4-mapped must read the 4-byte slot"
    );
}

#[test]
fn genuine_v6_loopback() {
    assert_eq!(slot_from_vflag(AF_INET6, INI_IPV6), AddressSlot::V6);
}

#[test]
fn neither_flag_falls_back_to_family() {
    assert_eq!(slot_from_vflag(AF_INET6, 0), AddressSlot::V6);
}
