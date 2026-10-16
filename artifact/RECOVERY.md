# RaceCert release and reproducibility notes

## Reconstruction scope

This release includes recovered source components and reconstructed components.
It is not a byte-for-byte restoration of the entire original demo package.
The published camera-ready PDF remains unchanged.

The producer, campaign generator and five live-profile definitions retain these
source SHA-256 checksums:

| Component | SHA-256 |
| --- | --- |
| `producer.js` | `09de8c91a5fb6bec1926f30f2b12099fe56b6d3f87eb7af03ffb7458f8369064` |
| `campaign.js` | `d1bb22f9bb35d9d98bfc2a99ba8e12b120b719584cb1003a80843d0c8f55f901` |
| `live-profiles.json` | `ebca33ef7003c31dab992f22e8eccf0dcff7b02e72631986353d08cded2d076a` |

The JavaScript and Python v2 verifiers were reconstructed from the wire schema
and the camera-ready equations. Neither verifier calls the producer. The
Python verifier uses standard-library `Fraction`, `hashlib` and `json`. Both
check the digest, exact interval, complete policy set, witness constraints and
every constituent certificate of a batch. These implementations have automated
tests but have not had an independent human audit.

The six frozen fixtures were reconstructed or converted from earlier inputs.
They cover decisive A/B, neutral, A-only, no-arrival and the published exact
censored-boundary case. They are stable fixtures for this release, not claimed
to be the original v2 fixture files.

The frontend, styles, runtime discovery and launchers include repairs for
portability and presentation. All three UDP sockets bind to loopback.
Socket/send failures terminate the capture rather than becoming false evidence
of a missing packet. Tests cover initialization/runtime failures, 18 widening
cases and 28 rehashed semantic/batch mutations. A runtime error is distinct
from a semantic rejection. Tests create and remove only their own temporary
directories.

## Retained campaign evidence

The deterministic xorshift64-v1 generator uses seed 20260812. Its 512 generated
races produce 176 force-A, 12 neutral, 191 force-B and 133 ambiguous outcomes.
There is no forced path majority. These are generated model inputs, not
captured phone, cellular or radio traces.

The retained raw data and batch reproduce their earlier bytes and checksums:

| Evidence | SHA-256 / semantic digest |
| --- | --- |
| Raw JSONL | `98132dcbf663943b29becd7b7f5ce1faddf2a901d5c72a04ea33283be6f9aaa3` |
| Batch JSON | `6e9a50c00949bcbf345262dd34ca801f8b6fe0d07e7c56b8495184acfcc5d771` |
| Batch semantic digest | `de9ca4ebb8c7327a8cb8c0b4f224de06fec52238fdb7d543338005a4cbed5eb4` |

Summary and manifest receipt formats can differ from earlier releases because
of the reconstructed verifiers. The raw data, certificates and batch digest
above are unchanged. Counts are computed, not hard-coded into the producer or
verifiers.

The guided teaching example and its sensitivity sweep are separate from both
the six fixtures and the retained campaign. The five live profiles perform
fresh loopback UDP acquisition. Live timing depends on operating-system
scheduling and does not have a promised fixed verdict. Budget validity and
capture provenance remain input declarations, not authenticated ground truth.

## Running and presenting

Run `CHECK_DEMO.cmd` before `START_DEMO.cmd`. The base URL and `/guided.html`
open the same guided booth. `/index.html` is the optional advanced explorer.
Windows x64 runtimes are included in the portable release ZIP. A source
checkout requires installed Node.js 20+ and Python 3. macOS and Linux have
not been tested on those operating systems in this release.
The package performs no downloads and needs no cloud account.

## Licensing

Project source is publicly visible but retains its UNLICENSED package metadata.
This release does not grant an open-source license. Upstream runtime notices
in the portable release remain intact:

- Node MIT and third-party notices: `runtime/win-x64/NODE-LICENSE.txt`.
- Python distribution license: `runtime/win-x64/python/LICENSE.txt`.
- Runtime versions, binary/archive checksums and upstream URLs:
  `runtime/RUNTIME-PROVENANCE.json`.
