#!/usr/bin/env bash
set -euo pipefail

source "/home/migueldorosario/Downloads/Antigravity Google/Global South News/root/gsn_cron_env.sh"
cd "/home/migueldorosario/Downloads/Antigravity Google/Global South News/gsn"

if [[ -f tools/gsn_publish_paused.txt ]]; then
  pause_reason="$(head -c 240 tools/gsn_publish_paused.txt | tr '\n' ' ')"
  printf '[%s] GSN hourly publish skipped: publicacao automatica pausada (%s)\n' "$(date -Is)" "$pause_reason" >> logs/gsn_hourly_cron.log
  exit 0
fi

if [[ -f tools/loop_24h_until.txt ]]; then
  until_ts="$(cat tools/loop_24h_until.txt)"
  now_epoch="$(date +%s)"
  until_epoch="$(date -d "$until_ts" +%s 2>/dev/null || echo 0)"
  if [[ "$until_epoch" -gt 0 && "$now_epoch" -gt "$until_epoch" ]]; then
    printf '[%s] GSN hourly publish skipped: janela 24h encerrada em %s\n' "$(date -Is)" "$until_ts" >> logs/gsn_hourly_cron.log
    exit 0
  fi
fi

{
  printf '\n[%s] GSN hourly publish start\n' "$(date -Is)"
  "$GSN_PYTHON" scripts/gsn_zelador_destaques.py
  "$GSN_PYTHON" "../root/gsn_smoke_markdown.py" 15 --queue
  "$GSN_NPM" run gsn:publish-hourly
  printf '[%s] GSN hourly publish done\n' "$(date -Is)"
} >> logs/gsn_hourly_cron.log 2>&1
