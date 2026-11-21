#!/bin/sh
set -eu

revision=3544ff567ecc417c170641587083b976739ef9db
expected=8a82dfcb78a43a01aef10266ebeef35bf8c1cdde6becabf01e5039c5fdfcdf82
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination="$script_dir/source"

if [ -e "$destination" ]; then
  echo "FCEUmm source already exists at $destination" >&2
  exit 1
fi

archive=$(mktemp -t home-game-portal-fceumm.XXXXXX)
staging=$(mktemp -d -t home-game-portal-fceumm-source.XXXXXX)
trap 'rm -f "$archive"; rm -rf "$staging"' EXIT INT TERM

curl -L --fail --silent --show-error \
  "https://github.com/libretro/libretro-fceumm/archive/$revision.tar.gz" \
  -o "$archive"

actual=$(shasum -a 256 "$archive" | awk '{print $1}')
if [ "$actual" != "$expected" ]; then
  echo "FCEUmm archive digest mismatch: expected $expected, received $actual" >&2
  exit 1
fi

mkdir "$staging/source"
tar -xzf "$archive" --strip-components=1 -C "$staging/source"
mv "$staging/source" "$destination"
echo "Fetched FCEUmm $revision into $destination"
