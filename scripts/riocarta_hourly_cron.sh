#!/usr/bin/env bash
set -euo pipefail

cd "/home/migueldorosario/Downloads/Antigravity Google/Rio Carta Agentes/rio_carta"

if [[ -f tools/loop_24h_until.txt ]]; then
  until_ts="$(cat tools/loop_24h_until.txt)"
  now_epoch="$(date +%s)"
  until_epoch="$(date -d "$until_ts" +%s 2>/dev/null || echo 0)"
  if [[ "$until_epoch" -gt 0 && "$now_epoch" -gt "$until_epoch" ]]; then
    printf '[%s] Rio Carta hourly publish skipped: janela 24h encerrada em %s\n' "$(date -Is)" "$until_ts" >> logs/rio_carta_hourly_cron.log
    exit 0
  fi
fi

{
  printf '\n[%s] Rio Carta hourly publish start\n' "$(date -Is)"
  npm run riocarta:publish-hourly
  printf '[%s] Rio Carta hourly publish done\n' "$(date -Is)"
} >> logs/rio_carta_hourly_cron.log 2>&1
