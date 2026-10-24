import { execSync } from "node:child_process";
import { config } from "dotenv";

// Os testes de banco rodam em DATABASE_URL_TESTE. O nome do banco precisa terminar em _test
// porque as suítes apagam as tabelas: nunca apontar para o banco de desenvolvimento.
export default function setup() {
  config({ quiet: true });
  const url = process.env.DATABASE_URL_TESTE;
  if (!url) throw new Error("Defina DATABASE_URL_TESTE (ver .env.example)");
  const banco = new URL(url).pathname.replace("/", "");
  if (!banco.endsWith("_test")) throw new Error(`DATABASE_URL_TESTE aponta para "${banco}"; o nome precisa terminar em _test`);

  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
