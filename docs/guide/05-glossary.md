# Glossary: Key Terms

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
