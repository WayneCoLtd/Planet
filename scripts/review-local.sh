#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js。请安装 Node.js 18 或更高版本后重试。" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm。请安装 npm 后重试。" >&2
  exit 1
fi

NODE_VERSION="$(node -p "process.versions.node")"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "错误：当前 Node.js 为 $NODE_VERSION，需要 Node.js 18 或更高版本。" >&2
  exit 1
fi

PORT="${WWCXRL_PORT:-4173}"
while command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

LOG_FILE="$ROOT_DIR/.wwcxrl-review-preview.log"
PID_FILE="$ROOT_DIR/.wwcxrl-review-preview.pid"

printf '\n琛琳星球 · 检查者一键本地部署\n'
printf '%s\n' '--------------------------------'
printf 'Node.js: %s\n' "$NODE_VERSION"
printf '端口:    %s\n\n' "$PORT"

printf '%s\n' '[1/3] 安装依赖（可重复执行）...'
npm install

printf '%s\n' '[2/3] 构建与安全检查...'
npm run check

printf '%s\n' '[3/3] 启动本地预览服务...'
nohup npm run preview -- --host 127.0.0.1 --port "$PORT" >"$LOG_FILE" 2>&1 &
PID=$!
printf '%s\n' "$PID" > "$PID_FILE"

URL="http://127.0.0.1:${PORT}/?planet=1&preview=1&showGuide=1"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
    printf '\n部署完成，可以打开检查：\n\n  %s\n\n' "$URL"
    printf '服务 PID：%s\n日志文件：%s\n' "$PID" "$LOG_FILE"
    printf '\n停止服务：bash scripts/stop-review.sh\n'
    if [ "${WWCXRL_OPEN:-0}" = "1" ] && command -v open >/dev/null 2>&1; then
      open "$URL"
    fi
    exit 0
  fi
  sleep 1
done

echo "错误：本地预览服务未能在 30 秒内启动。最近日志：" >&2
sed -n '1,120p' "$LOG_FILE" >&2 || true
exit 1
