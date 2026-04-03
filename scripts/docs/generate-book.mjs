#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GENERATED = path.join(ROOT, "docs/generated");
const GUIDE_DIR = path.join(ROOT, "docs/guide");

const ANALYSIS_PATH = path.join(GENERATED, "analysis.json");
const EVIDENCE_PATH = path.join(GENERATED, "evidence.json");
const INDEX_PATH = path.join(GENERATED, "guide-index.json");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.trimEnd() + "\n");
}

function evidenceSummary(evidence) {
  if (!evidence?.commands) return "Evidence run not available yet.";
  const required = evidence.commands.filter((c) => c.required);
  const passed = required.filter((c) => c.ok).length;
  return `Required checks passed: ${passed}/${required.length} (generated ${evidence.generatedAt || "n/a"}).`;
}

function chapterOverview(analysis, evidence) {
  return `# Blip Technical User Manual

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

${evidenceSummary(evidence)}

Blip source footprint in this run: ${analysis?.totals?.files ?? "n/a"} files scanned.
`;
}

function chapterGlossary() {
  return `# Glossary: Key Terms

This glossary is intentionally practical. Each term includes what it means for real day-to-day decisions.

## Blocklist

A blocklist is a list of domains that should be denied at DNS resolution time.
In Blip, blocklists are primarily domain-based protections against known ad, tracking, malware, or phishing hosts.

What this means for you:

- Blocklists are efficient for broad hygiene.
- They are intentionally broad, so occasional false positives are normal.
- After enabling aggressive lists, verify key apps still function as expected.

## DNS Filtering

DNS filtering means deciding whether a domain lookup should be allowed before a connection is established.
If blocked, the app attempting the lookup gets a failed DNS response.

What this means for you:

- DNS filtering can stop unwanted traffic earlier than flow-level blocking.
- It depends on domain visibility, so results vary by network context.

## Firewall Rule

A firewall rule in Blip expresses an allow/deny/ask policy for app traffic.
Rules can include scope like app identity, domain pattern, protocol, direction, and port.

What this means for you:

- Narrow scoped rules are safer than blanket rules.
- Ask mode is useful while learning what normal behavior looks like.

## Hop

A hop is a router step along a traceroute path from your device to a destination.
More hops usually means more network segments between source and destination.

What this means for you:

- Hop count is context, not a security verdict by itself.

## Route (in Blip)

A route in Blip is an observed/estimated traffic path used for explanation and visualization.
It is useful for understanding trends, not for legal-grade path guarantees.

What this means for you:

- Use routes as explanatory models, not forensic proof.

## Ocean Cable Route (estimated)

For long-distance links, Blip can estimate a plausible submarine-cable path by matching endpoints to known cable geometry and constructing an approximate path.
It is a model, not a packet-for-packet wire trace.

What this means for you:

- Great for intuition and communication.
- Not suitable as sole evidence for compliance or legal assertions.
`;
}

function chapterDnsFiltering() {
  return `# DNS Filtering In Blip

## User-Level Explanation

When an app asks for a domain (for example, \"example.com\"), Blip can intercept that DNS query.
Blip checks whether the domain (or parent domain) appears in an active blocklist.

- If the domain is allowed: query is forwarded to upstream DNS and returned normally.
- If blocked: Blip returns a denial-style DNS response (NXDOMAIN behavior).

In simple terms, Blip acts like a DNS gatekeeper: if a name is on the deny list, the connection usually never starts.

## Why This Helps

DNS filtering can stop many unwanted connections before they start, especially trackers and known malicious domains.
It is often lower overhead than blocking after full connection setup.

## Typical Flow You Can Expect

1. An app requests a domain.
2. Blip checks active blocklists and match logic.
3. If blocked, DNS is denied.
4. If allowed, DNS resolves and traffic may continue.
5. DNS mapping/statistics are updated for visibility.

## Important Behavioral Notes

- Matching supports subdomain behavior (for example, ad.foo.example.com can match example.com in list logic).
- Blip keeps a DNS mapping cache to enrich visibility and correlate destinations.
- A cached blocklist can still apply briefly if app-side sync is unavailable.
- DNS logs help explain behavior, but source attribution can vary in complex environments.

## What DNS Filtering Does Not Guarantee

- It does not guarantee perfect app attribution in every network context.
- It is less precise when traffic avoids normal DNS resolution paths.
- Domain-level decisions are strongest when domain visibility is clear.

Practical takeaway:

- DNS filtering is a strong first line of control, but it should be paired with firewall policy and monitoring.
`;
}

function chapterFirewall() {
  return `# Firewall: What It Can And Cannot Do

## What Blip Firewall Can Do

Blip's firewall evaluates flows with a rule engine and mode controls.
Conceptually it supports:

- App-aware policy
- Allow / Deny / Ask outcomes
- Scoped matching by domain pattern, protocol, direction, and port
- Global and app-specific rule behavior
- Kill-switch style deny behavior when configured

This gives you a practical range from permissive to strict, depending on your risk tolerance.

## Decision Model (Simplified)

1. Basic safe allowances (for example, local/private-network safety cases)
2. DNS-derived blocked IP checks
3. Rule-index matching (app-specific first, then global)
4. Mode fallback (allow-all / ask / deny-all)

This lets users move from broad defaults to more specific control over time.

Why this order matters:

- low-cost safety checks happen early,
- app-specific intent is preferred over generic defaults,
- global policy still catches anything not explicitly covered.

## Rule Strategy For Everyday Techies

- Start with app-level allow/deny for obvious behavior.
- Add scoped domain/port/protocol constraints where needed.
- Keep rule intent documented in plain language so maintenance is easier.
- Remove stale exceptions regularly.

## What Blip Firewall Cannot Promise

- It cannot promise that every flow maps to a perfectly human-readable domain.
- It cannot promise zero false positives with highly aggressive deny policies.
- It should not be treated as a complete replacement for endpoint security tooling.
- It cannot guarantee one-screen explanations for every blocked edge case.

## Practical User Guidance

- Start with Ask mode while building confidence.
- Promote stable app behavior into explicit allow/deny rules.
- Use scoped rules (domain/port/protocol) to avoid overly broad blanket decisions.

- If a critical app breaks, temporarily relax to Ask mode, observe prompts, then encode minimal scoped rules.
`;
}

function chapterRoutesAndCables() {
  return `# Hops, Traceroute, And Ocean Path Estimates

## What A Hop Means

A hop is one intermediate network step reported by traceroute.
Blip can run periodic traceroute workflows and geolocate discovered hop IPs when possible.

Think of hops as waypoints in the route story, not as ownership or trust proofs.

## How Hop Data Is Used

Hop data is used to provide route context:

- Approximate progression from source to destination
- Latency/context clues
- Better storytelling in route visuals

When data is incomplete, Blip aims for understandable route context rather than fake precision.

## Ocean Travel Estimation

For transcontinental paths, Blip can estimate likely submarine-cable travel by:

1. Loading known cable geometry data
2. Finding plausible nearest cable points to source/destination
3. Constructing a routed path with cable segments + entry/exit legs

This helps answer a practical question: if this traffic appears intercontinental, what is a plausible undersea route shape?

## What This Is (and Is Not)

This is a useful explanatory model.
It is not a legal or forensics-grade statement of exact packet path.

If you need strict path attestations, use network-provider and enterprise measurement tooling beyond consumer-level route inference.

Useful mental model:

- Route layer explains path shape.
- DNS/firewall layers enforce policy.
- Metrics layer explains behavioral trends.
`;
}

function chapterBandwidthAndStats() {
  return `# Bandwidth And Network Stats

## What Users See

Blip surfaces bandwidth trends, service breakdowns, DNS stats, and activity summaries.
The goal is operational awareness: \"what is talking\", \"how much\", and \"where\".

For everyday troubleshooting, this helps answer:

- Which app is creating spikes?
- Did a policy change reduce noisy traffic?
- Is a background process behaving unexpectedly?

## How To Interpret Values

- Throughput-style values represent sampled traffic activity over time.
- Service/domain breakdowns are classification outputs based on observed metadata.
- DNS statistics reflect observed and logged query events.

Interpretation tip:

- Compare trends over windows, not isolated single points.
- Relative jumps are usually more actionable than absolute values.

## Confidence Model For Metrics

Blip metrics are strong for trend detection and behavior comparison.
They are not intended as billing-grade accounting.

Use them for:

- spotting unusual behavior,
- comparing before/after policy changes,
- deciding where to tighten controls.

Avoid using them as the only source for contractual network metering.

Recommended practice:

- Use Blip metrics for decisions and investigation.
- Use provider-grade metering for billing, SLA, or legal accounting.
`;
}

function chapterLimitationsAndPitfalls() {
  return `# Limitations, Pitfalls, And User Expectations

## Core Reality

Blip gives strong visibility/control for many user workflows, but no local app can offer perfect omniscience over every encrypted, abstracted, or platform-managed path.

This is a normal boundary of endpoint-side networking tools, not a Blip-specific flaw.

## Typical Limitations To Expect

1. Domain visibility can degrade in non-traditional resolution paths.
2. Route visualization is modeled inference, not exact wire proof.
3. Aggressive deny posture can block expected app behavior.
4. Platform/network edge cases (enterprise VPNs, custom stacks, resolver behavior) may change observability.

Also expect:

5. Strict policy profiles can create friction if rolled out too quickly.
6. Behavior can vary between home, office, hotspot, and travel networks.

## Pitfall Avoidance Checklist

- Start conservative and tighten policies gradually.
- Validate critical app workflows after each policy change.
- Treat map routes as explanatory, not absolute truth.
- Keep blocklists updated, but review high-impact categories before broad enablement.

- Keep a rollback plan so you can relax policy quickly if a critical app breaks.

## Recommended Operating Pattern

1. Observe baseline traffic.
2. Enable blocklists and monitor impact.
3. Add scoped firewall rules for recurring patterns.
4. Re-check app functionality after every major policy change.

## Escalation Pattern When Something Breaks

1. Confirm symptom timing against recent policy or blocklist changes.
2. Temporarily move from strict deny posture to Ask mode.
3. Identify the exact app/domain/port behavior needed.
4. Create the narrowest rule that restores expected behavior.
5. Re-enable stricter defaults once validated.
`;
}



function writeIndexManifest() {
  const manifest = {
    generatedAt: new Date().toISOString(),
    sections: [
      { id: "overview", title: "Overview", file: "docs/guide/00-overview.md", tooltipKey: "guide.overview" },
      { id: "glossary", title: "Glossary", file: "docs/guide/05-glossary.md", tooltipKey: "guide.glossary" },
      { id: "dns", title: "DNS Filtering", file: "docs/guide/10-dns-filtering.md", tooltipKey: "guide.dns" },
      { id: "firewall", title: "Firewall", file: "docs/guide/20-firewall.md", tooltipKey: "guide.firewall" },
      { id: "routes", title: "Hops And Routes", file: "docs/guide/30-hops-routes-and-cables.md", tooltipKey: "guide.routes" },
      { id: "metrics", title: "Bandwidth And Stats", file: "docs/guide/40-bandwidth-and-stats.md", tooltipKey: "guide.metrics" },
      { id: "limits", title: "Limitations", file: "docs/guide/50-limitations-and-pitfalls.md", tooltipKey: "guide.limits" }
    ]
  };
  write(INDEX_PATH, JSON.stringify(manifest, null, 2));
}

function main() {
  const analysis = readJson(ANALYSIS_PATH);
  const evidence = readJson(EVIDENCE_PATH);

  write(path.join(GUIDE_DIR, "00-overview.md"), chapterOverview(analysis, evidence));
  write(path.join(GUIDE_DIR, "05-glossary.md"), chapterGlossary());
  write(path.join(GUIDE_DIR, "10-dns-filtering.md"), chapterDnsFiltering());
  write(path.join(GUIDE_DIR, "20-firewall.md"), chapterFirewall());
  write(path.join(GUIDE_DIR, "30-hops-routes-and-cables.md"), chapterRoutesAndCables());
  write(path.join(GUIDE_DIR, "40-bandwidth-and-stats.md"), chapterBandwidthAndStats());
  write(path.join(GUIDE_DIR, "50-limitations-and-pitfalls.md"), chapterLimitationsAndPitfalls());

  write(
    path.join(GUIDE_DIR, "README.md"),
    `# Blip Technical User Manual\n\n- [Overview](./00-overview.md)\n- [Glossary](./05-glossary.md)\n- [DNS Filtering](./10-dns-filtering.md)\n- [Firewall](./20-firewall.md)\n- [Hops, Routes, and Cables](./30-hops-routes-and-cables.md)\n- [Bandwidth and Stats](./40-bandwidth-and-stats.md)\n- [Limitations and Pitfalls](./50-limitations-and-pitfalls.md)\n`
  );

  writeIndexManifest();
  console.log("User manual generated under docs/guide/");
}

main();
