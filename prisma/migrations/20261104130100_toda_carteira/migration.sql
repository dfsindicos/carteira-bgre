-- Pedido do usuário de 2026-11-04: condomínio "Toda a carteira" nas demandas que envolvem todos os condomínios BGRE.
-- Só aditiva: com todaCarteira = true, condominioId fica nulo.
ALTER TABLE "Demanda" ADD COLUMN "todaCarteira" BOOLEAN NOT NULL DEFAULT false;
