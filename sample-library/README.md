# Sample Library Source

This directory is safe to use as a local Library Source or mount read-only at `/roms`.

Place only game files you have the right to use under `nes/` or `snes/`, or point
`ROM_LIBRARY_PATH` at an existing library. Game and archive files below this directory
are ignored by Git and the Docker build context; no copyrighted games or firmware are
part of the source distribution.
