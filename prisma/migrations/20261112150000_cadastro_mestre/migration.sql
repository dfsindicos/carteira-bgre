-- Cadastro mestre (2026-11-12): códigos do Action Log e registro das sincronizações. Só aditiva.
ALTER TABLE "Administradora" ADD COLUMN "codigoMestre" TEXT;
CREATE UNIQUE INDEX "Administradora_codigoMestre_key" ON "Administradora"("codigoMestre");
ALTER TABLE "Condominio" ADD COLUMN "codigoMestre" TEXT;
CREATE UNIQUE INDEX "Condominio_codigoMestre_key" ON "Condominio"("codigoMestre");
CREATE TABLE "SincronizacaoMestre" (
    "id" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "resumo" JSONB NOT NULL,
    CONSTRAINT "SincronizacaoMestre_pkey" PRIMARY KEY ("id")
);
