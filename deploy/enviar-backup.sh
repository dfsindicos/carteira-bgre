#!/usr/bin/env bash
# Cópia dos backups para FORA da VPS (decisão do usuário de 2026-10-21: OneDrive da DF, pelo rclone). Chamado pelo
# deploy/backup.sh depois do backup diário. Desligado com BACKUP_DESTINO vazio (variável BACKUP_DESTINO do GitHub, ex.:
# "onedrive:Backups/bgre"). Copia os dumps das últimas 48 h e apaga, SÓ nessa pasta e só os bgre-*.dump, os com
# mais de RETENCAO_EXTERNA_DIAS (padrão 30). Passo a passo em docs/operacao.md ("Cópia externa no OneDrive").
set -euo pipefail
# shellcheck source=deploy/env.sh
. "$(dirname "$0")/env.sh"
DIR="${BACKUP_DIR:-/var/backups/bgre}"
BACKUP_DESTINO="$(ler_env BACKUP_DESTINO)"
if [ -z "$BACKUP_DESTINO" ]; then
  echo "Cópia externa desligada (BACKUP_DESTINO vazio). Os backups ficam só em $DIR."
  exit 0
fi
exigir_destino "$BACKUP_DESTINO"
RETENCAO="$(ler_env RETENCAO_EXTERNA_DIAS)"
RETENCAO="${RETENCAO:-30}"
[[ "$RETENCAO" =~ ^[0-9]+$ ]] && [ "$RETENCAO" -ge 7 ] || { echo "RETENCAO_EXTERNA_DIAS inválido: $RETENCAO (mínimo 7)" >&2; exit 1; }

rclone copy "$DIR" "$BACKUP_DESTINO" --max-age 48h --include 'bgre-*.dump' --max-depth 1
rclone delete "$BACKUP_DESTINO" --min-age "${RETENCAO}d" --include 'bgre-*.dump' --max-depth 1
echo "Cópia externa ok: $BACKUP_DESTINO (retenção de $RETENCAO dias lá)"
