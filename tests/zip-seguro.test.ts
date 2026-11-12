/** Revisão de segurança de 2026-11-12, 2º lote: zip que explode na memória é recusado pelo que sai de verdade. */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { conferirDescompactado, DescompactadoGrandeDemais, lerComLimite } from "@/lib/zip-seguro";

async function bomba() {
  const z = new JSZip();
  z.file("grande.txt", Buffer.alloc(30 * 1024 * 1024));
  z.file("pequeno.txt", "oi");
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("zip seguro", () => {
  it("para ao passar do limite e lê o que cabe", async () => {
    const bytes = await bomba();
    expect(bytes.length).toBeLessThan(1024 * 1024);
    const zip = await JSZip.loadAsync(bytes);
    await expect(lerComLimite(zip.file("grande.txt")!, 5 * 1024 * 1024)).rejects.toBeInstanceOf(DescompactadoGrandeDemais);
    expect((await lerComLimite(zip.file("pequeno.txt")!, 10)).toString()).toBe("oi");
  });

  it("confere o total descompactado antes de abrir no ExcelJS", async () => {
    const bytes = await bomba();
    await expect(conferirDescompactado(bytes, 20 * 1024 * 1024)).rejects.toBeInstanceOf(DescompactadoGrandeDemais);
    await expect(conferirDescompactado(bytes, 40 * 1024 * 1024)).resolves.toBeUndefined();
  });
});
