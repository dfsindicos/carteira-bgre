-- AlterTable
ALTER TABLE "Condominio" ADD COLUMN     "flashSlug" TEXT;

-- CreateTable
CREATE TABLE "FlashSemana" (
    "id" TEXT NOT NULL,
    "condominioId" TEXT NOT NULL,
    "semana" DATE NOT NULL,
    "dados" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashSemana_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashPainel" (
    "id" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashPainel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlashSemana_condominioId_semana_key" ON "FlashSemana"("condominioId", "semana");

-- CreateIndex
CREATE UNIQUE INDEX "Condominio_flashSlug_key" ON "Condominio"("flashSlug");

-- AddForeignKey
ALTER TABLE "FlashSemana" ADD CONSTRAINT "FlashSemana_condominioId_fkey" FOREIGN KEY ("condominioId") REFERENCES "Condominio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

