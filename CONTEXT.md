# Home Game Portal

The Home Game Portal organizes privately owned game files into a household-friendly catalog and resolves platform-appropriate playback without exposing storage or emulator internals to players.

## Language

**Library Source**:
A configured, read-only directory from which the Portal discovers Game Files for one Platform.
_Avoid_: ROM folder, upload folder

**Game File**:
A source file discovered inside a Library Source. It remains owned and managed outside the Portal.
_Avoid_: Upload, asset

**Platform**:
The game system identity and compatibility capability associated with an Edition, independent of any client’s emulator implementation.
_Avoid_: Core, emulator

**Emulator Profile**:
The household policy for resolving playback for a Platform, with client-specific runtime configuration where available.
_Avoid_: Game emulator setting, core selection

**Playback Adapter**:
A client-owned translator from a resolved Emulator Profile to that client’s emulator implementation.
_Avoid_: Platform, core

**Checkpoint**:
An immutable, runtime-specific snapshot captured for one Edition and Player Profile. Checkpoints are versioned, verified after restore, and may roll back to an earlier compatible generation.
_Avoid_: Game File, universally portable Save

**Metadata Match**:
The presentation metadata associated with a Game, including administrator corrections that survive Library Source scans.
_Avoid_: ROM metadata

**Collection**:
An administrator-owned group of related Games that can be browsed directly or used as a Browse Row source.
_Avoid_: Custom Collection, automatic Collection, Shelf, playlist

**Browse Row**:
An administrator-ordered presentation rule that resolves Games for the active Player Profile and appears as a horizontal shelf on Browse.
_Avoid_: Collection, hardcoded shelf
