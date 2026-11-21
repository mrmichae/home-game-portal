# FCEUmm native source pin

Status: **release blocking — candidate source identified, exact provenance unresolved**

The web runtime vendors the FCEUmm core distributed by EmulatorJS 4.2.3. Its build report
records a build start of `2025-06-14T17:55:31Z`, while the bundled artifacts record hashes
in `THIRD_PARTY_NOTICES.md`. That is not enough to prove the exact libretro-fceumm commit,
compiler flags, core options, or serialization compatibility required for shared states.

The latest upstream commit before that timestamp is candidate
`3544ff567ecc417c170641587083b976739ef9db` (2025-05-01). Date proximity alone does not
prove that EmulatorJS's build pipeline used it, so it is intentionally not treated as a
verified pin.

`fetch-source.sh` retrieves that candidate archive and refuses it unless its SHA-256 is
`8a82dfcb78a43a01aef10266ebeef35bf8c1cdde6becabf01e5039c5fdfcdf82`.
That candidate is currently vendored under `source/` and linked into the tvOS target so
the native integration can be exercised while provenance is resolved.

Before distributing the native core:

1. Recover the exact upstream commit and build recipe used for the bundled WebAssembly.
2. Vendor that GPL-2.0 source revision here or add a reproducible fetch manifest with a
   cryptographic archive digest.
3. Confirm the tvOS arm64 build uses state-affecting options matching the web build.
4. Replace `source-pin-pending` in `NATIVE_CHECKPOINT_COMPATIBILITY` with the commit and
   update the format key to include the commit, serialization contract revision, and
   options fingerprint.
5. Run deterministic cross-client state tests in both directions before changing the
   `/api/v1/system` format status from `provisional` to `verified`.

Upstream: <https://github.com/libretro/libretro-fceumm> (GPL-2.0).
