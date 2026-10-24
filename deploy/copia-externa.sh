#!/usr/bin/env bash
# Conferência da cópia externa, pelo workflow "VPS: backup":
#   testar  envia um arquivo de teste para BACKUP_DESTINO, lista a pasta e apaga o teste;
#   listar  lista os bgre-*.dump que estão lá.
set -euo pipefail
# shellcheck source=deploy/env.sh
. "$(dirname "$0")/env.sh"
BACKUP_DESTINO="$(ler_env BACKUP_DESTINO)"
if [ -z "$BACKUP_DESTINO" ]; then
  echo "Cópia externa desligada (BACKUP_DESTINO vazio)."
  [ "${1:-}" = listar ] && exit 0
  exit 1
fi
exigir_destino "$BACKUP_DESTINO"
case "${1:-}" in
  testar)
    nome="teste-copia-$(date -u +%Y%m%dT%H%M%SZ).txt"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    echo "Arquivo de teste da Carteira BGRE; pode ser apagado." > "$tmp"
    rclone copyto "$tmp" "$BACKUP_DESTINO/$nome"
    echo "Enviado: $BACKUP_DESTINO/$nome. Conteúdo da pasta:"
    rclone lsl "$BACKUP_DESTINO" --max-depth 1
    rclone deletefile "$BACKUP_DESTINO/$nome"
    echo "Teste apagado. Cópia externa ok."
    ;;
  listar)
    echo "Backups em $BACKUP_DESTINO:"
    rclone lsl "$BACKUP_DESTINO" --max-depth 1 --include 'bgre-*.dump'
    ;;
  *) echo "Uso: copia-externa.sh testar|listar" >&2; exit 2 ;;
esac
