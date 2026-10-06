# Native rendering investigation

The intermittent Linux SIGSEGV in [fullbleed-node #7](https://github.com/fullbleed-engine/fullbleed-node/issues/7)
remains unresolved. The published `fullbleed@0.1.2` package and its Fullbleed 2.5.6
engine are unchanged. A successful repetition does not establish a crash fix or
production capacity.

## Current server containment

Commerce source uses `fullbleed@0.2.0` / engine 2.5.8 with `isolation: 'process'`
for every server render. Each call starts a Node child that owns its WASM worker.
The HTTP server keeps the admission slot until that child exits and IPC closes,
including after cancellation or native-process failure. A failure returns through
the existing document-error path; no render retry is hidden inside this wrapper.
The free WordPress renderer still runs locally in a browser worker.

The lifecycle suite deliberately kills real children and checks cleanup and the
next request. The standalone HTTP test also verifies a 502 response, healthy
server, and subsequent PDF after the killed child. These controlled failures
check containment; they do not explain or reproduce the original SIGSEGV.

The diagnostic workflow is now manually dispatched. Ordinary release CI still
checks one complete pagination matrix, actual child-failure recovery, browser
downloads and the container workload. Repeating five normal and five debugger
sweeps on every lockfile change did not establish the intermittent crash's cause.
Run another diagnostic only for a new failure or a specific hypothesis.

## What the original failure establishes

The [initial pagination job](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37179186421/job/111368079718)
used Node 24.21.0 on Linux at Commerce commit
`aba1b199d3000a2940e6869cfe207a0fe35d5cfc` and exited 139. Its retained artifact
contains 87 PDFs and six previews. The last completed fixture was
`contrast-A4-starter-32.pdf`, including its final-page PNG. The following
33-item PDF is missing. The failure may have occurred while the previous worker
was exiting or while the next render was running; the old log cannot distinguish
these possibilities.

The original artifact has SHA-256
`7bf343b54eebb676cdf52b67e593ece0f968208b546e438c18f0b25aa4f4f9cb`.
All 87 retained PDFs match the later Linux reproduction byte for byte.

## Local observations

The [retained local evidence](native-diagnostics-local.json) records an isolated
Ubuntu 22.04 WSL2 environment with the official Node 24.21.0 Linux binary,
verified against Node's published checksum. Only synthetic checked-in orders were
rendered. This environment differs from the original GitHub runner.

| Run | Result |
| --- | --- |
| Original source under GDB, five independent processes | 905 PDFs completed |
| Instrumented sweep, five normal processes | 905 PDFs completed; independent content checks passed |
| Instrumented sweep, five GDB processes | 905 PDFs completed; independent content checks passed |
| Original 32-item preview followed by 33-item PDF, repeated 100 times under GDB | 200 PDFs matched the baseline |
| Controlled exception, native abort and timeout | Diagnostic report, native stack and timeout handling verified |

All 2,715 PDFs from the complete sweeps match the first baseline sweep. That
baseline also passed the independent reader's 1,260 content checks and saved
template hash check. These are fixture-specific observations, not evidence of a
resolved SIGSEGV. The normal and GDB repetitions help expose debugger-dependent
timing differences, but neither reproduces the original runner exactly.

The initial local reader attempt lacked `typing_extensions` in its isolated
Python 3.10 environment and correctly failed the gate despite a successful render.
After installing that reader dependency, the complete five-run checks above
passed. No failed render was converted to a passing result by retry logic.

## Reproduce and retain the next failure

Use Linux, Node **24.21.0**, Python 3.11 or newer, and GDB for debugger mode:

```sh
npm ci --ignore-scripts
python -m pip install pypdf==6.1.1
python tools/check-native-diagnostic-capture.py
python tools/check-native-stability.py --runs 5 --output output/native-direct
python tools/check-native-stability.py --runs 5 --debugger gdb --output output/native-gdb
```

Each output directory must be new. The runner refuses to reuse old artifacts,
stops on the first failure, bounds each child process, compares output hashes
across repetitions, and invokes the independent PDF reader after each sweep.
The GitHub **Native rendering diagnostics** workflow runs both modes separately
on Ubuntu 24.04 and retains artifacts even when a job fails. Dispatch it manually
for a specific investigation.

The harness passes `--diagnostic-worker` to the synthetic pagination runner so
GDB observes the process that owns the WASM worker. It records `isolation: worker`
in `runtime.json`; ordinary Commerce and pagination verification use `process`.
The child's launch intentionally excludes application Node flags, so attaching
GDB only to the production parent would not capture a render child's stack.
Reproducing the original package also requires its recorded source checkout;
selecting Node 24.21.0 alone does not restore the old Fullbleed package.

`progress.jsonl` records a synchronous start and retained-result entry for each
fixture, including item count, preview setting, memory use and elapsed time.
`runtime.json` records Node/V8 versions, the lockfile hash and bundled engine
manifest. A missing final `complete` event is a failed run. `verification.json`
includes exit status, timeout status, last complete breadcrumb, independent
reader result and cross-run hash comparison.

Node's [diagnostic reports](https://nodejs.org/download/release/v24.21.0/docs/api/report.html)
cover uncaught exceptions and runtime fatal errors; they do not guarantee a stack
for an arbitrary SIGSEGV. GDB mode stops on native signals and retains thread
stacks, registers and loaded libraries. A debugger stop needs investigation: a
WebAssembly trap can also produce a signal. The controlled-abort check verifies
capture behavior and is separate from reproducing the original failure.

The harness starts children with a restricted environment, excludes environment
variables and network interfaces from Node reports, and reads only the synthetic
fixture suite. Do not point this tool at a live merchant process or upload a
production core dump. It changes no deployed service or package release.

Next evidence needed: reproduce the SIGSEGV with its native stack, reduce the
failing workload, then compare the unchanged package with a targeted correction
under the same runtime. Keep the original failure open until that evidence
supports a fix.

## Recurrence and runtime selection

The [October 4 recurrence](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37191141479/job/111403428088)
at source `8c41f401aaef9b4f82f4689e1c1cb09747f15135` also exited 139 on
Node 24.21.0. Its synchronous journal ends at the start of
`contrast-A4-starter-33.pdf`, immediately after retaining the 32-item PDF and
preview. All 87 completed PDFs match the earlier baseline. This narrows the
boundary but does not provide a native stack or identify the defective code.
Five normal and five GDB repetitions in the
[follow-up run](https://github.com/fullbleed-engine/fullbleed-commerce/actions/runs/37191334537)
passed without reproducing it.

[Node issue 66366](https://github.com/nodejs/node/issues/66366) reports a V8
WebAssembly-wrapper lifetime failure in Node 24.21.0 on Linux workers and no
corresponding native failure in its Node 26.10.0 comparisons. The
[V8 correction](https://github.com/v8/v8/commit/9b8ca54d5a) addresses a wrapper
being released twice during code collection. This is a relevant upstream lead,
not a confirmed diagnosis of Fullbleed's crash.

Commerce now pins Node 26.10.0 for its container and development/CI toolchain.
The native diagnostic workflow defaults to that selected runtime; its manual
runtime selector keeps 24.21.0 available for investigating the failing baseline.
All release checks must pass on the selected runtime before merging or deploying.
No engine change, disabled garbage collection, automatic retry or suppressed
failure is used as a workaround. Node 26.10.0 is a Current release, not LTS;
reassess the supported runtime when the upstream Node 24 correction ships or
Node 26 enters LTS. The original Node 24 crash remains open.
