# RaceCert - MobiCom 2026 Demo #95

## Quick start

Run `CHECK_DEMO.cmd`, wait for CHECK PASSED, then run
`START_DEMO.cmd`. Both the base URL and `/guided.html` open the guided booth.
The optional advanced interface is only at `/index.html`. Use the guided
interface for the exact +1 microsecond certificate edit.
Ordinary use does not require the evidence-regeneration commands under Reproduce.

Huaijin Ran - Nanyang Technological University.  
Haoyi Zhang - Xi’an Jiaotong-Liverpool University.

The paper retains its official Demo title, author affiliations and DOI.

This offline demonstration has an exact BigInt-rational producer, a standalone
JavaScript verifier, and an independent Python `fractions.Fraction` verifier.
It needs no npm packages, pip packages, accounts, or Internet during operation.
All HTTP and UDP traffic is restricted to IPv4 loopback, `127.0.0.1`.
Each certificate and batch needs both semantic checkers to succeed before a
verified decision is shown. An unavailable checker is displayed as ERROR,
distinct from a semantic REJECT, with its reason retained for diagnosis.
The default browser page is the six-step guided booth at `/guided.html`;
the base URL `/` opens that same page.
The existing `/index.html` remains the advanced certificate explorer.
The guided teaching log and sensitivity sweep are added illustrative inputs,
outside the six published fixtures and outside the retained 512-race campaign.

## Start

The Windows portable ZIP on the GitHub Releases page includes its runtimes.
A source checkout requires installed Node.js 20+ and Python 3 on any platform.

**Complete paper + artifact package:** extract the whole project, open
`artifact`, double-click `CHECK_DEMO.cmd`, and wait for the final **CHECK PASSED**
line. Then double-click `START_DEMO.cmd`. The paths below are relative to this
`artifact` directory.

**Windows x64:** extract the entire ZIP, run `artifact/CHECK_DEMO.cmd`
first, then double-click `artifact/START_DEMO.cmd` after CHECK PASSED.
Do not run inside the ZIP viewer. Node 24.19.0 and
official Python 3.13.16 embeddable are included under `runtime/win-x64`.
An installed browser is still required. The server uses port 8765 and, if busy,
tries the next 20 ports. The actual URL is printed. Keep the console open;
Ctrl+C or closing it stops the demo. Windows may ask you to allow downloaded
executables; follow your institution's policy.

`CHECK_DEMO.cmd` checks the runtimes, frozen cases, five live loopback profiles,
semantic rejection, the retained 512-race batch, and the local web endpoints.
It stops only its own temporary test server. It does not open a browser or
modify the retained results. A failed check exits with an error, without an
overall CHECK PASSED. Tests use a freshly created system-temp directory and
remove only that owned directory, including when the campaign check fails.
Socket creation, binding and capture failures close the sockets owned by that
capture. An unexpected socket/send failure stops the live run; it is not
silently converted into evidence of a deliberately dropped packet.

**macOS / Linux:** install Node.js 20+ and a real Python 3
interpreter, run `node preflight.js`, then run `bash START_DEMO.sh` or
`node launch.js` from the extracted
`artifact` directory. macOS/Linux launchers are provided but were not run on
those operating systems in this validation. No non-Windows binaries are bundled.

`RACECERT_PYTHON` optionally selects an explicit Python executable. Otherwise
the runner tries the included Windows Python, Windows `py -3`, and real
`python3`/`python` executables on PATH. WindowsApps store aliases are skipped.
`PORT` changes the starting port. `RACECERT_NO_BROWSER=1` suppresses automatic
browser opening for automated checks; `node server.js` also runs server-only.

## Reproduce

From this directory with Node on PATH:

```text
node preflight.js
node campaign.js
node verifier-js.js results/campaign-batch.json
node launch.js
```

For the Windows portable package without Node on PATH:

```text
runtime\win-x64\node.exe preflight.js
runtime\win-x64\node.exe campaign.js
runtime\win-x64\node.exe verifier-js.js results\campaign-batch.json
runtime\win-x64\node.exe launch.js
```

`campaign.js` regenerates `results/campaign-raw.jsonl`, `campaign-batch.json`,
`campaign-summary.json`, and `manifest.json`. It does not alter the fixtures.
Use the runnable tests and local preflight to recheck the delivered package.

## Guided booth

Inspect the two local-clock tables, certify the zero-error relative delay,
keep the log fixed while changing the error preset, inspect three actual
witnesses, alter a witness by exactly one microsecond and rehash it, then
replay the retained batch. Each accepted result requires two digest-bound PASS
responses. Stage/preset changes clear previous claims. No step auto-runs.
The fixed action bar offers Previous, the current action, Next and Restart.
Left/right select a step, Enter runs the explicit action, and unmodified R
restarts for a new visitor with error preset 1000 us. These shortcuts do not
override typing, select controls, modifier combinations or busy operations.
Presenter view compacts the header and uses that action bar instead of duplicate
in-step buttons. It keeps observations, evidence and source distinctions intact.
Restart clears teaching, witness, tamper and LIVE claims without computing
anything; it also resets and collapses the optional LIVE panel.
While a teaching, retained-batch or LIVE action is busy, **Cancel run** stops
browser waiting and discards that run's result. It does not guarantee that
backend calculation/capture has stopped. Cancelled continuations cannot publish
results or change a newer run. Retry remains an explicit action. Cancellation,
runtime ERROR, semantic REJECT and accepted PASS have different meanings.

Static retained results can be inspected without starting the application,
but they are not a fresh capture or a current verification run.
The optional LIVE section shows actual capture events from the five existing
loopback profiles. Fixed replay and new acquisition are explicitly separate.

`results/presentation-examples.json` retains six actual computed error settings,
the exact one-microsecond rejection and the labelled denominator comparison.
Run `node tests/presentation-cases.cjs` to recheck without writing files;
`--write-evidence` replaces only that added presentation evidence record.
The same case factory drives the interface and its test. These computations
do not calibrate physical devices or measure cellular-path performance.

## Advanced explorer (optional)

**After every manual input change or scenario selection, click Run and certify
and wait for both verifiers to finish.** Editing an input clears the old result
and disables witness tampering and batch insertion until the current inputs
pass both checkers. A failed run also clears the previous certificate. Controls
are locked while capture or checking is in progress. Reset runs a fresh check
for both frozen and live scenarios; only frozen results are byte-stable.

1. Select **Path A is forced**, run, and show both verifier results. Hold the
   trace fixed and change timestamp error from 1 to 1000 us; run again to show
   uncertainty widening. Reset returns the original byte-identical certificate.
2. Select **Censored boundary** and run: margin 1000 us, interval
   `(-infinity, -1000] us`, **ambiguous** with exactly **Force A + Neutral**.
   Scroll to Counterworlds and expand the neutral witness: its difference is
   exactly -1000 us. The A witness is strictly below that endpoint.
   The censoring model permits a missing arrival exactly at receiver close;
   the neutral witness has zero B completion wait. Clock-rate values are
   dimensionless; delays and waits are in microseconds.
3. Click **Tamper semantic field, rehash, recheck**. Both verifiers reject the
   changed delay assignment even after SHA-256 is recomputed. Verifier runtime
   errors are not presented as a successful attack rejection.
4. Choose any of the five **LIVE** profiles to inspect actual sender, relay,
   receiver, drop/late/recovery events. Timings, verdicts, and digests can vary;
   no fixed live verdict is promised. All three sockets bind to loopback.
5. Click **Replay retained 512 races** in Batch aggregation. Both checkers
   recompute the stored batch, including all 512 constituent certificates.
   Expect A=176, neutral=12, B=191, ambiguous=133, no forced path majority.
   **Add current certificate** builds an interactive batch separately. Editing
   batch membership invalidates its old displayed decision until rechecked.

The policy track is a schematic of feasible regions, not a numerical time
scale. Exact interval endpoints and all complete witnesses are in the JSON.

## Release notes and licensing

See [RECOVERY.md](RECOVERY.md) for the retained evidence checksums,
reconstruction scope and reproducibility limits. Public visibility does not
grant an open-source license; the package license remains UNLICENSED.
The portable release retains complete upstream runtime licenses and download
provenance in runtime/RUNTIME-PROVENANCE.json. The app performs no downloads.
