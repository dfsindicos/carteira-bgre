# Operação

Mesmo modelo do Vistorias e do Action Log: tudo na VPS roda pelo GitHub Actions, sem SSH manual. **Um deploy por vez na VPS** (ver "Lições aprendidas" no `CLAUDE.md`).

## Na VPS
- Pasta `/opt/bgre` (versões em `releases/`, a atual em `atual`, o `.env` escrito pelo deploy).
- Projeto compose `bgre` (contêineres `bgre-db-1`, `bgre-migrar-1`, `bgre-app-1`; volume `bgre_dados`), banco `bgre`.
- O app escuta só em `127.0.0.1:3004`. O HTTPS de `bgre.gestaodfsindicos.tech` é do Caddy compartilhado (`dfsindicos/vps-gestaodfsindicos`).
- Docker, rclone e SSH só por chave vêm da preparação que o deploy do Action Log já faz.
- Segredos gerados no próprio servidor na primeira vez e mantidos: `/opt/bgre/db-password` (senha do banco), `/opt/bgre/auth-secret` (assinatura da sessão) e `/opt/bgre/cron-secret` (tarefas do cron, sem uso nesta entrega). **Não apague o `db-password`**: o banco foi criado com essa senha.
- Backup diário às 5h05 de Brasília (8h05 UTC, depois dos backups dos outros sistemas), pelo cron gravado pelo deploy em `/etc/cron.d/bgre`, em `/var/backups/bgre`, 14 dias. Log em `/var/log/bgre/backup.log`.
- A cópia externa usa o rclone já configurado no servidor pelo Action Log (mesmo OneDrive), 30 dias lá. Este repositório não grava `rclone.conf`.

## Workflows (todos por disparo manual)
| Workflow | O que faz |
|---|---|
| CI | A cada push: typecheck, lint, testes (Postgres de serviço) e build |
| VPS: deploy | Copia a versão, escreve o `.env`, sobe o compose sob a trava `/var/lock/gestao-deploy.lock`, aplica as migrações, confere `/api/saude` |
| VPS: backup | `testar-restauracao`, `backup-agora`, `listar-backups`, `testar-copia-externa` |
| VPS: diagnóstico | Só leitura: contêineres, memória, conexões do banco, erros no log, contagens |

## Segredos e variáveis do GitHub (ambiente `producao` deste repositório)
| Nome | Tipo | Valor |
|---|---|---|
| `VPS_HOST` | segredo | o mesmo do Action Log |
| `VPS_SSH_KEY` | segredo | a mesma chave de deploy do Action Log |
| `VPS_KNOWN_HOSTS` | segredo | a mesma linha do Action Log (opcional, mas recomendado) |
| `MICROSOFT_CLIENT_SECRET` | segredo | o "Valor" do segredo do cliente do registro "Carteira BGRE DF" no Entra (vence em 24 meses) |
| `MICROSOFT_TENANT_ID` | variável | o ID do diretório da DF (o mesmo dos outros sistemas) |
| `MICROSOFT_CLIENT_ID` | variável | o ID do aplicativo "Carteira BGRE DF" |
| `DOMINIO` | variável | `bgre.gestaodfsindicos.tech` |
| `BACKUP_DESTINO` | variável | `onedrive:Backups/bgre` (vazio desliga a cópia externa) |
| `FLASH_TOKEN` | segredo | senha da rotina do Flash Report (`openssl rand -hex 32`); o mesmo valor vai como variável `FLASH_TOKEN` no ambiente do Claude das rotinas. Vazio desliga `/api/integracao/flash` (503) |

Sem `POSTGRES_PASSWORD`, `AUTH_SECRET` e `CRON_SECRET` no GitHub: nascem no servidor (acima).

## `.env` do servidor (`/opt/bgre/.env`, escrito pelo deploy; não editar à mão)
`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `APP_URL` (`https://<DOMINIO>`), `DOMINIO`, `BACKUP_DESTINO`, `RETENCAO_DIAS=14`, mais `POSTGRES_PASSWORD`, `AUTH_SECRET` e `CRON_SECRET` lidos dos arquivos do servidor. Cada linha vai como `NOME='valor'`.

## O que o usuário precisa fazer antes do primeiro deploy
1. **Repositório no GitHub** `dfsindicos/carteira-bgre` e o ambiente `producao`: https://github.com/dfsindicos/carteira-bgre/settings/environments, com os segredos e variáveis da tabela.
2. **DNS:** registro `A` de `bgre` apontando para o IP da VPS, no painel de DNS do domínio `gestaodfsindicos.tech` na Hostinger: https://hpanel.hostinger.com/domains
3. **Entra ID:** registrar o aplicativo "Carteira BGRE DF" (contas só deste diretório) em https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade, com a URI de redirecionamento (Web) `https://bgre.gestaodfsindicos.tech/api/auth/callback/microsoft`, e criar o segredo do cliente.
4. **Porta de entrada:** acrescentar no `caddy/Caddyfile` do `dfsindicos/vps-gestaodfsindicos` o bloco abaixo e a linha da tabela de portas do README (porta 3004), e rodar o workflow "VPS: porta de entrada" (`validar`, depois `ligar`, só com autorização): https://github.com/dfsindicos/vps-gestaodfsindicos/actions
   ```
   bgre.gestaodfsindicos.tech {
   	import padrao
   	reverse_proxy 127.0.0.1:3004
   }
   ```
5. **Deploy:** com nenhum outro deploy rodando na VPS, disparar "VPS: deploy" em https://github.com/dfsindicos/carteira-bgre/actions/workflows/vps-deploy.yml e, ao terminar, conferir `/api/saude` de todos os sistemas. Depois, "VPS: backup" → `testar-restauracao` e `testar-copia-externa`.
6. **Página inicial:** o bloco "Carteira BGRE" em `caddy/inicio/` do `vps-gestaodfsindicos` (protótipo, tela 1).

## Login
Só pessoas da DF, com a conta Microsoft (OpenID Connect com PKCE, `src/lib/microsoft.ts`, o mesmo das Aprovações e do Vistorias). A sessão é um cookie assinado com `AUTH_SECRET`, de 30 dias. Tudo exige login, menos `/entrar`, `/api/auth/*`, `/api/saude`, `/api/cron/*` (com segredo próprio) e os arquivos da tela de entrada.

## Score Card
- Dois tipos de avaliação (`Avaliacao.tipo`), cada um com o seu Score Card em `src/lib/scorecard.ts` (`MODELOS`): **Administradora** (planilha 2T26 da Brookfield, 4 grupos 15/35/25/25, 16 itens) e **Sindicância** (a BGRE avalia a DF; "Rev. 3, fevereiro 2024", 4 grupos 20/30/30/20, 13 itens: 1.1–1.2, 2.1, 3.1–3.8, 4.1–4.2). Uma avaliação por condomínio, trimestre e tipo. Mudou a planilha deles? Muda lá e nos testes.
- Média do grupo = média simples dos itens com nota; final = Σ média × peso, só com todas as notas. Mesma escala nos dois: Excelente > 98; Bom ≥ 95; Satisfatório ≥ 90; Regular ≥ 80; Ruim < 80.
- Nas telas, o tipo é a aba "Avaliação da Administradora" / "Avaliação da Sindicância" (`?tipo=SINDICANCIA` na URL). Na Sindicância, a contratada é a DF Síndicos.
- Cada nota e comentário grava ao sair do campo, com `LogAlteracao` (quem, quando, antes, depois).
- **Checklist do trimestre** (4 passos por avaliação, textos em `MODELOS[tipo].passos`): cada passo guarda a data e quem marcou (`passoNEm`/`passoNPor`), com `LogAlteracao` ("passo N"). "Marcar tudo como feito", "Limpar" e "Copiar checklist" (texto para a área de transferência). Concluída = 4 de 4; em andamento = 1 a 3; a fazer = 0. **O passo 4 ("Enviada à BGRE e validada") é o antigo status Entregue**: marcar exige todas as notas, grava `status = ENTREGUE` e a data em `entregueEm`, e trava a edição das notas; desmarcar (ou "Reabrir") libera. Os passos 1 a 3 não travam nada. A migração `20261026120000_sindicancia_checklist` marcou o passo 4 das avaliações que já estavam entregues (data = `entregueEm`, ou a última alteração nas importadas; `passo4Por` = "migração (status Entregue)").
- **Andamento e estimativa:** anotações livres, uma por linha ("Falta: SST de setembro (2.5)"), com a data em que mudaram, e uma nota estimada opcional (com a classificação), mostrada no mapa como "~" enquanto não houver nota final. Não travam com o passo 4.
- Prazo de entrega padrão: último dia do mês seguinte ao trimestre (3T26 → 31/10), editável na avaliação.
- "Gerar planilha BGRE" (`/avaliacao/<condomínio>/<3T26>/planilha?tipo=…`): .xlsx no padrão de planilha da DF, dos dois tipos, provisório até o usuário mandar o modelo oficial da BGRE.

## Mapa condomínio × trimestre
`/avaliacao` (por tipo) mostra os indicadores (concluídas sobre o total, nota média, trimestre corrente, "com planilha, ainda abertas" e "trimestres fechados sem planilha"), a tabela de 1T25 até o trimestre corrente (o que está sendo avaliado: em outubro, o 3T26) e os gráficos "Nota média por trimestre" e "Andamento por condomínio" (`src/lib/mapa.ts`). Célula: nota com a cor da faixa (verde ≥ 90, âmbar 70–89,9, vermelho < 70), cheia com ✓ se concluída, clara com "n/4" em andamento; sem nota final, "~90,4 est." (estimativa), ∅ (trimestre fechado sem passo, nota nem estimativa), ○ (a fazer) ou – (antes do "avaliado desde" do condomínio, no Cadastro; vazio = desde 1T25). Clicar abre a avaliação. "Lista do 3T26" volta à lista de um trimestre. O painel mostra a nota da Sindicância do mesmo trimestre ao lado da da Administradora.

## Importar avaliações já entregues
Tela **Importar** (`/importar`, menu do cabeçalho), para carregar as notas que a DF já deu, das planilhas do Score Card no modelo oficial da Brookfield (uma por prédio e trimestre).
- **Envio:** várias `.xlsx` ou um `.zip` da pasta (como o OneDrive baixa). Até 200 planilhas, 5 MB por `.xlsx`, 60 MB por `.zip` e 100 MB por envio. No `.zip` só entram `.xlsx`; pastas, `__MACOSX` e os temporários `~$` do Office são ignorados. Os arquivos são lidos na memória e descartados: nada fica no servidor.
- **Fluxo:** "Simular" mostra, por arquivo, o prédio e a administradora (existente ou novo), o trimestre, quantas notas foram lidas, a nota final da planilha e a calculada pelo sistema, os avisos e o que vai acontecer. "Importar" envia os mesmos arquivos de novo e grava. Trocar os arquivos ou a caixa "Substituir" pede nova simulação.
- **Os dois modelos:** a planilha é da Sindicância quando tem o título "…Indicadores de Performance de Sindicância…" ou o rótulo "Empreendimento" (sem "Local de Prestação"); senão, da Administradora. Na Sindicância, o prédio é o "Empreendimento" (o valor pode estar na célula seguinte), o "Periodo avaliado" pode estar duas células depois, o cabeçalho traz "Comentários" e as linhas "Resultado:" são ignoradas; não há administradora, então o prédio precisa existir (ou vir de uma planilha da Administradora no mesmo envio, que é processada antes).
- **Leitura** (`src/lib/importacao.ts`): aba "Score Card…" (ou a primeira com "AVALIAÇÃO FINAL"); "Contratada", "Local de Prestação" e "Período avaliado" pelos rótulos, com o valor depois dos dois-pontos ou na célula seguinte; o cabeçalho da tabela pela linha com "#", "Peso" e "Comentário". A nota de cada item é o valor calculado da coluna "Peso" (fração 0–1, ou já em % até 100). "4,3" vira "4.3". "N/A" ou vazio = sem nota, com aviso. O "2.2" (título) e o "3.5" (fora do Score Card; aviso se tiver nota) são ignorados. Período: "abr a jun/26", "jan a mar de 2026", "OUT A DEZ/25"; sem ano, vale o nome do arquivo ("2T26", "Q226", "Q2-26"). Nota final da planilha diferente da conta do sistema em mais de 0,1 ponto: aviso, e importa mesmo assim.
- **Gravação:** prédio = "Local de Prestação" e administradora = "Contratada", achados pelo nome sem acento, caixa e pontuação; se não existirem, são criados (administradora sem e-mails). A avaliação entra como **Entregue** (passo 4 marcado na hora da importação), com notas e comentários. Se já existir com notas, é pulada (a criada vazia pela importação do JSON recebe as notas); com "Substituir as avaliações que já existem", notas e comentários são trocados (o status fica como estava). Reimportar o mesmo arquivo não muda nada. Cada arquivo grava numa transação própria: um com erro não impede os outros. Tudo grava `LogAlteracao` com o e-mail de quem importou e o nome do arquivo.
- A rota `/api/importar` é multipart, exige a sessão e a mesma origem e valida os campos com Zod.

## Importar o JSON do checklist
Segunda parte da tela **Importar**, rota `/api/importar/json` (JSON, sessão, mesma origem, até 10 MB; `src/lib/importacao-json.ts`, validado com Zod). Traz o que o artefato "Checklist Avaliações BGRE" guardava e, opcionalmente, as notas (os .zip do OneDrive passam de 150 MB):
```
{ "avaliacoes": [ { "tipo": "ADMINISTRADORA" | "SINDICANCIA", "condominio": "<nome>", "ano": 2026, "trimestre": 2,
    "passos": { "1": "AAAA-MM-DD" | null, "2": …, "3": …, "4": … },
    "andamento": ["texto", …], "andamentoEm": "AAAA-MM-DD" | null, "estimativa": 90.35 | null,
    "itens": { "1.1": { "nota": 90.67 | null, "comentario": "texto" | null }, … },
    "notaFinalPlanilha": 91.0 | null, "arquivo": "nome do arquivo de origem" | null } ] }
```
- Campo ausente = não mexe; `null` = desmarca o passo ou apaga. As datas dos passos são gravadas como o dia informado; "quem marcou" é quem importou.
- O condomínio é achado pelo nome sem acento, caixa, pontuação e o texto entre parênteses. Quem não bater mostra o mais parecido e um seletor (usar o parecido, outro condomínio ou ignorar); a escolha vale para todas as linhas com aquele nome e refaz a simulação. Sem escolha, a linha não grava.
- `"cadastro": [{ "nome", "administradora", "avaliadoDesde": "1T25" }]` (opcional, no topo do arquivo): prédios que ainda não existem são criados antes das avaliações, com a administradora (criada se faltar, sem e-mails) e o "avaliado desde"; a simulação só lista e não grava. Prédio que já existe não é alterado.
- Avaliação que não existe é criada vazia. O passo 4 no JSON marca como entregue **sem exigir as notas** (histórico).
- Com `itens`: notas (0 a 100, 2 casas) e comentários pelas mesmas regras da importação .xlsx: avaliação sem notas recebe; com notas, é pulada com aviso (o checklist, o andamento e a estimativa entram mesmo assim), ou trocada com "Substituir as notas". Código fora do modelo do tipo: aviso e ignorado. `notaFinalPlanilha` diferente da calculada em mais de 0,1 ponto: aviso. `arquivo` vai para o `LogAlteracao`.
- "Simular" roda a mesma gravação numa transação desfeita no fim: mostra exatamente o que "Importar" faz. Cada avaliação grava numa transação própria. Reimportar o mesmo arquivo não muda nada. Tudo com `LogAlteracao` do e-mail de quem importou.

## Flash Report semanal
- **Painel:** `/flash` (menu "Flash Report"), o mesmo HTML do artefato antigo (`public/flash.html`, sem dados), que lê os dados de `/flash/dados.js` (com login). Os textos ficam só no banco (`FlashSemana`, um por prédio e semana; `FlashPainel`, o resto), nunca no repositório.
- **Formato:** o `DATA` do artefato (`condos`, `weeks`, `entries`, `cobertos`, `exec`, `geradoEm` e `siglas`), validado em `src/lib/flash.ts`. Qualquer tag além de `<b>`, `<i>`, `<p>` e `<br>` vira "‹" na gravação.
- **Prédios:** ligados pelo `Condominio.flashSlug`; na primeira vez, pelo nome (sem acento, caixa, pontuação e parênteses, ou um contido no outro, se só um bater). Quem não existir é cadastrado **inativo** (fica fora do Score Card; o Cadastro reativa).
- **Histórico:** tela Importar, seção "Flash Report (JSON)": simular, conferir a ligação dos prédios, importar. Semana já gravada é substituída; reimportar não muda nada.
- **Rotina (segunda 12h e quarta):** no lugar de ler e republicar o artefato:
  - ler: `curl -sf -H "Authorization: Bearer $FLASH_TOKEN" https://bgre.gestaodfsindicos.tech/api/integracao/flash > /tmp/dados.json` e `python3 -c 'import json;print("const DATA = "+open("/tmp/dados.json").read()+";")' > /tmp/base.html` (o `build.py` lê a linha `const DATA = `);
  - gravar: tirar a linha `const DATA = ` do `/tmp/novo.html` e `curl -sf -X POST -H "Authorization: Bearer $FLASH_TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/novo.json https://bgre.gestaodfsindicos.tech/api/integracao/flash`. A resposta traz as semanas novas, atualizadas e sem mudança; 422 diz o campo fora do formato.
