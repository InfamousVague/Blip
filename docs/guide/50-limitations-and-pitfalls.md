# Limitations, Pitfalls, And User Expectations

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
