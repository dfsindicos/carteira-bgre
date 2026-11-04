-- Pedido do usuário de 2026-11-04: "Locatário" na lista de "aguardando" das demandas.
ALTER TYPE "AguardandoDemanda" ADD VALUE IF NOT EXISTS 'LOCATARIO' AFTER 'ADMINISTRADORA';
