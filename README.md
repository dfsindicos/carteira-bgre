# Carteira BGRE · DF Síndicos

Sistema da DF para a carteira BGRE (Brookfield), em `bgre.gestaodfsindicos.tech`. Só a DF usa: a BGRE não tem acesso e recebe a planilha gerada, e a administradora continua mandando as evidências por e-mail.

**1ª entrega (2026-10-24):** cadastro de administradoras e condomínios, avaliação trimestral do Score Card da Brookfield (16 itens, 4 grupos com pesos), painel da carteira e "Gerar planilha BGRE" (.xlsx). Próximas entregas no `CLAUDE.md`.

## Rodar localmente
```bash
cp .env.example .env              # ajuste DATABASE_URL e AUTH_SECRET
npm install
npm run db:migrar                 # aplica as migrações em DATABASE_URL
SEED_DEMO=true npm run db:seed    # condomínios e administradoras inventados, "(demo)" no nome
npm run dev                       # http://localhost:3000
```
Ou tudo em contêiner: `SEED_DEMO=true docker compose up --build` (app em http://localhost:3000, banco próprio).

O login é Microsoft (conta da DF). Sem `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET` no `.env`, ninguém entra. Não existe entrada sem login, nem em desenvolvimento.

## Testes
Precisam de um Postgres com o banco `bgre_test` (o nome tem de terminar em `_test`: os testes apagam as tabelas):
```bash
createdb -O app bgre_test
npm run typecheck && npm run lint && npx vitest run
```

## Deploy
Pelo GitHub Actions, workflow **"VPS: deploy"**, só manual e **um sistema por vez na VPS**. Segredos, variáveis e o que precisa ser feito fora daqui (DNS, Entra, Caddy) em [`docs/operacao.md`](docs/operacao.md).
