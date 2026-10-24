#!/usr/bin/env bash
# Diagnóstico da VPS, SÓ LEITURA (workflow "VPS: diagnóstico"): estado e reinícios dos contêineres (inclusive por falta de
# memória), uso de memória, conexões do banco e o que o app registrou nas últimas horas sobre erros e
# reinício. Não mostra conteúdo de dado: do banco, só estado e tempo das conexões (sem o texto das consultas).
set -uo pipefail
HORAS="${1:-6}"
[[ "$HORAS" =~ ^[0-9]+$ ]] || HORAS=6
secao() { printf '\n===== %s =====\n' "$1"; }

secao "Máquina"
uptime; free -m; df -h / | tail -n 1

secao "Contêineres (reinícios, falta de memória, saúde)"
for c in $(docker ps -a --filter "label=com.docker.compose.project=bgre" --format '{{.Names}}'); do
  docker inspect "$c" --format '{{.Name}}: {{.State.Status}} desde {{.State.StartedAt}} · reinícios {{.RestartCount}} · OOMKilled {{.State.OOMKilled}} · saúde {{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}} · limite {{.HostConfig.Memory}}'
done
mapfile -t ids < <(docker ps --filter "label=com.docker.compose.project=bgre" -q)
[ "${#ids[@]}" -gt 0 ] && docker stats --no-stream --format '{{.Name}}: CPU {{.CPUPerc}} · memória {{.MemUsage}}' "${ids[@]}"

secao "Falta de memória no kernel (últimos registros)"
dmesg -T 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -n 10 || true

secao "Conexões do banco agora (estado e tempo, sem consultas)"
docker exec bgre-db-1 psql -U app -d bgre -At -F ' · ' -c \
  "SELECT coalesce(state,'-'), coalesce(wait_event_type||'/'||wait_event,'-'), coalesce(to_char(now()-xact_start,'HH24:MI:SS'),'-') FROM pg_stat_activity WHERE datname='bgre' ORDER BY xact_start NULLS LAST" 2>&1 | head -n 20

secao "App: erros e reinício nas últimas $HORAS h"
docker logs --since "${HORAS}h" bgre-app-1 2>&1 | grep -E 'heap|out of memory|Killed|ERRO|Error|ready|Starting|Ready|\[login microsoft\]' | tail -n 120

secao "Dados (só contagens, sem conteúdo)"
docker exec bgre-db-1 psql -U app -d bgre -At -F ' · ' -c "
  SELECT 'administradoras', count(*)::text FROM \"Administradora\"
  UNION ALL SELECT 'condomínios ativos', count(*)::text FROM \"Condominio\" WHERE ativo
  UNION ALL SELECT 'avaliações ' || status, count(*)::text FROM \"Avaliacao\" GROUP BY status
  UNION ALL SELECT 'alterações registradas', count(*)::text FROM \"LogAlteracao\"" 2>&1

secao "Saúde agora"
curl -s --max-time 10 -o /dev/null -w 'HTTP %{http_code} em %{time_total}s\n' http://127.0.0.1:3004/api/saude || echo "sem resposta em 10 s"
