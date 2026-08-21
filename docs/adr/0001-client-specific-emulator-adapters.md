# Keep emulator implementations client-specific

The server owns Platform identity and a platform-level Emulator Profile, while each client owns the Playback Adapter that translates that profile into a runtime implementation. The current web profile resolves NES to EmulatorJS/FCEUmm, but a future Apple TV client may satisfy the same NES capability with a native core instead of inheriting the web implementation; emulator configuration therefore never belongs to an individual Game.
