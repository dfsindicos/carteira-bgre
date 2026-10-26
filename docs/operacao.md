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
- Itens, grupos, pesos e escala em `src/lib/scorecard.ts` (os mesmos da planilha 2T26 da Brookfield). Mudou a planilha deles? Muda lá e nos testes.
- Média do grupo = média simples dos itens com nota; final = Σ média × peso, só com as 16 notas. Excelente > 98; Bom ≥ 95; Satisfatório ≥ 90; Regular ≥ 80; Ruim < 80.
- Cada nota e comentário grava ao sair do campo, com `LogAlteracao` (quem, quando, antes, depois). "Marcar como entregue" exige as 16 notas e bloqueia a edição; "Reabrir" libera.
- Prazo de entrega padrão: último dia do mês seguinte ao trimestre (3T26 → 31/10), editável na avaliação.
- "Gerar planilha BGRE" (`/avaliacao/<condomínio>/<3T26>/planilha`): .xlsx no padrão de planilha da DF, provisório até o usuário mandar o modelo oficial da BGRE.

## Importar avaliações já entregues
Tela **Importar** (`/importar`, menu do cabeçalho), para carregar as notas que a DF já deu, das planilhas do Score Card no modelo oficial da Brookfield (uma por prédio e trimestre).
- **Envio:** várias `.xlsx` ou um `.zip` da pasta (como o OneDrive baixa). Até 200 planilhas, 5 MB por `.xlsx`, 60 MB por `.zip` e 100 MB por envio. No `.zip` só entram `.xlsx`; pastas, `__MACOSX` e os temporários `~$` do Office são ignorados. Os arquivos são lidos na memória e descartados: nada fica no servidor.
- **Fluxo:** "Simular" mostra, por arquivo, o prédio e a administradora (existente ou novo), o trimestre, quantas notas foram lidas, a nota final da planilha e a calculada pelo sistema, os avisos e o que vai acontecer. "Importar" envia os mesmos arquivos de novo e grava. Trocar os arquivos ou a caixa "Substituir" pede nova simulação.
- **Leitura** (`src/lib/importacao.ts`): aba "Score Card" (ou a primeira com "AVALIAÇÃO FINAL"); "Contratada", "Local de Prestação" e "Período avaliado" pelos rótulos, com o valor depois dos dois-pontos ou na célula seguinte; o cabeçalho da tabela pela linha com "#", "Peso" e "Comentário". A nota de cada item é o valor calculado da coluna "Peso" (fração 0–1, ou já em % até 100). "4,3" vira "4.3". "N/A" ou vazio = sem nota, com aviso. O "2.2" (título) e o "3.5" (fora do Score Card; aviso se tiver nota) são ignorados. Período: "abr a jun/26", "jan a mar de 2026", "OUT A DEZ/25"; sem ano, vale o nome do arquivo ("2T26", "Q226", "Q2-26"). Nota final da planilha diferente da conta do sistema em mais de 0,1 ponto: aviso, e importa mesmo assim.
- **Gravação:** prédio = "Local de Prestação" e administradora = "Contratada", achados pelo nome sem acento, caixa e pontuação; se não existirem, são criados (administradora sem e-mails). A avaliação entra como **Entregue**, com notas e comentários. Se já existir, é pulada; com "Substituir as avaliações que já existem", notas e comentários são trocados (o status fica como estava). Reimportar o mesmo arquivo não muda nada. Cada arquivo grava numa transação própria: um com erro não impede os outros. Tudo grava `LogAlteracao` com o e-mail de quem importou e o nome do arquivo.
- A rota `/api/importar` é multipart, exige a sessão e a mesma origem e valida os campos com Zod.
