import { describe, expect, it } from "vitest";
import { destinoSeguro, urlDoDestino } from "@/lib/destino";

const BASE = "https://sistema.exemplo.test";

describe("destino depois do login: sem redirecionamento aberto", () => {
  it("aceita caminho interno com busca e âncora", () => {
    expect(destinoSeguro("/avaliacao/x/3T26?aba=sindicancia#notas")).toBe("/avaliacao/x/3T26?aba=sindicancia#notas");
    expect(urlDoDestino("/cadastro?x=1", BASE).href).toBe(`${BASE}/cadastro?x=1`);
  });

  it("recusa outro site, contrabarra, caracteres de controle e o que não começa com barra", () => {
    for (const ruim of [
      "//evil.test",
      "/\\evil.test",
      "/\\/evil.test",
      "\\\\evil.test",
      "/\t/evil.test",
      "/\n/evil.test",
      "https://evil.test",
      "javascript:alert(1)",
      "evil.test",
      "",
      null,
      undefined,
    ]) {
      expect(destinoSeguro(ruim)).toBe("/");
      expect(urlDoDestino(ruim, BASE).origin).toBe(BASE);
    }
  });

  it("no retorno, mesmo um valor que escapou da primeira trava não sai da origem do sistema", () => {
    expect(urlDoDestino("//evil.test/x", BASE).href).toBe(`${BASE}/`);
    expect(urlDoDestino("/\\evil.test", BASE).href).toBe(`${BASE}/`);
    expect(urlDoDestino("https://evil.test", BASE).href).toBe(`${BASE}/`);
  });
});
