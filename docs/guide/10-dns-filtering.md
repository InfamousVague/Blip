# DNS Filtering In Blip

## User-Level Explanation

When an app asks for a domain (for example, "example.com"), Blip can intercept that DNS query.
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
