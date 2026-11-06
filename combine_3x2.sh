#!/usr/bin/env bash
set -e
FF="C:/pinokio/bin/miniforge/Library/bin/ffmpeg.exe"

V1="C:/Users/petra/Videos/Screen Recordings/Screen Recording 2026-09-05 124658.mp4"
V2="C:/Users/petra/Videos/Screen Recordings/Screen Recording 2026-09-15 122204.mp4"
V3="C:/Users/petra/Videos/Screen Recordings/Screen Recording 2026-09-15 094108.mp4"
V4="C:/Users/petra/Videos/Screen Recordings/Screen Recording 2026-09-06 133955.mp4"
V5="C:/Users/petra/Videos/Screen Recordings/Screen Recording 2026-09-06 002625.mp4"
V6="C:/Users/petra/Downloads/2026-09-14 12-37-04.mp4"
OUT="C:/Users/petra/Videos/combinado-3x2.mp4"

# Filtro de escala: cada video se ajusta (fit) a 1920x1280 (3:2) manteniendo aspecto,
# se centra con pad negro, se fuerza 30fps y SAR=1. Audio normalizado a stereo 44.1k.
FILTER="\
[0:v]scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v0];\
[1:v]scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v1];\
[2:v]scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v2];\
[3:v]scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v3];\
[4:v]scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v4];\
[5:v]scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v5];\
[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0];\
[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a1];\
[2:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a2];\
[3:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a3];\
[4:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a4];\
[5:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a5];\
[v0][a0][v1][a1][v2][a2][v3][a3][v4][a4][v5][a5]concat=n=6:v=1:a=1[v][a]"

"$FF" -y \
  -i "$V1" -i "$V2" -i "$V3" -i "$V4" -i "$V5" -i "$V6" \
  -filter_complex "$FILTER" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  "$OUT"

echo "=== LISTO ==="
"$FF" -hide_banner 2>&1 | head -1 || true
ls -la "$OUT"