import { Importar } from "@/components/importar";
import { ImportarJson } from "@/components/importar-json";

export default function PaginaImportar() {
  return (
    <>
      <h1 className="text-2xl font-bold">Importar avaliações</h1>
      <section className="grid gap-3">
        <h2 className="text-lg font-bold">Planilhas do Score Card</h2>
        <p className="text-[14px] text-suave">
          Planilhas no modelo da Brookfield, da Administradora ou da Sindicância, uma por prédio e trimestre: várias .xlsx ou um .zip da pasta (como o
          OneDrive baixa). Primeiro simule e confira; depois importe. As avaliações entram como enviadas à BGRE (passo 4 do checklist); o prédio e a
          administradora que não existirem são criados (na Sindicância, o prédio precisa existir). Nenhum arquivo fica guardado.
        </p>
        <Importar />
      </section>
      <section className="grid gap-3 border-t border-borda pt-4">
        <h2 className="text-lg font-bold">Checklist e notas (JSON)</h2>
        <p className="text-[14px] text-suave">
          O .json exportado do acompanhamento: o checklist (os 4 passos com a data), o andamento e a nota estimada de cada avaliação e, quando vierem
          os “itens”, as notas e os comentários. O condomínio é achado pelo nome, sem acento, caixa, pontuação e o texto entre parênteses; quem não
          bater mostra o parecido e um seletor. A avaliação que não existir é criada. Reimportar o mesmo arquivo não muda nada.
        </p>
        <ImportarJson />
      </section>
    </>
  );
}
