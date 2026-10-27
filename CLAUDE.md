# CLAUDE.md

Instruções para qualquer sessão do Claude trabalhando neste repositório.

## O que é
Sistema da DF Síndicos para a carteira BGRE (Brookfield), em `bgre.gestaodfsindicos.tech`, porta **3004** na VPS. Junta o Score Card trimestral da Brookfield e, nas próximas entregas, as evidências do mês e o Flash Report semanal. Base: o Vistorias (`dfsindicos/vistoria-condominios`), de onde vieram login, deploy, backup e padrão visual. Referência de telas, textos e regras: o protótipo aprovado pelo usuário em 2026-10-24. Operação em `docs/operacao.md`.

Idioma de trabalho: **português do Brasil** — chat, código de domínio, commits, documentação.

## Decisões que não se reabrem sem pedido do usuário
- **Só a DF usa o sistema** (decisão de 2026-10-24). A BGRE não tem acesso e recebe a planilha gerada, como hoje. A administradora continua mandando as evidências por e-mail; a DF registra o recebimento.
- **Stack padrão:** Next.js em container na VPS da Hostinger, Postgres próprio, Prisma. Deploy pelo GitHub Actions, backup diário com `pg_dump` e cópia no OneDrive pelo rclone, restauração testada.
- **Login Microsoft** da DF. Não existe entrada sem login, nem em desenvolvimento.
- **Porta de entrada compartilhada:** HTTPS e roteamento no Caddy único do `dfsindicos/vps-gestaodfsindicos`. Este repositório não sobe Caddy próprio.
- **Domínio:** só `gestaodfsindicos.tech`.
- Score Card: itens, pesos, escala e regras exatamente como no protótipo (`src/lib/scorecard.ts`); o da Sindicância como na planilha "Rev. 3 (Fevereiro 2024)" da Brookfield. Planilha gerada: com o modelo oficial da BGRE enviado no Cadastro ("Modelos da BGRE", um por tipo, guardado no banco porque o repositório é público), "Gerar planilha BGRE" devolve o próprio arquivo da BGRE preenchido (`src/lib/modelo-bgre.ts`, decisão do usuário de 2026-10-27); sem modelo, o formato da DF (`src/lib/planilha.ts`).

## Ordem das entregas
1. **Feita (2026-10-24):** esqueleto, cadastro, avaliação trimestral com Score Card, painel e "Gerar planilha BGRE". Itens de fonte "Action Log" digitados à mão.
   - **Importar (2026-10-26):** tela `/importar` que lê as planilhas do Score Card no modelo da Brookfield (.xlsx ou .zip), simula e grava as avaliações já entregues (`src/lib/importacao.ts`, rota `/api/importar`; ver `docs/operacao.md`).
   - **Tudo o que o artefato "Checklist Avaliações BGRE" fazia (2026-10-26):** segundo Score Card, o da **Sindicância** (`Avaliacao.tipo`, abas nas telas, planilha gerada e importação dos dois modelos); **mapa condomínio × trimestre** com indicadores e gráficos (`src/lib/mapa.ts`, página `/avaliacao`) e "avaliado desde" no cadastro; **checklist de 4 passos** por avaliação (o passo 4 é o antigo status Entregue e trava as notas); **andamento e nota estimada**; **importação do JSON** do artefato, com checklist e, opcionalmente, as notas (`src/lib/importacao-json.ts`, `/api/importar/json`). Painel com a nota da Sindicância.
   - **Flash Report (2026-10-26, pedido do usuário: "igual ao artefato"):** página `/flash` com o HTML do artefato e os dados no banco (`src/lib/flash.ts`); histórico pela tela Importar; a rotina de segunda e a de quarta leem e gravam por `/api/integracao/flash` com `FLASH_TOKEN` (ver `docs/operacao.md`). O repositório é público: texto de Flash Report nunca entra nele.
2. Evidências do mês: pedido automático por e-mail às administradoras (`Administradora.emails`) no 1º dia útil, cobrança de quem atrasa, a DF marca o recebimento e anexa o arquivo, que vai ao SharePoint pela Graph ligado ao item do Score Card (fila no disco e reenvio, como as fotos do Vistorias).
3. Flash Report gravado pela rotina de segunda; os itens do Action Log (2.2.1, 2.2.3, 2.4, 3.1) preenchidos automaticamente.

## Lições aprendidas

- **Lição aprendida (2026-10-24, pedido do usuário): nunca subir vários sistemas de uma vez na VPS.** Três deploys disparados juntos (Action Log, Vistorias e Aprovações) montaram as imagens ao mesmo tempo, esgotaram os 4 GB de memória e derrubaram **todos** os sistemas por cerca de 40 minutos, até o usuário reiniciar a VPS pelo hPanel. Regra: um deploy por vez, esperar terminar e conferir `/api/saude` de todos antes do próximo. A trava `/var/lock/gestao-deploy.lock` (flock no passo "Subir" de cada workflow) é a rede de proteção, não licença para disparar em paralelo.

## Regras de código
1. Validação com Zod em toda Server Action e rota.
2. Mobile primeiro: toda tela conferida em 375 px, em iPhone e Android.
3. Sem dados reais no repositório: nada de nomes de condomínios reais, pessoas, e-mails ou telefones; dados de demonstração sintéticos (`prisma/seed.mjs`, só com `SEED_DEMO=true`).
4. Segredos só nos segredos do GitHub e no `.env` do servidor; nunca no código nem no chat.
5. Antes de mudar algo na VPS ou em outro repositório, perguntar ao usuário.
6. **Sempre mandar o endereço completo** (link clicável) de toda página onde o usuário precisa fazer algo: GitHub, Hostinger, Microsoft 365 etc. Nunca só o caminho de menus. Pedido do usuário de 2026-10-22.
7. Toda alteração feita pelas telas grava `LogAlteracao` com o e-mail de quem mudou. As regras ficam em `src/lib` e recebem o e-mail; as server actions (`src/app/acoes.ts`) só leem a sessão e chamam a regra.

## Commits
Mensagem em português, imperativo, uma linha de assunto e corpo explicando a decisão quando houver.
