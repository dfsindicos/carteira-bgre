#!/usr/bin/env bash
# Backup diário do banco na VPS (cron) e, se configurada, cópia para fora da máquina.
# Usa scripts/backup.sh dentro de um contêiner postgres:16 na rede do projeto: pg_dump da mesma versão do servidor, sem
# instalar cliente PostgreSQL no host e sem publicar a porta do banco.
set -euo pipefail
BASE=/opt/bgre
# shellcheck source=deploy/env.sh
. "$(dirname "$0")/env.sh"
DIR=/var/backups/bgre
PGPASSWORD="$(ler_env POSTGRES_PASSWORD)"
[ -n "$PGPASSWORD" ] || { echo "POSTGRES_PASSWORD ausente no .env" >&2; exit 1; }
export PGPASSWORD
RETENCAO_DIAS="$(ler_env RETENCAO_DIAS)"
docker run --rm --network bgre_default \
  -e PGPASSWORD -e BACKUP_DIR=/backups -e RETENCAO_DIAS="${RETENCAO_DIAS:-14}" \
  -e DATABASE_URL="postgresql://app@db:5432/bgre" \
  -v "$DIR:/backups" -v "$BASE/atual/scripts:/scripts:ro" \
  postgres:16-alpine bash /scripts/backup.sh
# A cópia externa não derruba o backup local: a falha fica no log (backup.log) e o "VPS: backup" → testar-copia-externa
# mostra a causa.
"$BASE/atual/deploy/enviar-backup.sh" || echo "ERRO: a cópia externa falhou; o backup local está em $DIR." >&2
