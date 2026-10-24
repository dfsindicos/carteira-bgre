#!/usr/bin/env bash
# Restaura um backup (.dump) num banco VAZIO.
#
#   ./scripts/restaurar.sh arquivo.dump postgresql://usuario:senha@host:5432/banco_destino
#
# Recusa banco que já tem tabelas: restaurar sobre dado existente é decisão humana e deliberada.
# Para sobrescrever de propósito, apague o banco de destino antes (dropdb/createdb).
set -euo pipefail

ARQUIVO="${1:?Uso: restaurar.sh arquivo.dump postgresql://.../banco_destino}"
DESTINO="${2:?Informe a URL do banco de destino}"
URL="$(printf '%s' "$DESTINO" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

[ -f "$ARQUIVO" ] || { echo "Arquivo não encontrado: $ARQUIVO" >&2; exit 1; }
pg_restore --list "$ARQUIVO" > /dev/null || { echo "Arquivo de backup inválido" >&2; exit 1; }

EXISTENTES="$(psql "$URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$EXISTENTES" != "0" ]; then
  echo "O banco de destino já tem $EXISTENTES tabela(s). Restauração recusada (use um banco vazio)." >&2
  exit 1
fi

pg_restore --no-owner --no-acl --exit-on-error --dbname "$URL" "$ARQUIVO"
echo "Restauração concluída em: $(printf '%s' "$DESTINO" | sed -E 's#//[^@]*@#//***@#')"
