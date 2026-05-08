#!/usr/bin/env bash
#
# generate-proxies.sh
#
# Generates 960x540 H.264 editing proxies from source video files.
# Audio files are copied as-is — no transcoding needed.
# Output structure mirrors source structure under <proxy-dir>.
#
# Usage:
#   ./scripts/generate-proxies.sh <source-dir> <proxy-dir>
#
# Example:
#   ./scripts/generate-proxies.sh ~/Projects/my-project/public ~/Projects/my-project/public/proxies
#
# The proxy directory will mirror the source structure:
#   <source>/recordings/clip.mp4    → <proxy>/recordings/clip.mp4
#   <source>/broll/timed/b.mov      → <proxy>/broll/timed/b.mp4   (extension normalized to .mp4)
#   <source>/audio/voice.m4a        → <proxy>/audio/voice.m4a     (copied as-is)
#
# After generating proxies, use the SDK's relinkForEditing():
#   await openreel.relinkForEditing('/path/to/source', '/path/to/proxies')
#

set -euo pipefail

SRC="${1:-}"
PROXY="${2:-}"

if [[ -z "$SRC" || -z "$PROXY" ]]; then
  echo "Usage: $0 <source-dir> <proxy-dir>"
  echo ""
  echo "  source-dir   Directory containing your original full-res assets"
  echo "  proxy-dir    Output directory for 960x540 proxy files"
  exit 1
fi

SRC="$(cd "$SRC" && pwd)"
mkdir -p "$PROXY"
PROXY="$(cd "$PROXY" && pwd)"

if [[ "$PROXY" == "$SRC" || "$PROXY" == "$SRC/"* ]]; then
  echo "ERROR: proxy-dir cannot be inside source-dir (would create infinite loop)"
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: ffmpeg not found."
  echo "  Install: brew install ffmpeg   (macOS)"
  echo "  Install: sudo apt install ffmpeg   (Linux)"
  exit 1
fi

VIDEO_EXTS_RE="\.(mp4|mov|webm|mkv|avi)$"
AUDIO_EXTS_RE="\.(mp3|m4a|wav|aac|flac)$"

skipped=0
proxied=0
copied=0
failed=0

echo "Source: $SRC"
echo "Proxies: $PROXY"
echo ""

while IFS= read -r -d '' src_file; do
  # Relative path from source root
  rel="${src_file#$SRC/}"
  base="${rel%.*}"
  ext_lower="${rel##*.}"
  ext_lower="${ext_lower,,}"  # lowercase

  if [[ "$rel" =~ $VIDEO_EXTS_RE ]]; then
    # Normalize extension to .mp4 — relinkForEditing() expects .mp4 proxies
    dest="$PROXY/${base}.mp4"
    mkdir -p "$(dirname "$dest")"

    if [[ -f "$dest" ]]; then
      printf "  SKIP  %s\n" "$rel"
      ((skipped++)) || true
    else
      printf "  PROXY %s → %s.mp4\n" "$rel" "$base"
      if ffmpeg -i "$src_file" \
        -vf "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2" \
        -c:v libx264 -preset ultrafast -crf 28 \
        -an \
        -movflags +faststart \
        -y "$dest" 2>/dev/null; then
        ((proxied++)) || true
      else
        printf "  FAIL  %s\n" "$rel" >&2
        ((failed++)) || true
      fi
    fi

  elif [[ "$rel" =~ $AUDIO_EXTS_RE ]]; then
    dest="$PROXY/$rel"
    mkdir -p "$(dirname "$dest")"

    if [[ -f "$dest" ]]; then
      printf "  SKIP  %s\n" "$rel"
      ((skipped++)) || true
    else
      printf "  COPY  %s\n" "$rel"
      cp "$src_file" "$dest"
      ((copied++)) || true
    fi
  fi

done < <(find "$SRC" -type f \( \
  -iname "*.mp4" -o -iname "*.mov" -o -iname "*.webm" -o -iname "*.mkv" -o -iname "*.avi" \
  -o -iname "*.mp3" -o -iname "*.m4a" -o -iname "*.wav" -o -iname "*.aac" -o -iname "*.flac" \
\) -not -path "$PROXY/*" -print0)

echo ""
echo "Done."
echo "  Proxied: $proxied video files"
echo "  Copied:  $copied audio files"
echo "  Skipped: $skipped (already existed)"
[[ $failed -gt 0 ]] && echo "  Failed:  $failed (see errors above)" || true
echo ""
echo "Next step:"
echo "  const { openreel } = await import('./openreel-sdk.mjs');"
echo "  await openreel.relinkForEditing('$SRC', '$PROXY');"
