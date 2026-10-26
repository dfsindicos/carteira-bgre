import { describe, expect, it } from "vitest";
import {
  CODIGOS,
  GRUPOS,
  calcular,
  classificar,
  esquemaNota,
  formatarPeriodo,
  lerPeriodo,
  periodoAnterior,
  periodoEmAvaliacao,
  prazoPadrao,
  MODELOS,
  GRUPOS_SINDICANCIA,
  faixaMapa,
  lerTipo,
} from "@/lib/scorecard";

const todas = (v: number) => Object.fromEntries(CODIGOS.map((c) => [c, v]));

describe("Score Card", () => {
  it("tem os 4 grupos com os pesos da Brookfield e os 16 itens", () => {
    expect(GRUPOS.map((g) => g.peso)).toEqual([0.15, 0.35, 0.25, 0.25]);
    expect(GRUPOS.map((g) => g.itens.length)).toEqual([1, 8, 4, 3]);
    expect(CODIGOS).toHaveLength(16);
    expect(GRUPOS.flatMap((g) => g.itens).filter((i) => i.fonte === "al").map((i) => i.codigo)).toEqual(["2.2.1", "2.2.3", "2.4", "3.1"]);
  });

  it("média do grupo é a média simples dos itens com nota; final só com as 16 notas", () => {
    const r = calcular({ "2.1": 100, "2.2.1": 50 });
    expect(r.grupos[1]!.media).toBe(75);
    expect(r.grupos[0]!.media).toBeNull();
    expect(r.final).toBeNull();
    expect(r.faltam).toBe(14);
  });

  it("final = Σ média do grupo × peso (exemplo do protótipo)", () => {
    const notas = {
      "1.1": 94.3, "2.1": 100, "2.2.1": 100, "2.2.2": 0, "2.2.3": 100, "2.3": 100, "2.4": 100, "2.5": 97.6, "2.6": 100,
      "3.1": 100, "3.2": 66.7, "3.3": 100, "3.4": 100, "4.1": 80, "4.2": 92, "4.3": 92,
    };
    const r = calcular(notas);
    const esperado = 94.3 * 0.15 + (697.6 / 8) * 0.35 + (366.7 / 4) * 0.25 + (264 / 3) * 0.25;
    expect(r.faltam).toBe(0);
    expect(r.final).toBeCloseTo(esperado, 6);
    expect(r.classificacao).toBe("Regular");
  });

  it("classifica nos limites 98, 95, 90 e 80", () => {
    expect(classificar(98.01)).toBe("Excelente");
    expect(classificar(98)).toBe("Bom");
    expect(classificar(95)).toBe("Bom");
    expect(classificar(94.99)).toBe("Satisfatório");
    expect(classificar(90)).toBe("Satisfatório");
    expect(classificar(89.99)).toBe("Regular");
    expect(classificar(80)).toBe("Regular");
    expect(classificar(79.99)).toBe("Ruim");
    // A conta em ponto flutuante não pode empurrar 98 para Excelente.
    expect(calcular(todas(98)).classificacao).toBe("Bom");
    expect(calcular(todas(95)).classificacao).toBe("Bom");
  });

  it("recusa nota fora de 0 a 100 e texto; aceita vírgula e vazio", () => {
    expect(esquemaNota.safeParse("100.01").success).toBe(false);
    expect(esquemaNota.safeParse("-1").success).toBe(false);
    expect(esquemaNota.safeParse("abc").success).toBe(false);
    expect(esquemaNota.parse("94,3")).toBe(94.3);
    expect(esquemaNota.parse(" 0 ")).toBe(0);
    expect(esquemaNota.parse("100")).toBe(100);
    expect(esquemaNota.parse("")).toBeNull();
  });

  it("período no formato 3T26", () => {
    expect(formatarPeriodo({ ano: 2026, trimestre: 3 })).toBe("3T26");
    expect(lerPeriodo("3T26")).toEqual({ ano: 2026, trimestre: 3 });
    expect(lerPeriodo("5T26")).toBeNull();
    expect(periodoAnterior({ ano: 2026, trimestre: 1 })).toEqual({ ano: 2025, trimestre: 4 });
    expect(periodoEmAvaliacao(new Date(2026, 9, 24))).toEqual({ ano: 2026, trimestre: 3 });
    expect(prazoPadrao({ ano: 2026, trimestre: 3 }).toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(prazoPadrao({ ano: 2026, trimestre: 4 }).toISOString().slice(0, 10)).toBe("2027-01-31");
  });
});

describe("Score Card da Sindicância", () => {
  const sin = MODELOS.SINDICANCIA;
  const todasSin = (v: number) => Object.fromEntries(sin.codigos.map((c) => [c, v]));

  it("tem os 4 grupos com pesos 20/30/30/20 e os 13 itens", () => {
    expect(GRUPOS_SINDICANCIA.map((g) => g.peso)).toEqual([0.2, 0.3, 0.3, 0.2]);
    expect(GRUPOS_SINDICANCIA.map((g) => g.itens.length)).toEqual([2, 1, 8, 2]);
    expect(sin.codigos).toEqual(["1.1", "1.2", "2.1", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "4.1", "4.2"]);
    expect(sin.codigos).toHaveLength(13);
    expect(sin.passos.map((p) => p.titulo)).toEqual(["Controle do trimestre reunido", "Planilha da Sindicância preenchida", "Notas conferidas", "Enviada à BGRE e validada"]);
    expect(MODELOS.ADMINISTRADORA.passos).toHaveLength(4);
    expect(lerTipo("SINDICANCIA")).toBe("SINDICANCIA");
    expect(lerTipo("qualquer")).toBe("ADMINISTRADORA");
  });

  it("final = Σ média simples do grupo × peso, só com todos os itens", () => {
    const notas = { ...todasSin(100), "1.1": 80, "1.2": 90, "3.4": 60 };
    const r = calcular(notas, "SINDICANCIA");
    const esperado = 85 * 0.2 + 100 * 0.3 + ((100 * 7 + 60) / 8) * 0.3 + 100 * 0.2;
    expect(r.grupos.map((g) => g.media)).toEqual([85, 100, 95, 100]);
    expect(r.final).toBeCloseTo(esperado, 6);
    expect(calcular({ "1.1": 90 }, "SINDICANCIA").faltam).toBe(12); // 13 itens, 1 com nota
    // As notas da Administradora não fecham a Sindicância (códigos diferentes).
    expect(calcular(todas(100), "SINDICANCIA").final).toBeNull();
  });

  it("mesma escala nos limites, sem ruído de ponto flutuante", () => {
    expect(calcular(todasSin(98), "SINDICANCIA").classificacao).toBe("Bom");
    expect(calcular(todasSin(98.01), "SINDICANCIA").classificacao).toBe("Excelente");
    expect(calcular(todasSin(90), "SINDICANCIA").classificacao).toBe("Satisfatório");
    expect(calcular(todasSin(79.99), "SINDICANCIA").classificacao).toBe("Ruim");
  });

  it("faixa do mapa: verde ≥ 90, âmbar 70–89,9, vermelho < 70", () => {
    expect([faixaMapa(90), faixaMapa(89.99), faixaMapa(70), faixaMapa(69.99)]).toEqual(["ok", "atencao", "atencao", "erro"]);
  });
});
