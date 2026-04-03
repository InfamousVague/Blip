# Bandwidth And Network Stats

## What Users See

Blip surfaces bandwidth trends, service breakdowns, DNS stats, and activity summaries.
The goal is operational awareness: "what is talking", "how much", and "where".

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
