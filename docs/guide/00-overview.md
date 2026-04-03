# Blip Technical User Manual

This guide explains Blip in plain language for technical users and curious non-engineers.
It focuses on what Blip does, why it behaves that way, and where the boundaries are.

## What Blip Is

Blip is a macOS network visibility and control app designed to help you answer practical questions like:

- Which app is talking right now?
- Where does that traffic appear to be going?
- Is this DNS request expected or suspicious?
- Should this app be allowed, denied, or reviewed?

At a high level, it combines:

- Live traffic observation (connections, destinations, estimated routes)
- DNS-level filtering with blocklists
- App-aware firewall decisions
- A map-based model to help people reason about where traffic appears to travel

Blip is most useful when treated as an observability-plus-control layer, not a black box.

## How To Read This Manual

- Read Glossary first if networking terms are new.
- Read DNS Filtering and Firewall next to understand controls.
- Read Hops, Routes, and Cables to interpret map behavior correctly.
- Read Limitations before creating strict policies.

## What This Manual Covers

1. Core terms and concepts (blocklist, hop, route, DNS filtering)
2. How DNS filtering works in Blip
3. How the firewall works, and what it can and cannot promise
4. How route hops and ocean cable estimates are produced
5. How bandwidth and stats are computed
6. Practical limitations and pitfalls users should know

## How Confident These Claims Are

Required checks passed: 3/3 (generated 2026-04-03T03:45:18.291Z).

Blip source footprint in this run: 660 files scanned.
