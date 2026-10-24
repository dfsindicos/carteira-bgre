-- CreateEnum
CREATE TYPE "StatusAvaliacao" AS ENUM ('RASCUNHO', 'ENTREGUE');

-- CreateTable
CREATE TABLE "Administradora" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "emails" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Administradora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Condominio" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "administradoraId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Condominio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avaliacao" (
    "id" TEXT NOT NULL,
    "condominioId" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "trimestre" INTEGER NOT NULL,
    "status" "StatusAvaliacao" NOT NULL DEFAULT 'RASCUNHO',
    "entregaAte" DATE,
    "entregueEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotaItem" (
    "id" TEXT NOT NULL,
    "avaliacaoId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "nota" DECIMAL(5,2),
    "comentario" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "NotaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogAlteracao" (
    "id" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "campo" TEXT NOT NULL,
    "antes" TEXT,
    "depois" TEXT,
    "email" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogAlteracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Administradora_nome_key" ON "Administradora"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Condominio_nome_key" ON "Condominio"("nome");

-- CreateIndex
CREATE INDEX "Condominio_administradoraId_idx" ON "Condominio"("administradoraId");

-- CreateIndex
CREATE INDEX "Avaliacao_ano_trimestre_idx" ON "Avaliacao"("ano", "trimestre");

-- CreateIndex
CREATE UNIQUE INDEX "Avaliacao_condominioId_ano_trimestre_key" ON "Avaliacao"("condominioId", "ano", "trimestre");

-- CreateIndex
CREATE UNIQUE INDEX "NotaItem_avaliacaoId_item_key" ON "NotaItem"("avaliacaoId", "item");

-- CreateIndex
CREATE INDEX "LogAlteracao_entidade_entidadeId_idx" ON "LogAlteracao"("entidade", "entidadeId");

-- AddForeignKey
ALTER TABLE "Condominio" ADD CONSTRAINT "Condominio_administradoraId_fkey" FOREIGN KEY ("administradoraId") REFERENCES "Administradora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avaliacao" ADD CONSTRAINT "Avaliacao_condominioId_fkey" FOREIGN KEY ("condominioId") REFERENCES "Condominio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotaItem" ADD CONSTRAINT "NotaItem_avaliacaoId_fkey" FOREIGN KEY ("avaliacaoId") REFERENCES "Avaliacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
