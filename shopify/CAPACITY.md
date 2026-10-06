# Order bursts and rendering capacity

Flow jobs wait for an available renderer before spending a preparation attempt.
The process admits at most two jobs at once and one per store. Busy jobs remain
in SQLite with a five-second retry time; Shopify Flow's next delivery resumes
them. Capacity waits do not consume the eight attempts reserved for actual
preparation failures. The original 36-hour deadline still ends unattended work.

This corrects a failure found during launch testing: repeated busy responses
previously exhausted the attempt budget without reading or rendering the order.
Regression checks cover more than eight deferrals, service restart, pause,
competing leases, the overall deadline and upstream throttling. Upstream failures
after admission still consume an attempt and use exponential backoff.

## Verified workload

The measurements below are historical, from the worker-based renderer. Current
source uses one child process per render. Keep the same admission limits and
rerun the container workload for that source; do not use the historical timing
or memory figures as measurements of process isolation.

The October 3, 2026 Linux container run used the production image under the
staging ceilings: **0.5 CPU and 512 MiB RAM**. The real HTTP server stayed online
while a separate probe exercised the actual Flow service, admission limiter,
SQLite job ledger and Fullbleed renderer. The probe used its own synthetic
database, synthetic order access and locally simulated Flow polling. It did not
call a merchant store, approve billing or send email.

| Measurement | Observed result |
| --- | --- |
| Burst | 24 jobs across four synthetic stores |
| Document cases | Two standard one-page documents, two eight-page long orders, one 250-item/20-page order, one custom HTML/CSS template |
| Preparation | Exactly one per job; at most two renders at once |
| Burst completion | 56.5 seconds, including simulated polling and capacity waits |
| Downloads | All 24 reproduced the prepared PDF hash |
| Render duration | 650 ms median; 2,994 ms p95 across 48 preparation/download renders |
| Container memory peak | 242 MiB; no out-of-memory events |
| Co-resident HTTP readiness | 709 successful checks, zero failures; 76 ms p95 |

The same six documents were byte-identical on Windows and Linux. All item
identifiers were present, all extracted text stayed inside page boundaries,
and representative first/last pages were visually inspected. Pause invalidated
the prepared links after the download checks. See
[retained evidence](../docs/capacity-verification.json).

## Reproduce

Build the production image and run the existing container verification:

```sh
docker build -f shopify/app/Dockerfile -t fullbleed-commerce:check .
node tools/check-container.mjs
```

The checker creates disposable containers and volumes, migrates an isolated
`capacity-test.sqlite`, runs `tools/check-flow-capacity.mjs`, and retains the
six PDFs and measurements in `output/container/capacity/`. The workload harness
is copied into the disposable container; it is not shipped as an HTTP endpoint.
The GitHub verification workflow retains the same artifacts.

## Operating interpretation

Keep the existing one-process topology and concurrency ceiling. This finite
workload provides evidence for those settings, not an hourly-volume commitment
or a production latency guarantee. Its burst timing includes our polling
cadence; Shopify controls real Flow deliveries. Readiness polling shares the
CPU and memory ceiling, but does not exercise authenticated app routes or the
production database under order traffic.

Before publishing included usage or raising limits, measure the installed app
on the stable hosted origin with subscription checks, Shopify API delays, real
Flow delivery, sustained traffic and host billing. A link preparation and each
subsequent download both render a PDF; account for both. Custom templates,
embedded images and different order distributions can change resource use.
Continue enforcing the existing order, template, page, output-size and timeout
limits. Do not advertise unlimited rendering from this result.
