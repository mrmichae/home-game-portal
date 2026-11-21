# Home Game Portal for Apple TV

The native client source lives here with a testable `PortalCore` Swift package and an
XcodeGen tvOS application definition. The implementation candidate supports saved and
manual servers, Bonjour discovery, Device Pairing, Player Profile selection, native
Browse/Collections/Library/Search/detail/settings UI, physical-controller gating,
Playback Leases and takeover, verified temporary ROM downloads, local FCEUmm playback,
and a durable Checkpoint outbox. See
[`docs/apple-tv-build-status.md`](../docs/apple-tv-build-status.md) for the remaining
hardware, compatibility, resilience, and distribution gates.

## Generate and run

On a Mac with current Xcode, a matching command-line toolchain, and XcodeGen:

```sh
cd apple-tv
xcodegen generate
open HomeGamePortalTV.xcodeproj
```

Select a Development Team and run on an Apple TV 4K (second generation or later). The
target includes the local-network purpose string and `_homegameportal._tcp` Bonjour
declaration. Manual `hostname-or-IP:port` entry remains available when multicast DNS
does not cross a container or VLAN boundary.

The checked-in tvOS asset catalog contains layered app icons and both top-shelf image
sizes. Regenerate those deterministic assets after changing the portal mark with:

```sh
python3 Scripts/generate_brand_assets.py
```

## Current hard gate

The native target links a candidate FCEUmm revision through `FCEUmmCore`, but the web
build's EmulatorJS-produced FCEUmm binary does not record its exact upstream commit.
`vendor/fceumm/PIN.md` defines the required provenance and cross-client save-state gate.
Do not ship a TestFlight build until the candidate is replaced or proven equivalent and
the web-to-tvOS and tvOS-to-web state tests pass. The server advertises the shared format
as `provisional` for this reason.

The present workspace has only Command Line Tools, no tvOS SDK/full Xcode, and its Swift
compiler and macOS SDK patch versions do not match. Consequently the Swift target cannot
be compiled or signed in this environment; server and TypeScript verification remains
available through `npm run check`.
