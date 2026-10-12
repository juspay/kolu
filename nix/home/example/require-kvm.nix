# Every VM test here runs under KVM or fails. QEMU's default for NixOS tests is
# `accel=kvm:tcg`: without a usable /dev/kvm it silently falls back to software
# emulation, which is many times slower (the emanote VM test took 225.8s under
# TCG vs 121.4s with KVM on a Cloudflare container) and hides a misconfigured
# CI lane. With forceAccel QEMU errors out instead ("forceAccel is enabled but
# /dev/kvm is not accessible"). mkForce: the test framework sets this per node
# from its own `qemu.forceAccel` (default false), which `testers.nixosTest`
# does not expose.
{ lib, ... }: { virtualisation.qemu.forceAccel = lib.mkForce true; }
