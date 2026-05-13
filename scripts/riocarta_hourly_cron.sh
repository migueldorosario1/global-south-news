#!/usr/bin/env bash
set -euo pipefail

cd "/home/migueldorosario/Downloads/Antigravity Google/Rio Carta Agentes/rio_carta"

{
  printf '\n[%s] Rio Carta hourly publish start\n' "$(date -Is)"
  npm run riocarta:publish-hourly
  printf '[%s] Rio Carta hourly publish done\n' "$(date -Is)"
} >> logs/rio_carta_hourly_cron.log 2>&1
