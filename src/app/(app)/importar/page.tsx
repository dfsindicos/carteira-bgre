import { Importar } from "@/components/importar";

export default function PaginaImportar() {
  return (
    <>
      <h1 className="text-2xl font-bold">Importar avaliações</h1>
      <p className="text-[14px] text-suave">
        Planilhas do Score Card no modelo da Brookfield, uma por prédio e trimestre: várias .xlsx ou um .zip da pasta (como o OneDrive baixa).
        Primeiro simule e confira; depois importe. As avaliações entram como entregues; o prédio e a administradora que não existirem são
        criados. Nenhum arquivo fica guardado.
      </p>
      <Importar />
    </>
  );
}
