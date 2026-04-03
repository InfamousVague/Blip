# Hops, Traceroute, And Ocean Path Estimates

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
