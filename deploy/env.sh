# shellcheck shell=bash
# Lê uma variável do /opt/bgre/.env SEM executar o arquivo: os valores vêm de segredos e podem ter < > $ espaços.
# O workflow grava cada linha como NOME='valor' (aspas simples, que o docker compose também lê como texto literal).
# Uso: . "$(dirname "$0")/env.sh"; SENHA="$(ler_env POSTGRES_PASSWORD)"
ARQUIVO_ENV="${ARQUIVO_ENV:-/opt/bgre/.env}"
ler_env() {
  local v
  v="$(grep -m1 "^$1=" "$ARQUIVO_ENV" | cut -d= -f2- || true)"
  v="${v#\'}"
  v="${v%\'}"
  printf '%s' "$v"
}

# Destino do rclone com pasta: "remote:Pasta/Sub". Recusa o remote sem pasta ("onedrive:" ou "onedrive:/"), para a
# retenção nunca apagar fora da pasta da Carteira BGRE. Exige o rclone instalado.
exigir_destino() {
  [[ "$1" =~ ^[A-Za-z0-9_.-]+:[^/[:space:]][^[:space:]]*$ ]] || { echo "BACKUP_DESTINO inválido: \"$1\" (use remote:Pasta, ex.: onedrive:Backups/bgre)" >&2; exit 1; }
  command -v rclone >/dev/null || { echo "BACKUP_DESTINO definido, mas o rclone não está instalado na VPS." >&2; exit 1; }
}
