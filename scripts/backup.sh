#!/usr/bin/env bash
# Backup próprio do banco com pg_dump, independente do provedor (Neon, Postgres na VPS, Docker).
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/bgre RETENCAO_DIAS=30 ./scripts/backup.sh
#
# - formato custom (-Fc): comprimido e restaurável com pg_restore, inclusive só de algumas tabelas;
# - arquivo com permissão 600, escrito em .tmp e renomeado só depois de verificado (nunca fica backup pela metade);
# - apaga backups com mais de RETENCAO_DIAS dias (padrão 30).
# Com o Postgres do docker compose (sem pg_dump no host): BACKUP_VIA_DOCKER=1 ./scripts/backup.sh
set -euo pipefail
umask 077

DIR="${BACKUP_DIR:-$HOME/backups-bgre}"
RETENCAO="${RETENCAO_DIAS:-30}"
mkdir -p "$DIR"
ARQUIVO="$DIR/bgre-$(date -u +%Y%m%dT%H%M%SZ).dump"

if [ "${BACKUP_VIA_DOCKER:-0}" = "1" ]; then
  docker compose exec -T db pg_dump -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-bgre}" --format=custom --no-owner --no-acl > "$ARQUIVO.tmp"
else
  : "${DATABASE_URL:?Defina DATABASE_URL}"
  # O Prisma aceita ?schema=public; o pg_dump não.
  URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
  pg_dump --format=custom --no-owner --no-acl --file "$ARQUIVO.tmp" "$URL"
fi

# Só vale se o pg_restore consegue ler o índice do arquivo.
pg_restore --list "$ARQUIVO.tmp" > /dev/null
mv "$ARQUIVO.tmp" "$ARQUIVO"
find "$DIR" -maxdepth 1 -name 'bgre-*.dump' -type f -mtime "+$RETENCAO" -delete
echo "Backup ok: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"
