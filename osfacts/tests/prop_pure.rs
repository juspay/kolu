//! Lane 1 — proptest, pure functions only.
//!
//! (a) address-decode round-trips (PR-#57 bug class: v4-mapped, dual-stack
//!     both-flags via the slot decision; network-hex and /proc-hex codecs).
//! (b) TSV name sanitizing never yields an unescaped delimiter.

use osfacts::{
    decode_network_hex, decode_proc_hex, encode_hex, encode_proc_hex, encode_tsv_string,
    encode_tsv_strings, sanitize_name, slot_from_vflag, AddressSlot, AF_INET, AF_INET6, INI_IPV4,
    INI_IPV6,
};
use proptest::prelude::*;

fn arbitrary_string() -> impl Strategy<Value = String> {
    prop::collection::vec(any::<char>(), 0..128)
        .prop_map(|characters| characters.into_iter().collect())
}

// ── (a) address decode ──────────────────────────────────────────────────

proptest! {
    /// Network-order hex is its own inverse for v4 (4 bytes) and v6 (16 bytes).
    #[test]
    fn network_hex_roundtrip(bytes in prop::collection::vec(any::<u8>(), 4)) {
        let hex = encode_hex(&bytes);
        let back = decode_network_hex(&hex).expect("decode");
        prop_assert_eq!(bytes, back);
    }

    #[test]
    fn network_hex_roundtrip_v6(bytes in prop::collection::vec(any::<u8>(), 16)) {
        let hex = encode_hex(&bytes);
        let back = decode_network_hex(&hex).expect("decode");
        prop_assert_eq!(bytes, back);
    }

    /// `/proc` host-order hex round-trips through the word-swap codec.
    #[test]
    fn proc_hex_roundtrip_v4(bytes in prop::collection::vec(any::<u8>(), 4)) {
        let hex = encode_proc_hex(&bytes).expect("encode");
        let back = decode_proc_hex(&hex).expect("decode");
        prop_assert_eq!(bytes, back);
    }

    #[test]
    fn proc_hex_roundtrip_v6(bytes in prop::collection::vec(any::<u8>(), 16)) {
        let hex = encode_proc_hex(&bytes).expect("encode");
        let back = decode_proc_hex(&hex).expect("decode");
        prop_assert_eq!(bytes, back);
    }
}

#[test]
fn dual_stack_both_flags_is_v6_slot() {
    // The scar: vflag = 0x03 must NOT collapse to the v4 wildcard.
    assert_eq!(
        slot_from_vflag(AF_INET6, INI_IPV4 | INI_IPV6),
        AddressSlot::V6
    );
}

#[test]
fn v4_mapped_flag_is_v4_slot() {
    assert_eq!(slot_from_vflag(AF_INET6, INI_IPV4), AddressSlot::V4);
}

#[test]
fn af_inet_always_v4_slot() {
    assert_eq!(slot_from_vflag(AF_INET, 0), AddressSlot::V4);
    assert_eq!(
        slot_from_vflag(AF_INET, INI_IPV4 | INI_IPV6),
        AddressSlot::V4
    );
}

// ── (b) TSV escaping ────────────────────────────────────────────────────

proptest! {
    /// sanitize_name never emits a TSV delimiter or a line break, so a name
    /// used as the last P-field cannot shift the field count.
    #[test]
    fn sanitize_name_never_emits_delimiters(name in ".*") {
        let s = sanitize_name(&name);
        prop_assert!(!s.contains('\t'), "tab survived: {s:?}");
        prop_assert!(!s.contains('\n'), "newline survived: {s:?}");
        prop_assert!(!s.contains('\r'), "cr survived: {s:?}");
    }

    /// A P-row built with a hostile name always has exactly 4 fields.
    #[test]
    fn p_row_arity_under_hostile_names(name in ".*") {
        let s = sanitize_name(&name);
        let row = format!("P\t1\t0\t{s}");
        // split on tab — exactly 4 fields (tag, pid, ppid, name).
        let fields: Vec<&str> = row.split('\t').collect();
        prop_assert_eq!(fields.len(), 4);
        prop_assert_eq!(fields[0], "P");
    }


    #[test]
    fn cwd_json_field_roundtrips_hostile_text(value in arbitrary_string()) {
        let encoded = encode_tsv_string(&value);
        let row = format!("CWD\t1\t{encoded}");
        let fields: Vec<&str> = row.split('\t').collect();
        prop_assert_eq!(fields.len(), 3);
        let decoded: String = serde_json::from_str(fields[2]).expect("decode cwd");
        prop_assert_eq!(decoded, value);
    }

    #[test]
    fn argv_json_field_roundtrips_hostile_text(values in prop::collection::vec(arbitrary_string(), 0..20)) {
        let encoded = encode_tsv_strings(&values);
        let row = format!("ARGV\t1\t{encoded}");
        let fields: Vec<&str> = row.split('\t').collect();
        prop_assert_eq!(fields.len(), 3);
        let decoded: Vec<String> = serde_json::from_str(fields[2]).expect("decode argv");
        prop_assert_eq!(decoded, values);
    }
}
