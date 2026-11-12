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

# Quando o app não sobe, o log do Actions mostra o estado dos contêineres e só trechos fixos e sem dado das mensagens
# (códigos do Prisma, variável que falta, memória), contados; nunca o texto do app, que pode trazer nome de condomínio
# ou e-mail (revisão de segurança de 2026-11-12). O texto completo fica no terminal da VPS: docker logs <contêiner>.
resumo_da_falha() {
  compose ps -a --format '{{.Service}}: {{.State}} · {{.Status}}'
  echo "Trechos conhecidos nas últimas 200 linhas de app e migrar (contagem):"
  compose logs --no-color --tail 200 app migrar 2>&1 \
    | grep -oE 'P[0-9]{4}|Environment variable not found: [A-Z_]+|[A-Z_]+ ausente|EADDRINUSE|ECONNREFUSED|ENOTFOUND|out of memory|heap limit|Killed|Error' \
    | sort | uniq -c || echo "  nenhum"
}

echo "Conferindo /api/saude..."
for i in $(seq 1 60); do
  if curl -fs --max-time 5 "http://127.0.0.1:$PORTA/api/saude" >/dev/null 2>&1; then
    echo "Saúde ok: $(curl -fsS "http://127.0.0.1:$PORTA/api/saude")"
    break
  fi
  [ "$i" = 60 ] && { echo "A aplicação não respondeu em 5 minutos." >&2; resumo_da_falha >&2; exit 1; }
  sleep 5
done

ln -sfn "$REL" "$BASE/atual"

# Tarefas do servidor (horários em UTC; Brasília = UTC-3). 8h05 UTC: os outros sistemas fazem backup às 6h05, 6h35,
# 7h05 e 7h35, e dois pg_dump ao mesmo tempo disputam a memória da VPS.
( umask 077; printf 'Authorization: Bearer %s\n' "$(cat "$BASE/cron-secret")" > "$BASE/cron-cabecalho" )
cat > /etc/cron.d/bgre <<CRON
# Gerado pelo deploy da Carteira BGRE. Não edite aqui: edite deploy/subir.sh.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
5 8 * * *  root $BASE/atual/deploy/backup.sh >> /var/log/bgre/backup.log 2>&1
# Cadastro mestre: lê o Action Log de hora em hora (o cabeçalho com o CRON_SECRET fica num arquivo, fora da linha de comando).
29 * * * *  root curl -fsS -X POST --max-time 150 -H @$BASE/cron-cabecalho http://127.0.0.1:$PORTA/api/cron/mestre >> /var/log/bgre/mestre.log 2>&1
CRON
chmod 644 /etc/cron.d/bgre

# Guarda as 3 versões mais recentes (para voltar rápido) e limpa imagens sem uso.
# shellcheck disable=SC2012 # os nomes das versões são hashes de commit; ls -t é o jeito simples de ordenar por data
ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf
docker image prune -f >/dev/null
echo "Versão $VERSAO no ar em 127.0.0.1:$PORTA."
