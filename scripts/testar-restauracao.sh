#!/usr/bin/env bash
# Prova que o backup restaura: faz backup do banco de DATABASE_URL, restaura num banco temporário
# e compara a contagem de linhas de todas as tabelas. Roda no ambiente do servidor, de tempos em tempos.
#
#   DATABASE_URL=postgresql://... ./scripts/testar-restauracao.sh
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
ORIGEM="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
TEMP="bgre_restauracao_$(date +%s)"
ADMIN="$(printf '%s' "$ORIGEM" | sed -E "s#/[^/?]+(\\?.*)?\$#/postgres\\1#")"
TESTE="$(printf '%s' "$ORIGEM" | sed -E "s#/[^/?]+(\\?.*)?\$#/$TEMP\\1#")"
DIR="$(mktemp -d)"
trap 'psql "$ADMIN" -qc "drop database if exists \"$TEMP\"" >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

contagens() {
  local url="$1"
  psql "$url" -Atc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" |
    while read -r t; do echo "$t=$(psql "$url" -Atc "select count(*) from \"$t\"")"; done
}

BACKUP_DIR="$DIR" DATABASE_URL="$ORIGEM" "$AQUI/backup.sh"
psql "$ADMIN" -qc "create database \"$TEMP\""
"$AQUI/restaurar.sh" "$DIR"/bgre-*.dump "$TESTE"

contagens "$ORIGEM" > "$DIR/origem.txt"
contagens "$TESTE" > "$DIR/restaurado.txt"
if diff -q "$DIR/origem.txt" "$DIR/restaurado.txt" > /dev/null; then
  echo "RESTAURAÇÃO OK: $(wc -l < "$DIR/origem.txt") tabelas com a mesma contagem de linhas."
else
  echo "FALHA: contagens diferentes entre origem e restauração:" >&2
  diff "$DIR/origem.txt" "$DIR/restaurado.txt" >&2 || true
  exit 1
fi
