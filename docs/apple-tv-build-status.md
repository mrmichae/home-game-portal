# Apple TV v1 build status

Status as of 2026-09-03: **implementation candidate; not yet a TestFlight release**.

## Implemented

- Stable Portal Server identity, Bonjour advertisement, manual LAN endpoints, multiple
  saved servers, and local server edit/test/forget flows.
- Six-digit administrator-approved Device Pairing, Keychain credentials, revocation,
  rate limiting, and distinct unauthorized/revoked API errors.
- Profile-scoped native API for Catalog, server-defined Browse Rows, Collections,
  Favorites, Continue Playing, scoped Game File grants, Playback Leases, takeover,
  Checkpoint Lineages, and per-client restore attempts.
- Native SwiftUI screens for setup, pairing, profiles, Browse, Collections, My Library,
  Search, Game Details, Settings, conflict handling, and gameplay pause actions.
- A vendored candidate FCEUmm core, libretro C bridge, Game Controller input for two
  players, Metal/Core Image video, AVAudioEngine audio, ROM hash/header validation, and
  60-second/lifecycle checkpoint capture with protected local outbox storage.
- A generated tvOS Xcode project, local-network declarations, layered app icons, top
  shelf artwork, OpenAPI contract, database migrations, and server regression tests.

## Verified in this workspace

- `npm test`: 30 files and 98 tests pass.
- `npm run typecheck` and `npm run build`: pass.
- All Swift files pass the compiler parser.
- The C bridge compiles with warnings treated as errors.
- The complete candidate FCEUmm core compiles and links for macOS in an isolated build.
- The OpenAPI YAML, Info.plist, entitlements, generated project references, and all 13
  tvOS branding PNG dimensions validate.

## Release-blocking gates

1. Install/select full Xcode with the tvOS SDK, then compile the generated project and
   resolve any tvOS/Swift type-check issues. This machine currently has Command Line
   Tools only and a mismatched Swift compiler/macOS SDK, so it cannot build or sign tvOS.
2. Recover or reproduce the exact FCEUmm revision/options used by the web WebAssembly
   build. The linked native revision remains a dated candidate, not proven provenance.
3. Pass the deterministic web-to-tvOS and tvOS-to-web checkpoint suite, including
   rollback across three generations. Until then the shared format remains
   `provisional` and must not be presented as compatible.
4. Complete physical Apple TV verification for controllers, two-player disconnects,
   network loss, lifecycle behavior, audio/video timing, accessibility, and large
   Catalog performance.
5. Finish resilience/polish items that require the real target: cached offline browsing,
   checkpoint conflict recovery after lease loss, cooperative takeover signaling,
   custom controller remapping, diagnostic export, and full visual treatment for all
   seven profile themes.
6. Complete GPL/source review and current TestFlight/App Review metadata and reviewer
   access strategy before distribution.

## Next build command

With full Xcode installed:

```sh
cd apple-tv
xcodegen generate
open HomeGamePortalTV.xcodeproj
```

Select a Development Team, build the `HomeGamePortalTV` scheme for an Apple TV 4K, and
work through the release-blocking gates above before archiving for TestFlight.
