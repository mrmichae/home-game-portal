# Share checkpoints through client-neutral formats

The Portal will identify restorable Checkpoint bytes with a client-neutral Checkpoint Format rather than with the Playback Adapter that captured them. A Checkpoint Format fixes the emulator core revision, serialization contract, and every state-affecting option. The capturing client and app build remain diagnostic metadata, not compatibility criteria.

The web and Apple TV Playback Adapters may advertise the same Checkpoint Format only after automated fixtures and physical-device tests prove restore compatibility in both directions. Until that proof exists, they advertise separate formats and cannot satisfy the cross-client-resume release gate.

A restore failure is recorded for the failing client build and does not delete globally valid Checkpoint bytes. The server rejects a Checkpoint globally only when its stored length or digest fails validation, or when an administrator explicitly removes it. Clients fall back through compatible generations after a failed attempt.

This refines ADR 0002. Checkpoints remain scoped to Player Profile, Edition, Game File content hash, and a pinned compatibility identity, but Playback Adapter identity is no longer part of that compatibility identity. This preserves client-specific emulator implementations while allowing two independently implemented adapters to exchange proven-compatible state.
