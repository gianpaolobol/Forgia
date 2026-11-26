#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
cache="${FORGIA_DEMO_CACHE:-$PWD/.data/demo-runtime}"
model="$cache/qwen2.5-0.5b-instruct-q4_k_m.gguf"
alias_name=qwen2.5-0.5b-instruct
runtime="${FORGIA_LLAMA_SERVER:-$(command -v llama-server || true)}"

download() {
  local url="$1" destination="$2" checksum="$3"
  if [[ ! -f "$destination" ]]; then
    curl --fail --location --retry 2 --output "$destination.part" "$url"
    printf '%s  %s\n' "$checksum" "$destination.part" | shasum -a 256 -c -
    mv "$destination.part" "$destination"
  fi
  printf '%s  %s\n' "$checksum" "$destination" | shasum -a 256 -c -
}

for port in 8080 8081 8787; do
  if curl --silent --connect-timeout 1 --max-time 2 --output /dev/null "http://127.0.0.1:$port/"; then
    printf 'La porta %s è già in uso. Chiudi il servizio esistente prima di avviare la demo.\n' "$port" >&2
    exit 1
  fi
done

mkdir -p "$cache"
if [[ -z "$runtime" ]]; then
  if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    printf 'Installa llama.cpp e rendi disponibile llama-server nel PATH.\n' >&2
    exit 1
  fi
  archive="$cache/llama-b12292-bin-ubuntu-x64.tar.gz"
  download 'https://github.com/ggml-org/llama.cpp/releases/download/b12292/llama-b12292-bin-ubuntu-x64.tar.gz' "$archive" \
    ffaf53f17a4601493e6ffb5869c9f0c7d400bb7e124fe0096eee3b65a5862568
  tar -xzf "$archive" -C "$cache"
  runtime="$cache/llama-b12292/llama-server"
fi
download 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf' "$model" \
  74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db

if [[ ! -x node_modules/.bin/expo ]]; then npm ci; fi
CI=1 EXPO_OFFLINE=1 npm run export:web

pids=()
cleanup() {
  if (( ${#pids[@]} )); then kill "${pids[@]}" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"$runtime" -m "$model" --alias "$alias_name" --host 127.0.0.1 --port 8080 -t 4 -c 4096 > "$cache/llama.log" 2>&1 &
pids+=("$!")
for ((attempt=0; attempt<60; attempt++)); do
  if curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:8080/health; then break; fi
  if ! kill -0 "${pids[0]}" 2>/dev/null; then tail -20 "$cache/llama.log" >&2; exit 1; fi
  sleep 1
done
curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:8080/health

# Avvio della demo con un solo motore, anche in un ambiente con chiavi già presenti.
OLLAMA_MODEL= GROQ_MODEL= OPENROUTER_MODEL= CLOUDFLARE_MODEL= LLAMACPP_MODEL="$alias_name" \
  node --experimental-strip-types server/main.ts &
pids+=("$!")
python3 -m http.server 8081 --bind 127.0.0.1 --directory dist &
pids+=("$!")
printf '\nApri http://127.0.0.1:8081 sullo stesso computer. Premi Ctrl+C per fermare la demo.\n'
while kill -0 "${pids[0]}" "${pids[1]}" "${pids[2]}" 2>/dev/null; do sleep 1; done
exit 1
