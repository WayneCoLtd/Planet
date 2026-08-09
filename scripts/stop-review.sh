#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.miyou-review-preview.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "没有找到正在运行的琛琳星球检查服务。"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  echo "已停止本地检查服务 PID $PID。"
else
  echo "服务 PID $PID 已经结束。"
fi
rm -f "$PID_FILE"
