# Firewall: What It Can And Cannot Do

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
