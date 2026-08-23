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
  Differently hashed files with the same normalized title are retained as Editions of one Game
  rather than rendered as duplicate Shelf entries.
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
- Automatic SHA-256 Metadata Matches against a locally cached public NES catalog, with
  administrator corrections that survive rescans and a persistent same-origin artwork cache.
- An **Administration** area that keeps Metadata Management intact and displays
  platform-level Emulator Profiles for NES, SNES, and Atari 2600.
- One-click detail-to-play flow. The Playback Resolver silently selects FCEUmm for NES.
- Per-profile Keyboard, Joy-Con, Pro Controller, and Apple TV Remote presets. The friendly
  choice is resolved into EmulatorJS controls by the Playback Adapter on the next launch.
- Adaptive threaded FCEUmm playback when the browser exposes `SharedArrayBuffer`, with
  a compatible single-thread fallback when cross-origin isolation is unavailable.
- Two-minute, random launch URLs that reveal neither the Library Source nor relative file path.
- EmulatorJS browser persistence through its native **Save State** control plus an
  immutable server Checkpoint generation when the player chooses **Leave player**.
- A **Continue Playing** Shelf that resumes the newest compatible Checkpoint and
  automatically rolls back when a newer generation is unavailable or freezes the core.
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

## Docker / CasaOS-style startup

Docker Compose builds the production client and server into one image, exposes one HTTP
port, and runs Node as an unprivileged user with a read-only container filesystem. Copy
the example environment file and set the ROM path to an **absolute path on the Docker
host**:

```dotenv
ROM_LIBRARY_HOST_PATH=/path/on/docker-host/to/roms
PORT=8090
```

`ROM_LIBRARY_HOST_PATH` is used only for the host bind mount. Inside the container the
application always sees that Library Source at `/roms`. Do not use a network URL or a
path from a different computer.

Validate the resolved configuration, then build and start:

```sh
cp .env.example .env
# Edit .env before continuing.
docker compose config
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8090/health
```

The Compose definition exposes only HTTP, mounts `${ROM_LIBRARY_HOST_PATH}` at
`/roms:ro`, stores the SQLite database in `home-game-portal-data`, synchronized states
in `home-game-portal-saves`, and cached artwork in `home-game-portal-artwork`. It drops
Linux capabilities, enables `no-new-privileges`, limits process creation, uses a small
temporary filesystem, and retains the image health check.

Inside Docker, `/roms` is the initial Library Source. An existing database remains
authoritative; migration 007 moves the prototype’s former exact `/library` value to
`/roms` for compatibility with the new mount.

If host port 8090 is occupied, choose another `PORT` in `.env`; the container continues
to listen internally on 8090. Confirm that the selected port is reachable only from the
trusted LAN. The application does not provide authentication or HTTPS.

### Persistence, backup, and upgrades

Image rebuilds and container replacement do not remove the three explicitly named
volumes. Back them up before an upgrade. The following example creates gzip archives in
an existing `./backups` directory:

```sh
mkdir -p backups
docker run --rm -v home-game-portal-data:/source:ro -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/data.tgz -C /source .
docker run --rm -v home-game-portal-saves:/source:ro -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/saves.tgz -C /source .
docker run --rm -v home-game-portal-artwork:/source:ro -v "$PWD/backups:/backup" alpine \
  tar -czf /backup/artwork.tgz -C /source .
```

The ROM Library is not included because it remains external and read-only. To upgrade:

```sh
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${PORT:-8090}/health
```

SQLite migrations run at application startup. Keep the volume backups until the new
container has passed the browser workflow and a restart. Restoring an archive overwrites
persistent state, so stop the stack and inspect the target volume before performing a
restore.

CasaOS can import the Compose definition. Map the host's ROM directory to `/roms` as
read-only, retain `/data`, `/saves`, and `/artwork` as persistent storage, and expose
only the chosen host port. Do not map ROMs into a writable application directory.

## Player flow

1. Add a legally obtained `.nes` file to the mounted Library Source.
2. Select the Household administrator profile, open **Settings → Library**, and press
   **Rescan library**.
3. Open the game on the NES Shelf, then press **Play**.
4. Play with the keyboard or connected controller; no emulator selection appears.
5. Choose **Leave player** to capture a new immutable Checkpoint generation in `/saves`
   before navigating back to the Game detail view. EmulatorJS’s **Save State** control
   independently keeps a browser-local fallback.
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
the browser. For enrichment, the server downloads the public Retronian NES catalog to
`DATA_DIR/metadata` and performs hash comparisons locally; ROM bytes, filenames, and
hashes are not uploaded to Retronian, EmulatorJS, or another metadata provider.

## Verification

```sh
npm ci
npm run check
```

The automated suite covers recursive scanning and rescan discovery, filename
normalization, preferred-Edition launch resolution, scoped launch expiry, path
traversal rejection, symlink avoidance, per-profile Checkpoint generation retention,
runtime/Game File isolation, verification, rollback selection, Favorites,
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
- Migration 011 preserves legacy single-file Saves in the database and `/saves`, but
  deliberately does not advertise them as resumable Checkpoints because their Game File
  and runtime compatibility was never recorded. The next successful **Leave player**
  creates a versioned generation. Removing a title from Continue Playing deletes both
  versioned Checkpoints and legacy state for that Player Profile.
- Controller presets configure documented EmulatorJS defaults before startup. A browser
  may expose a particular Joy-Con orientation or third-party controller differently, so
  its built-in Control Settings screen is the fallback for unusual mappings.
- The Apple TV Remote preset can supply directional and action keys only where a browser
  or TV WebView exposes remote presses as keyboard-like events. A normal Safari page
  cannot make the remote appear as a standard web Gamepad.
- The ten profile avatars are an original, generated pixel-art sprite sheet stored with
  the application. They contain no console logos or copyrighted game characters.
- Filename parsing strips common release/region tags. The original versioned, local NES
  catalog is the preferred automatic source for its covered titles, using normalized
  matching so punctuation and article variants resolve deterministically. On rescan,
  SHA-256 values are also matched locally against the cached Retronian catalog for
  artwork and as enrichment fallback for previously uncurated titles. Administrator
  corrections always take precedence and can be opened from a Game detail page or
  **Settings → Administration → Metadata Management** without modifying a Game File.
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
- The first metadata-enabled scan downloads roughly 6 MB from Retronian and caches it in
  `DATA_DIR/metadata`. If that download is unavailable, scanning still succeeds with the
  local fallback; a later rescan retries. Archive scanning and firmware handling remain
  out of scope.
- Server persistence covers Checkpoints created by **Leave player**. Leave-time capture
  uses the pinned EmulatorJS runtime's `gameManager.getState()` method behind the
  Playback Adapter; this private compatibility point must be reverified before upgrading
  EmulatorJS. The native **Save State** control remains browser-local and is no longer
  intercepted, preserving an independent recovery path.
- Before EmulatorJS starts, the web Playback Adapter downloads and validates the scoped
  server Game File, then exposes it to the runtime through a revocable browser-local URL.
  This avoids EmulatorJS's opaque network failure behind some container/reverse-proxy
  deployments; the bytes still travel only from the Portal to the player's browser.
- The in-app **Leave player** action waits for server synchronization before navigating.
  Abruptly closing or reloading the browser tab cannot reliably await an asynchronous
  save request, so the most recent earlier checkpoint remains the recovery point.
- EmulatorJS keeps battery-backed save RAM in browser storage. Automatic server SRAM
  restore would require an undocumented startup injection API in 4.2.3, so it remains
  deferred behind the Playback Adapter rather than coupling it to the Catalog.
- Server Checkpoints are immutable and checksummed. The three newest compatible
  candidate/verified generations are retained; failed generations are excluded and the
  Playback Adapter tries the preceding generation automatically. Manual slots, cross-
  device conflict resolution, profile authentication, backups, and quota controls remain
  future work.
- Game File launch URLs are in-memory and expire after two minutes. The corresponding
  Checkpoint-capture session remains valid for up to 24 hours so normal play sessions can
  save on exit. Restarting Node invalidates outstanding URLs and capture sessions without
  affecting existing Checkpoints or the Catalog.
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
This decision is recorded in `docs/adr/0001-client-specific-emulator-adapters.md`;
runtime-scoped Checkpoint generations are recorded in
`docs/adr/0002-version-and-scope-checkpoints-by-runtime.md`.

## Material departures from the specification

There is one deliberate Milestone 1 narrowing: full automatic server-side SRAM sync is
not implemented because EmulatorJS 4.2.3 does not expose a documented startup SRAM
injection API. Server Checkpoint synchronization on **Leave player** is complete;
browser-native **Save State** persistence remains deliberately independent. The
leave-time capture call is contained behind `EmulatorJsPlaybackAdapter` and
`ResumeCoordinator`, preserving the seam for a future supported synchronization adapter.

The `/artwork` volume is now implemented for the persistent artwork cache. `/firmware`
remains omitted because this NES-only slice does not use firmware.

The original no-metadata-provider constraint was intentionally superseded by later
product iterations. Retronian metadata is downloaded and cached server-side, matching
occurs locally, and reviewed HTTPS artwork is cached on first access. This keeps Game
Files and their identifiers private while making newly discovered titles enrichable.

Milestone 2 is complete for the current application: search, Collections, Favorites, Play
Sessions, selectable Player Profiles, profile-scoped Saves and appearance, administrator
Metadata Match corrections, automatic provider matching, and persistent artwork caching
are functional. Profile authentication remains hardening/future-scope work.

This iteration adds the server-configuration and Emulator Profile foundation for
Milestone 3. It does not claim full Milestone 3 completion: additional Platform scanners,
firmware management, web Playback Adapters, and native-client implementations remain.
