-- Pedido do usuário de 2026-11-04: análise estruturada da demanda (o que a BGRE pediu, o que a DF faz, próximo passo).
-- Só aditiva, tudo opcional.
ALTER TABLE "Demanda" ADD COLUMN "pedido" TEXT;
ALTER TABLE "Demanda" ADD COLUMN "oQueFazer" TEXT;
ALTER TABLE "Demanda" ADD COLUMN "proximoPasso" TEXT;
