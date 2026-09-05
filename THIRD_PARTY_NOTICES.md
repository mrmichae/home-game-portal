# Third-party notices

The application vendors the minimum NES- and SNES-capable files from EmulatorJS 4.2.3
so playback does not need the public CDN at runtime.

- EmulatorJS 4.2.3: <https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3>, GPL-3.0.
  License: `THIRD_PARTY_LICENSES/EmulatorJS-GPL-3.0.txt`.
- FCEUmm libretro core, distributed by the EmulatorJS 4.2.3 release: GPL-2.0.
  Source: <https://github.com/libretro/libretro-fceumm>.
  License: `THIRD_PARTY_LICENSES/FCEUmm-GPL-2.0.txt`.
- Snes9x libretro core, distributed by the EmulatorJS 4.2.3 release: personal and
  non-commercial-use license.
  Source: <https://github.com/snes9xgit/snes9x>.
  License: `THIRD_PARTY_LICENSES/Snes9x-License.txt`.
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
aa4a6a04db289194a1afd0c636560921a6141fb795a5ebe4db7fcdd3af0b6aa6  public/emulatorjs/cores/snes9x-thread-wasm.data
a42f3e39f4608ef65edaf7f803f1245bab9103c19417dbc3e4d00c5b09861bb4  public/emulatorjs/cores/snes9x-thread-wasm.upstream.7z
a46c955da3439609a4bb99129d2fcd0352b923681db503a46690ab2b98ebd0b8  public/emulatorjs/cores/snes9x-wasm.data
eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee  public/emulatorjs/cores/snes9x-wasm.upstream.7z
dc7ac963eb7935a7ac78956235ac0b8912ec785c57026336825aa2ed8031b3ad  public/emulatorjs/cores/reports/snes9x.json
63f67204bd65e2362594899e2526e955b8ee620722f7e511a08498236098ee99  public/emulatorjs/cores/snes9x_libretro.js
2bc7b519bc185af151cc7ebc42c0a926a125be174c6467c24bb0495820adf0bf  public/emulatorjs/cores/snes9x_libretro.wasm
46330c4a8b542dae427781fa5ca0cf24ec54ee1e67880a690976e9af28e54913  public/emulatorjs/cores/snes9x_thread_libretro.js
b61d83a5ecd8e40f45a73bb61ec531b4ec7dae81b7f4456f1729bf4ab080d7e4  public/emulatorjs/cores/snes9x_thread_libretro.wasm
70efeee282d82a6e9d26aeed5466d08c632369858371dc6a4644c8dcedc2be78  THIRD_PARTY_LICENSES/Snes9x-License.txt
```

No game, firmware, metadata, or artwork files are included.

`fceumm-wasm.data` is a ZIP containing the byte-identical JavaScript and WebAssembly
files extracted from the pinned upstream 7z archive. The original release archive is
kept beside it for provenance. EmulatorJS accepts both formats; ZIP avoids a 7z worker
failure observed in the Codex in-app browser. The extracted JavaScript wrapper and
WASM binary are also resolved directly by the Playback Adapter because that browser's
ZIP worker returned an undefined WASM payload. No core source or binary was modified.
The same packaging is used for the pinned compatible and threaded Snes9x runtimes. The
adapter selects a threaded core only when the browser exposes `SharedArrayBuffer` in a
cross-origin-isolated context.
The vendored loader also contains one compatibility line that registers EmulatorJS's
documented `EJS_onExit` callback; the 4.2.3 loader omitted that event binding.

Box-art URLs point to the public
[`libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System`](https://github.com/libretro-thumbnails/Nintendo_-_Nintendo_Entertainment_System)
repository. Artwork remains hosted by that project and is not copied into this application.
