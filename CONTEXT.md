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

**Portal Server**:
A single running Home Game Portal installation that owns one household Catalog, its Player Profiles, presentation, play history, and Checkpoints. A client may remember several Portal Servers but interacts with only one active Portal Server at a time.
_Avoid_: Library Source, merged library

**Client Device**:
An installed client, such as one Apple TV installation, authorized by a Portal Server through Device Pairing. Authorization belongs to the installation rather than to a Player Profile.
_Avoid_: Player Profile, user account

**Device Pairing**:
A short-lived, administrator-approved exchange that registers a Client Device with one Portal Server and issues revocable device credentials.
_Avoid_: Player Profile selection, login

**Checkpoint**:
An immutable, runtime-specific snapshot captured for one Edition and Player Profile. Checkpoints are versioned, verified after restore, and may roll back to an earlier compatible generation.
_Avoid_: Game File, universally portable Save

**Checkpoint Format**:
The client-neutral compatibility identity for Checkpoint bytes, including the emulator core revision, serialization contract, and state-affecting configuration. Different Playback Adapters may share Checkpoints only when they implement the same proven Checkpoint Format.
_Avoid_: Playback Adapter, file extension

**Checkpoint Lineage**:
The ordered Checkpoint history that begins when a Player Profile starts or resumes one progression through an Edition. Starting New creates a new lineage while the previous lineage remains available for bounded recovery.
_Avoid_: manual save slot, Play Session

**Playback Lease**:
The server-issued, renewable right for one Client Device to play one Game for one Player Profile. A conflicting client must take over or wait; stale leases may not publish newer Checkpoints.
_Avoid_: launch URL, Play Session

**Metadata Match**:
The presentation metadata associated with a Game, including administrator corrections that survive Library Source scans.
_Avoid_: ROM metadata

**Collection**:
An administrator-owned group of related Games that can be browsed directly or used as a Browse Row source.
_Avoid_: Custom Collection, automatic Collection, Shelf, playlist

**Browse Row**:
An administrator-ordered presentation rule that resolves Games for the active Player Profile and appears as a horizontal shelf on Browse.
_Avoid_: Collection, hardcoded shelf
