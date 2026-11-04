-- Pedido do usuário de 2026-11-04: situação "Reunião" para os e-mails que são agendamento de reunião (conta como aberta).
-- Migração própria: o valor novo de um enum não pode ser usado na mesma transação em que é criado.
ALTER TYPE "SituacaoDemanda" ADD VALUE IF NOT EXISTS 'REUNIAO' AFTER 'AGUARDANDO';
