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
