import JSZip from "jszip";

// Revisão de segurança de 2026-11-12, 2º lote: arquivo compactado que explode na memória (zip bomb). O tamanho que o
// próprio .zip declara pode ser falso, então aqui se conta o que sai de verdade ao descompactar, e para no limite.

export class DescompactadoGrandeDemais extends Error {}

/** Descompacta um arquivo de dentro do zip contando os bytes reais; passou do limite, para e recusa. */
export function lerComLimite(f: JSZip.JSZipObject, limite: number): Promise<Buffer> {
  return new Promise((ok, falha) => {
    const partes: Buffer[] = [];
    let total = 0;
    let parou = false;
    const s = f.nodeStream("nodebuffer");
    s.on("data", (d: Buffer) => {
      if (parou) return;
      total += d.length;
      if (total > limite) {
        parou = true;
        s.pause();
        s.removeAllListeners("data");
        falha(new DescompactadoGrandeDemais(`${f.name}: maior que ${Math.round(limite / 1024 / 1024)} MB descompactado`));
        return;
      }
      partes.push(d);
    });
    s.on("error", (e) => {
      if (!parou) {
        parou = true;
        falha(e);
      }
    });
    s.on("end", () => {
      if (!parou) ok(Buffer.concat(partes));
    });
  });
}

/**
 * Antes de abrir um .xlsx (que é um zip) no ExcelJS: confere que tudo junto, descompactado de verdade, cabe no limite.
 * Lança DescompactadoGrandeDemais; outro erro (não é zip) fica para quem chama.
 */
export async function conferirDescompactado(bytes: Uint8Array | Buffer, limiteTotal: number): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  let resta = limiteTotal;
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    resta -= (await lerComLimite(f, resta)).length;
  }
}
