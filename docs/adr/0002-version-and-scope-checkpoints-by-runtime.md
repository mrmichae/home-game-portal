# Version and scope checkpoints by client runtime

The Portal stores each Checkpoint as an immutable generation associated with the Player Profile, Edition, Game File content hash, Playback Adapter, core key, and pinned runtime version. A newly captured generation is a candidate; a client promotes it after a successful restore. Failed candidates are rejected and the client tries the next compatible generation. The server retains the three newest restorable generations and never overwrites the last-known-good file in place.

For the web client, "successful restore" means sustained emulated-frame progress, not merely a load call or one changing frame. The same health rule gates capture so a stalled runtime cannot replace a good generation. A deliberately paused runtime remains eligible for capture. Runtime versions must change when a prior player policy could have promoted or captured semantically bad states; old generations are preserved but excluded from automatic restore under the new version.

Checkpoint bytes are opaque and runtime-specific. An EmulatorJS/FCEUmm Checkpoint is not assumed to be loadable by another web runtime or a future native Apple TV Playback Adapter. A future client can create its own separately keyed generations while sharing Platform, Game, Edition, and Player Profile identity. Battery-backed save RAM remains a separate future synchronization concern because it may have different portability guarantees.

Legacy single-file `saves` rows and files are preserved during migration but are not automatically advertised as resumable Checkpoints. A fresh **Leave player** capture creates the first versioned generation. Removing a title from Continue Playing deletes both versioned Checkpoints and any legacy state for that Player Profile.
