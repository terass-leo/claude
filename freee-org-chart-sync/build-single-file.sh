#!/bin/sh
# 分割された .gs を1ファイル（dist/Code.gs）に結合する。
# GASエディタへの貼り付けを1回で済ませたいとき用。分割のまま貼っても動作は同じ。
set -e
cd "$(dirname "$0")"
OUT=dist/Code.gs
{
  echo '/**'
  echo ' * freee人事労務 → Google スプレッドシート 組織図自動同期'
  echo ' * ※このファイルは build-single-file.sh が Config/Auth/FreeeApi/Normalize/Build/Diff/Sheets/Notify/Main を'
  echo ' *   結合して生成したものです。編集は各 .gs 側で行ってください。'
  echo ' */'
  for f in Config.gs Auth.gs FreeeApi.gs Normalize.gs Build.gs Diff.gs Sheets.gs Notify.gs Main.gs; do
    echo ''
    echo "// ===================== $f ====================="
    echo ''
    cat "$f"
  done
} > "$OUT"
echo "generated $OUT ($(wc -l < "$OUT") lines)"
