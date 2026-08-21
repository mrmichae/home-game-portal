# Home Game Portal

> **Pre-release software for a trusted home network.** See the security and persistence
> limitations below before exposing it beyond the LAN.

This is a working TypeScript/React/Node/SQLite slice of the attached product
specification. It scans one read-only NES Library Source, builds a controller-friendly
Nintendo Entertainment System Shelf, resolves a preferred Edition internally, and
launches it in a pinned, self-hosted EmulatorJS player. No metadata account or player
emulator choice is required.

## What works

- Recursive, read-only discovery of `.nes` files, with content hashes and filename-based titles.
- A persistent **Settings → Library** location with server-side directory/readability
  validation and administrator-controlled rescans.
- SQLite Catalog with explicit migrations and stable Game/Edition/Game File vocabulary.
- Streaming-service-style featured content, horizontal rails, poster art, release years,
  descriptions, and useful empty/loading/rescan/playback-error states.
- On-brand search across Game name, Platform, genre, Series, and Collection universe.
- A persistent pill navigation bar with Browse, Collections, My Library, and Settings;
  Continue Playing remains a Browse Shelf rather than a duplicate destination.
- Fully administrator-owned Collections with dedicated browse views and brighter
  background artwork. The initial Series/universe groups are imported once, after which
  every Collection can be renamed, regrouped, or removed.
- A dedicated streaming-style **Who’s playing?** screen with ten original retro avatars,
  profile creation/editing, and separate Favorites, Play Session history, Saves, and
  appearance preferences; the Household profile remains the administrator.
- Seven bold themes, including an adjustable Portal accent and graphic-heavy
  8-bit/NES/SNES/Genesis/N64/Atari-adjacent treatments.
- A dedicated **My Library** grid, alphabetized by default, with title, release-year,
  recently-played, and recently-added sorting.
- Administrator-managed Browse Rows for Favorites, Continue Playing, Recently Played,
  all games, genre rules, or any Collection. Rows can be created, edited, removed, and
  reordered without changing code. Continue entries can still be removed with a
  confirmation that also deletes the Save.
- A Featured title that stays stable while a player browses and rotates whenever a
  Player Profile is selected again.
- Administrator Metadata Match corrections that survive rescans, plus a persistent,
  same-origin artwork cache.
- An **Administration** area that keeps Metadata Management intact and displays
  platform-level Emulator Profiles for NES, SNES, and Atari 2600.
- One-click detail-to-play flow. The Playback Resolver silently selects FCEUmm for NES.
- Per-profile Keyboard, Joy-Con, Pro Controller, and Apple TV Remote presets. The friendly
  choice is resolved into EmulatorJS controls by the Playback Adapter on the next launch.
- Adaptive threaded FCEUmm playback when the browser exposes `SharedArrayBuffer`, with
  a compatible single-thread fallback when cross-origin isolation is unavailable.
- Two-minute, random launch URLs that reveal neither the Library Source nor relative file path.
- EmulatorJS browser persistence plus a server checkpoint when the player chooses
  **Leave player** or **Save State**.
- A **Continue Playing** Shelf that resumes Games with a synchronized checkpoint.
- Administrator-triggered rescan detects added or removed files without an image rebuild.
- `/health` and `/api/health` endpoints.
- A single production HTTP port, default `8090`.

## Local startup

Requires Node.js 22.13 or newer.

```sh
cp .env.example .env
npm ci
npm run dev
```

Set `ROM_LIBRARY_PATH` in `.env` to the initial local NES library. Use a path that is
readable by the account running Node, for example:

```dotenv
ROM_LIBRARY_PATH=/path/to/your/roms
```

This environment value initializes a fresh database. After that, the Household
administrator can change the authoritative location under **Settings → Library**;
the value persists in SQLite across restarts.

Open the Vite address printed by `npm run dev` (by default `http://127.0.0.1:5173`).
Vite proxies API requests to `DEV_SERVER_URL`; the server scans at startup and
**Rescan library** runs another scan.

To exercise the exact production build without Docker:

```sh
npm run build
npm start
```

Then open `http://<HOST>:<PORT>` using the values in `.env`. When `HOST=0.0.0.0`, use
the machine's hostname or IP address in the browser rather than the bind address.

Configuration is resolved relative to the application directory, not the shell's
current working directory. `DATA_DIR`, `SAVES_DIR`, and `ARTWORK_DIR` are writable
persistent state; `ROM_LIBRARY_PATH` is scanned read-only. Keep those locations
separate in production.

## Existing Docker / CasaOS-style startup

The repository already contains prototype container definitions from earlier work.
They were not created or redesigned during this release-hygiene pass. Use a path local
to the Docker host for the bind-mounted library:

```dotenv
ROM_LIBRARY_PATH=/path/on/docker-host/to/roms
PORT=8090
```

Then build and start:

```sh
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:8090/health
```

The Compose definition exposes only HTTP, mounts `${ROM_LIBRARY_PATH}` at `/roms:ro`,
stores the SQLite database in `portal-data`, synchronized states in `portal-saves`, and
cached artwork in `portal-artwork`. It uses a read-only container root and runs Node as
the image's unprivileged `node` user.

Inside Docker, `/roms` is the initial Library Source. An existing database remains
authoritative; migration 007 moves the prototype’s former exact `/library` value to
`/roms` for compatibility with the new mount.

If the host port is already occupied, choose another `PORT` before starting Compose.

## Player flow

1. Add a legally obtained `.nes` file to the mounted Library Source.
2. Select the Household administrator profile, open **Settings → Library**, and press
   **Rescan library**.
3. Open the game on the NES Shelf, then press **Play**.
4. Play with the keyboard or connected controller; no emulator selection appears.
5. Choose **Leave player** to capture the latest state and write it to `/saves` before
   navigating back to the Game detail view. **Save State** creates the same checkpoint
   without leaving.
6. The Game appears under **Continue Playing**. On the next launch, the Playback
   Adapter supplies the server state to EmulatorJS automatically.

Controller preferences live under **Settings → Controller**. Keyboard uses arrow keys,
Z (A), X (B), Enter (Start), and V (Select). Joy-Con and Pro Controller presets also
provide the standard browser Gamepad mappings. Because browser/OS button identifiers can
vary, the pinned player's **Control Settings** screen remains available for one-off
remapping. **Check controllers** reports devices currently visible to the browser.

Presentation controls live under **Settings → Administration → Browse & Collections**.
Collections are reusable groups of selected Games, and every Collection is editable.
Browse Rows are independent ordered rules: removing a normal row does not remove its
Collection, while removing a Collection also removes any row that directly depends on
it. Neither operation changes Game Files, Saves, Favorites, or play history.

Leaving the player intentionally performs a normal document navigation rather than a
client-side route transition. EmulatorJS 4.2.3 owns page-global runtime state; a clean
document boundary guarantees that its audio and WebAssembly workers are discarded
before the catalog renders again.

The portal never writes to, renames, deletes, or sends a source game to an external
service. The browser downloads game bytes from this portal because emulation runs in
the browser; nothing is uploaded to EmulatorJS or a metadata provider.

## Verification

```sh
npm ci
npm run check
```

The automated suite covers recursive scanning and rescan discovery, filename
normalization, preferred-Edition launch resolution, scoped launch expiry, path
traversal rejection, symlink avoidance, per-profile save-state round trips, Favorites,
Play Sessions, library sorting, search matching, Collection generation, Metadata Match
corrections, artwork caching, avatar validation, Player Profile identity updates,
deployment-default precedence, persisted Library Source changes, validation failures,
read-only location-change rescans, and platform-level Emulator Profile resolution.
The suite also covers Collection materialization and persistence, Collection-backed Browse Row
resolution, default row seeding without title-specific shelves, row ordering validation,
and Featured-title selection.

For a real playback check, follow the player flow with a legal `.nes` file and confirm
that the game produces video/input, a saved state survives a browser restart, and a
new file appears after rescan. No ROM is checked into this repository.

## Assumptions and known limitations

- One configured Library Source and one preferred Edition per Game remain intentional
  current limits. NES playback is enabled; SNES and Atari 2600 Emulator Profiles are
  visible but deliberately disabled until their scanners, adapters, and save behavior
  are implemented and verified.
- Player Profiles are household-local and not authenticated. Selecting the Household
  administrator profile grants Metadata Match controls, so this build must remain on a
  trusted LAN until profile PINs or another authorization layer exists.
- Existing Household Saves retain their original `household/<game-id>` location. New
  profiles receive isolated Save directories and independent Favorites, Play Sessions,
  themes, accent preferences, and controller presets.
- Controller presets configure documented EmulatorJS defaults before startup. A browser
  may expose a particular Joy-Con orientation or third-party controller differently, so
  its built-in Control Settings screen is the fallback for unusual mappings.
- The Apple TV Remote preset can supply directional and action keys only where a browser
  or TV WebView exposes remote presses as keyboard-like events. A normal Safari page
  cannot make the remote appear as a standard web Gamepad.
- The ten profile avatars are an original, generated pixel-art sprite sheet stored with
  the application. They contain no console logos or copyrighted game characters.
- Filename parsing strips common release/region tags. Release years, descriptions,
  Series, and universe memberships begin with a curated local table; an
  administrator can correct presentation metadata without modifying a Game File.
- Collections and Browse Rows are household-wide administrator configuration.
  Personal row content such as Continue Playing, Favorites, and Recently Played is
  resolved separately for the active Player Profile; empty rows remain hidden.
- On the first run of migration 009, current metadata-derived Series/universe groups are
  materialized as ordinary Collections. This is intentionally a one-time import: later
  metadata changes do not silently recreate, overwrite, or repopulate administrator-owned
  Collections.
- Artwork is fetched from its configured HTTPS source on first request and cached in
  `ARTWORK_DIR`. If a cache fetch fails, the endpoint temporarily redirects to the
  source, so uncached art can still require internet access.
- There is no automatic metadata provider search, archive scanning, or firmware handling.
- Server persistence covers checkpoints created by **Leave player** and **Save State**.
  Leave-time capture uses the pinned EmulatorJS runtime's `gameManager.getState()`
  method behind the Playback Adapter; this private compatibility point must be
  reverified before upgrading EmulatorJS.
- The in-app **Leave player** action waits for server synchronization before navigating.
  Abruptly closing or reloading the browser tab cannot reliably await an asynchronous
  save request, so the most recent earlier checkpoint remains the recovery point.
- EmulatorJS keeps battery-backed save RAM in browser storage. Automatic server SRAM
  restore would require an undocumented startup injection API in 4.2.3, so it remains
  deferred behind the Playback Adapter rather than coupling it to the Catalog.
- The latest server state is overwritten atomically. There are no slots, Save history,
  conflict resolution, profile authentication, backups, or quota controls.
- Launch URLs are in-memory and expire after two minutes. Restarting Node invalidates
  outstanding URLs without affecting saves or the Catalog.
- The scanner hashes every discovered file and ignores symlinks. Large libraries will
  eventually need incremental/background job controls.
- The built-in Node 22 `node:sqlite` API is used to keep the container small. It emits
  an experimental warning on Node 22 but stores a standard SQLite database.
- The pinned FCEUmm release files are repackaged from the upstream 7z archive into an
  otherwise identical ZIP. Both compatible and threaded JavaScript/WASM runtimes are
  resolved directly by the adapter because the tested browser's archive worker dropped
  the WASM payload. This is an adapter-local compatibility measure; checksums and the
  untouched compatible upstream archive are recorded in `THIRD_PARTY_NOTICES.md`.
- Threaded playback requires `SharedArrayBuffer`. The server sends the required COOP
  and COEP headers, but browsers expose it only in a secure context (`localhost` or
  HTTPS). Plain `http://192.168.x.x` deployment therefore uses the compatible fallback;
  put the one HTTP port behind a local HTTPS reverse proxy for threaded LAN playback.
- LAN-only operation is assumed. Authentication and HTTPS are required before any
  remote exposure.

## Emulator Profile architecture and future Apple TV clients

`Platform` identifies the system and an emulation capability; it does not name a core.
An `EmulatorProfile` stores the automatic playback policy once per Platform and may
contain client-specific runtime configuration. The current web configuration resolves
NES to EmulatorJS/FCEUmm, and the browser Playback Adapter translates that resolved fact
into EmulatorJS globals.

The server launch manifest carries Platform identity and Emulator Profile policy
separately from its web-only runtime fields. A future native Apple TV client can use the
same Platform capability while supplying its own native Playback Adapter and compatible
core. It is not required to embed EmulatorJS or honor the browser’s FCEUmm implementation.
This decision is recorded in `docs/adr/0001-client-specific-emulator-adapters.md`.

## Material departures from the specification

There is one deliberate Milestone 1 narrowing: full automatic server-side SRAM sync is
not implemented because EmulatorJS 4.2.3 does not expose a documented startup SRAM
injection API. Server save-state synchronization on **Leave player** and **Save State**
is complete. The leave-time capture call is contained inside
`EmulatorJsPlaybackAdapter`, preserving the seam for a future supported synchronization
adapter.

The `/artwork` volume is now implemented for the persistent artwork cache. `/firmware`
remains omitted because this NES-only slice does not use firmware.

The original no-metadata-provider constraint was intentionally superseded by later
  product iterations: current-library descriptions and release years are bundled, and
reviewed HTTPS artwork is cached locally on first access. This keeps Game Files private
and creates the persistence seam for a future provider-backed Metadata Match workflow.

Milestone 2 is complete for the current application: search, Collections, Favorites, Play
Sessions, selectable Player Profiles, profile-scoped Saves and appearance, administrator
Metadata Match corrections, and persistent artwork caching are functional. Profile
authentication and automated provider matching remain hardening/future-scope work.

This iteration adds the server-configuration and Emulator Profile foundation for
Milestone 3. It does not claim full Milestone 3 completion: additional Platform scanners,
firmware management, web Playback Adapters, and native-client implementations remain.
