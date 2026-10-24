# Imagem portátil: roda igual em Docker local, VPS ou qualquer host de contêiner.
# A imagem já traz libssl3, que é o que o Prisma usa: sem "apk add", o build não
# depende do repositório de pacotes do Alpine.
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Certificado opcional para builds atrás de proxy com inspeção TLS:
#   docker build --secret id=ca,src=/caminho/ca.crt .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi \
    && npm ci

# Alvo "ferramentas": migrações, seed e testes (precisa das devDependencies e do CLI do Prisma).
FROM deps AS ferramentas
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]

FROM ferramentas AS build
ENV NEXT_TELEMETRY_DISABLED=1
# Versão do commit (o deploy passa), para o diagnóstico saber o que está no ar.
ARG VERSAO=""
ENV VERSAO=$VERSAO
RUN npm run build

# Alvo final: só o servidor standalone, sem devDependencies, sem usuário root.
FROM base AS app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# O standalone não inclui public/ (logo e demais arquivos estáticos): sem esta linha, /logo-df.png dá 404 em produção.
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
