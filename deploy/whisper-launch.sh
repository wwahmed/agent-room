#!/bin/sh
# Launch whisper-server with the model chosen in the app settings.
# The selected model basename is stored in ~/.agent-room/whisper-model
# (e.g. "ggml-medium.en.bin"); if unset or not downloaded, fall back safely.
set -eu
MODEL_DIR="$HOME/.cache/whisper"
CFG="$HOME/.agent-room/whisper-model"
DEFAULT="ggml-medium.en.bin"

MODEL_FILE="$DEFAULT"
if [ -f "$CFG" ]; then
  chosen="$(tr -d '[:space:]' < "$CFG" 2>/dev/null || true)"
  [ -n "$chosen" ] && MODEL_FILE="$chosen"
fi
# Fall back to whatever is actually present (medium → small → base).
if [ ! -f "$MODEL_DIR/$MODEL_FILE" ]; then
  for cand in ggml-medium.en.bin ggml-small.en.bin ggml-base.en.bin; do
    if [ -f "$MODEL_DIR/$cand" ]; then MODEL_FILE="$cand"; break; fi
  done
fi

exec /opt/homebrew/bin/whisper-server \
  -m "$MODEL_DIR/$MODEL_FILE" \
  --host 127.0.0.1 --port 8110
