// Importado primeiro por todo teste de banco: aponta o Prisma para o banco de teste.
import { config } from "dotenv";

config({ quiet: true });
process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
