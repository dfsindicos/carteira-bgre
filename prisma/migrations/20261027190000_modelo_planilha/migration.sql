-- CreateTable
CREATE TABLE "ModeloPlanilha" (
    "tipo" "TipoAvaliacao" NOT NULL,
    "nome" TEXT NOT NULL,
    "arquivo" BYTEA NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL,
    "enviadoPor" TEXT NOT NULL,

    CONSTRAINT "ModeloPlanilha_pkey" PRIMARY KEY ("tipo")
);

