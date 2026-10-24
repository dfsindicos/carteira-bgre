#!/usr/bin/env bash
# Prova que o backup da VPS restaura: backup → banco temporário → mesma contagem de linhas em todas as tabelas.
# Rodado pelo workflow "VPS: backup" (ação testar-restauracao). Não toca no banco da aplicação além de ler.
set -euo pipefail
BASE=/opt/bgre
# shellcheck source=deploy/env.sh
. "$(dirname "$0")/env.sh"
PGPASSWORD="$(ler_env POSTGRES_PASSWORD)"
[ -n "$PGPASSWORD" ] || { echo "POSTGRES_PASSWORD ausente no .env" >&2; exit 1; }
export PGPASSWORD
docker run --rm --network bgre_default \
  -e PGPASSWORD -e DATABASE_URL="postgresql://app@db:5432/bgre" \
  -v "$BASE/atual/scripts:/scripts:ro" \
  postgres:16-alpine bash /scripts/testar-restauracao.sh
