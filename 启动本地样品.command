#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${MIYOU_TEMPLATE_PORT:-5173}"
URL="http://127.0.0.1:${PORT}/?planet=1&preview=1&owner=1"

cd "$ROOT"
if [[ -n "${TERM:-}" ]]; then
  clear
fi
print "\n🍊 Miyou Planet Template · Local Demo\n"
print "Project: $ROOT\n"

if ! command -v npm >/dev/null 2>&1; then
  print "❌ npm was not found. Install Node.js LTS first: https://nodejs.org/"
  print "\nPress any key to close…"
  read -k 1
  exit 1
fi

if [[ ! -d node_modules ]]; then
  print "📦 First run: installing dependencies…\n"
  npm install
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  print "🌐 A server already listens on port $PORT. Opening the sample page…"
  open "$URL"
  print "\nTo stop that server, close the terminal that started it."
  print "\nPress any key to close…"
  read -k 1
  exit 0
fi

print "🚀 Starting the local sample site…"
npm run demo -- --port "$PORT" --strictPort &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    open "$URL"
    print "\n✅ Browser opened: $URL"
    print "Keep this Terminal window open while using the sample site.\n"
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.25
done

print "❌ The local server did not become ready. Check the output above."
exit 1
