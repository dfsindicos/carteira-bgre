-- CreateEnum
CREATE TYPE "TipoAvaliacao" AS ENUM ('ADMINISTRADORA', 'SINDICANCIA');

-- DropIndex
DROP INDEX "Avaliacao_condominioId_ano_trimestre_key";

-- AlterTable
ALTER TABLE "Avaliacao" ADD COLUMN     "andamento" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "andamentoEm" DATE,
ADD COLUMN     "estimativa" DECIMAL(5,2),
ADD COLUMN     "passo1Em" TIMESTAMP(3),
ADD COLUMN     "passo1Por" TEXT,
ADD COLUMN     "passo2Em" TIMESTAMP(3),
ADD COLUMN     "passo2Por" TEXT,
ADD COLUMN     "passo3Em" TIMESTAMP(3),
ADD COLUMN     "passo3Por" TEXT,
ADD COLUMN     "passo4Por" TEXT,
ADD COLUMN     "tipo" "TipoAvaliacao" NOT NULL DEFAULT 'ADMINISTRADORA';

-- AlterTable
ALTER TABLE "Condominio" ADD COLUMN     "avaliadoDesdeAno" INTEGER,
ADD COLUMN     "avaliadoDesdeTrimestre" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Avaliacao_condominioId_ano_trimestre_tipo_key" ON "Avaliacao"("condominioId", "ano", "trimestre", "tipo");

-- Dados: o status ENTREGUE passa a ser o passo 4 do checklist ("Enviada à BGRE e validada"). A data do passo 4 é o
-- entregueEm; as importadas não tinham, e ficam com a data da última alteração.
UPDATE "Avaliacao" SET "entregueEm" = COALESCE("entregueEm", "atualizadoEm"), "passo4Por" = 'migração (status Entregue)' WHERE "status" = 'ENTREGUE' AND "passo4Por" IS NULL;
