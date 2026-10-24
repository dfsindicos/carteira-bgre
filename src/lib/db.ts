import { PrismaClient } from "@prisma/client";

// Este módulo só pode ser importado por outros módulos de src/lib.
// Rotas, ações e componentes pedem dados por funções que passam pelo escopo (ver tests/arquitetura.test.ts).
const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalParaPrisma.prisma = prisma;
