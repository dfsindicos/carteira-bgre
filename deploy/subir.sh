#!/usr/bin/env bash
# Sobe uma versão já copiada para /opt/bgre/releases/<versão>. Rodado como root pelo workflow "VPS: deploy", sempre sob
# a trava /var/lock/gestao-deploy.lock (um deploy por vez na VPS: ver "Lições aprendidas" no CLAUDE.md).
#   bash subir.sh <versão>
# O .env fica em /opt/bgre/.env (escrito pelo workflow a partir dos segredos do GitHub e dos segredos gerados no
# servidor) e os dados ficam nos volumes do projeto "bgre": trocar de versão não toca no banco. O HTTPS não é daqui: é do
# Caddy compartilhado (dfsindicos/vps-gestaodfsindicos), que encaminha bgre.gestaodfsindicos.tech para 127.0.0.1:3004.
set -euo pipefail
VERSAO="${1:?Informe a versão}"
BASE=/opt/bgre
PORTA=3004
REL="$BASE/releases/$VERSAO"
[ -d "$REL" ] || { echo "Versão não encontrada: $REL" >&2; exit 1; }
[ -f "$BASE/.env" ] || { echo "Falta $BASE/.env" >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker ausente: a VPS é preparada pelo deploy do Action Log." >&2; exit 1; }
install -d -m 700 /var/backups/bgre
install -d -m 750 /var/log/bgre

export VERSAO="${VERSAO:0:7}"
compose() { docker compose -p bgre --project-directory "$REL" --env-file "$BASE/.env" -f "$REL/docker-compose.yml" -f "$REL/deploy/docker-compose.vps.yml" "$@"; }

echo "Construindo e subindo a versão $VERSAO..."
compose build
compose up -d --remove-orphans

echo "Conferindo /api/saude..."
for i in $(seq 1 60); do
  if curl -fs --max-time 5 "http://127.0.0.1:$PORTA/api/saude" >/dev/null 2>&1; then
    echo "Saúde ok: $(curl -fsS "http://127.0.0.1:$PORTA/api/saude")"
    break
  fi
  [ "$i" = 60 ] && { echo "A aplicação não respondeu em 5 minutos." >&2; compose logs --tail 80 app migrar >&2; exit 1; }
  sleep 5
done

ln -sfn "$REL" "$BASE/atual"

# Tarefas do servidor (horários em UTC; Brasília = UTC-3). 8h05 UTC: os outros sistemas fazem backup às 6h05, 6h35,
# 7h05 e 7h35, e dois pg_dump ao mesmo tempo disputam a memória da VPS.
cat > /etc/cron.d/bgre <<CRON
# Gerado pelo deploy da Carteira BGRE. Não edite aqui: edite deploy/subir.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
5 8 * * *  root $BASE/atual/deploy/backup.sh >> /var/log/bgre/backup.log 2>&1
CRON
chmod 644 /etc/cron.d/bgre

# Guarda as 3 versões mais recentes (para voltar rápido) e limpa imagens sem uso.
# shellcheck disable=SC2012 # os nomes das versões são hashes de commit; ls -t é o jeito simples de ordenar por data
ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf
docker image prune -f >/dev/null
echo "Versão $VERSAO no ar em 127.0.0.1:$PORTA."
