# RaceCert

**Exact Certificates for Two-Path Races**

Huaijin Ran, Nanyang Technological University  
Haoyi Zhang, Xi'an Jiaotong-Liverpool University

[MobiCom 2026 Demo paper](https://doi.org/10.1145/3795866.3848465) · [Paper PDF](paper/RaceCert_CameraReady.pdf) · [Windows portable download](https://github.com/Haoyi-Zhang/RaceCert/releases/latest)

RaceCert checks which relative transit-delay decisions follow from a packet
race and declared clock-rate and timestamp-reading error bounds. It produces
an exact feasible interval and a certificate. When several policy outcomes
remain possible, the certificate includes a complete feasible timing history
for each outcome. Separate JavaScript and Python checkers recompute the claim
from the original observations.

## Run on Windows

1. Download `RaceCert_Project_Windows_x64.zip` from [Releases](https://github.com/Haoyi-Zhang/RaceCert/releases/latest).
2. Extract the entire ZIP to a local folder. Do not run from inside the ZIP viewer.
3. Open `artifact`, run `CHECK_DEMO.cmd`, and wait for `CHECK PASSED`.
4. Run `START_DEMO.cmd`. Keep the console open while using the application.

The portable download includes Node.js and Python for Windows x64. A modern
browser is required. No npm/pip installation, cloud account or Internet
connection is needed during operation. The actual local URL appears in the
console. Close that console or press Ctrl+C there to stop the application.

## Run from source

Install Node.js 20+ and Python 3, then:

```sh
git clone https://github.com/Haoyi-Zhang/RaceCert.git
cd RaceCert/artifact
node preflight.js
node launch.js
```

The source tree excludes portable runtime executables. Those are provided in
the Windows release ZIP with their upstream licenses. macOS and Linux
launchers are included but have not been validated on those operating systems
for this release.

## Demo workflow

The guided interface starts with a controlled two-clock log. Keep the readings
fixed while widening the per-read error bound, inspect feasible timing
histories, change a certificate field and rehash it, then replay the retained
512-race batch. Both checkers must accept a result before it is shown as
verified. A runtime error is distinct from a semantic rejection.

An optional LIVE mode captures loopback UDP events. These captures are
separate from the fixed-seed generated campaign. All HTTP and UDP traffic is
restricted to IPv4 loopback.

## Retained evidence

The retained software campaign contains 512 generated races: 176 force A,
12 neutral, 191 force B and 133 ambiguous. Neither path has a certified
majority over all 512 races. The same 191 force-B certificates are 37.3% of
all races and 50.4% of the 379 non-ambiguous races, with neutral cases retained
in both denominators.

These are generated model inputs, not phone or radio-path measurements.
Physical-device claims require suitable traces and justified uncertainty bounds.

## Contents

- `paper/`: the camera-ready Demo paper.
- `artifact/`: producer, two checkers, local interface, launchers, tests and retained results.
- [`artifact/README.md`](artifact/README.md): detailed operation and reproduction commands.
- [`artifact/RECOVERY.md`](artifact/RECOVERY.md): reconstruction scope, evidence checksums and reproducibility limits.

## Citation

Huaijin Ran and Haoyi Zhang. 2026. *Demo: RaceCert: Exact Certificates for
Two-Path Races.* MobiCom '26. https://doi.org/10.1145/3795866.3848465

## Licensing

The paper includes its own Creative Commons notice. The project package
retains `UNLICENSED` metadata; making the source publicly visible does not
grant an open-source license. Bundled Node.js and Python retain their upstream
licenses and provenance in the portable release. No new license is assigned
to third-party components.
