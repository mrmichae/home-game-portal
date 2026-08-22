# Third-party notices

The application vendors the minimum NES-capable files from EmulatorJS 4.2.3 so playback
does not need the public CDN at runtime.

- EmulatorJS 4.2.3: <https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3>, GPL-3.0.
  License: `THIRD_PARTY_LICENSES/EmulatorJS-GPL-3.0.txt`.
- FCEUmm libretro core, distributed by the EmulatorJS 4.2.3 release: GPL-2.0.
  Source: <https://github.com/libretro/libretro-fceumm>.
  License: `THIRD_PARTY_LICENSES/FCEUmm-GPL-2.0.txt`.
- Retronian GameDB: <https://github.com/retronian/retronian-gamedb>. The application
  downloads its Famicom/NES JSON catalog at runtime for local Metadata Matching. Data is
  CC BY-SA 4.0; code is MIT. The catalog is cached in persistent application data and is
  not distributed in this repository or container image.

Vendored asset SHA-256 checksums:

```text
5a160684067e5232c0baa2da81b759bcec667842cfe0021f74217898f086f35b  public/emulatorjs/loader.js
6aec3fd7bb2721255801b0a6af02e47e78b05e28a1822b1f213aacbd348abaee  public/emulatorjs/emulator.min.js
16406c60b2dc3b04ae9b115e308613e6f567a0cc7068e21d9d0c1e5030fb395e  public/emulatorjs/emulator.min.css
db234806a6421b3f150f48455c559f58c1e4422caab93115d6be622036554d2c  public/emulatorjs/cores/fceumm-wasm.data
8c449fd5c36646fb0769423ed6ffa9efbdfc21fbfdc9bac7952b559d34d5b493  public/emulatorjs/cores/fceumm-wasm.upstream.7z
13dbbfba0ea1bea087c97c38f47dd49c3fb8f16c3f5ed5678dd75d352b737132  public/emulatorjs/cores/reports/fceumm.json
53e059d5e069a7f2c7bf63272e157934cf14c0da5b2b94e8272810ca50c167ed  public/emulatorjs/cores/fceumm_libretro.js
2506285b7d10c8edfee17961e83e44dbaed9b2389199844c2c097d16b3b0a6f1  public/emulatorjs/cores/fceumm_libretro.wasm
9da3e1abbe24f1b86504f967579389bc977ff5f95c73ebcbd66c2072a2c22562  public/emulatorjs/cores/fceumm-thread-wasm.data
12f2fd86d7c89b0c348daa7c4ba5310cf7a31bd779ddc08fbaa2ff37864aa4ce  public/emulatorjs/cores/fceumm_thread_libretro.js
90591956c948ab34867d15dc43b573faa0606503e7436fda5f153c904eced6f7  public/emulatorjs/cores/fceumm_thread_libretro.wasm
```

No game, firmware, metadata, or artwork files are included.

`fceumm-wasm.data` is a ZIP containing the byte-identical JavaScript and WebAssembly
files extracted from the pinned upstream 7z archive. The original release archive is
kept beside it for provenance. EmulatorJS accepts both formats; ZIP avoids a 7z worker
failure observed in the Codex in-app browser. The extracted JavaScript wrapper and
WASM binary are also resolved directly by the Playback Adapter because that browser's
ZIP worker returned an undefined WASM payload. No core source or binary was modified.
The same packaging is used for the pinned threaded FCEUmm runtime; the adapter selects
it only when the browser exposes `SharedArrayBuffer` in a cross-origin-isolated context.
The vendored loader also contains one compatibility line that registers EmulatorJS's
documented `EJS_onExit` callback; the 4.2.3 loader omitted that event binding.

Box-art URLs point to the public
[`libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System`](https://github.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System)
repository. Artwork remains hosted by that project and is not copied into this application.
