-- Demandas da BGRE (2026-11-03): só aditiva. O SLA sem linha gravada usa o padrão do código (o do Einstein).

-- CreateEnum
CREATE TYPE "Criticidade" AS ENUM ('CRITICA', 'URGENTE', 'ORDINARIA', 'COMPLEXA');

-- CreateEnum
CREATE TYPE "SituacaoDemanda" AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO', 'CONCLUIDA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "AguardandoDemanda" AS ENUM ('DF', 'BGRE', 'ADMINISTRADORA', 'CORRETORA', 'FORNECEDOR');

-- CreateEnum
CREATE TYPE "UnidadePrazo" AS ENUM ('HORAS', 'DIAS_UTEIS', 'COMBINADO');

-- CreateEnum
CREATE TYPE "TipoMensagemDemanda" AS ENUM ('RECEBIDA', 'ENVIADA_DF', 'NOTA');

-- CreateTable
CREATE TABLE "Demanda" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "remetenteNome" TEXT NOT NULL DEFAULT '',
    "remetenteEmail" TEXT NOT NULL DEFAULT '',
    "condominioId" TEXT,
    "criticidade" "Criticidade" NOT NULL DEFAULT 'ORDINARIA',
    "chegadaEm" TIMESTAMP(3) NOT NULL,
    "prazoEmail" DATE,
    "prazoCombinado" DATE,
    "primeiraRespostaEm" TIMESTAMP(3),
    "primeiraRespostaPor" TEXT,
    "situacao" "SituacaoDemanda" NOT NULL DEFAULT 'ABERTA',
    "aguardando" "AguardandoDemanda",
    "responsavel" TEXT NOT NULL DEFAULT '',
    "concluidaEm" TIMESTAMP(3),
    "arquivadaEm" TIMESTAMP(3),
    "motivoArquivo" TEXT,
    "conversas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webLink" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'TRIAGEM',
    "canal" TEXT,
    "origemPlanner" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Demanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MensagemDemanda" (
    "id" TEXT NOT NULL,
    "demandaId" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "conversationId" TEXT,
    "tipo" "TipoMensagemDemanda" NOT NULL,
    "em" TIMESTAMP(3) NOT NULL,
    "autorNome" TEXT NOT NULL DEFAULT '',
    "autorEmail" TEXT NOT NULL DEFAULT '',
    "assunto" TEXT NOT NULL DEFAULT '',
    "texto" TEXT NOT NULL,
    "caixa" TEXT,
    "webLink" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MensagemDemanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaDemanda" (
    "criticidade" "Criticidade" NOT NULL,
    "respostaValor" INTEGER NOT NULL,
    "respostaUnidade" "UnidadePrazo" NOT NULL,
    "conclusaoValor" INTEGER NOT NULL,
    "conclusaoUnidade" "UnidadePrazo" NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT NOT NULL,

    CONSTRAINT "SlaDemanda_pkey" PRIMARY KEY ("criticidade")
);

-- CreateTable
CREATE TABLE "OpcoesSlaDemanda" (
    "id" TEXT NOT NULL,
    "contarFeriados" BOOLEAN NOT NULL DEFAULT true,
    "prazoEmailPrevalece" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT NOT NULL,

    CONSTRAINT "OpcoesSlaDemanda_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Demanda_numero_key" ON "Demanda"("numero");

-- CreateIndex
CREATE INDEX "Demanda_situacao_idx" ON "Demanda"("situacao");

-- CreateIndex
CREATE INDEX "Demanda_condominioId_idx" ON "Demanda"("condominioId");

-- CreateIndex
CREATE UNIQUE INDEX "MensagemDemanda_internetMessageId_key" ON "MensagemDemanda"("internetMessageId");

-- CreateIndex
CREATE INDEX "MensagemDemanda_demandaId_em_idx" ON "MensagemDemanda"("demandaId", "em");

-- AddForeignKey
ALTER TABLE "Demanda" ADD CONSTRAINT "Demanda_condominioId_fkey" FOREIGN KEY ("condominioId") REFERENCES "Condominio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MensagemDemanda" ADD CONSTRAINT "MensagemDemanda_demandaId_fkey" FOREIGN KEY ("demandaId") REFERENCES "Demanda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

