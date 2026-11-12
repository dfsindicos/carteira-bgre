import { z } from "zod";
import { prisma } from "./db";
import { registrar } from "./avaliacoes";
import { acharCondominioPorNome, normalizar } from "./comum";

// Cadastro mestre (decisão do usuário de 2026-11-12: "o mestre fica no Action Log"). De hora em hora este sistema lê
// o cadastro do Action Log (GET /api/integracao/cadastro?sistema=bgre) e acerta a cópia daqui:
// - administradoras: casa pelo código; na primeira vez, pelo nome sem acento, caixa e pontuação. Ligada, o nome segue o
//   mestre. Nova só é criada quando um condomínio ligado precisa dela. Os e-mails do pedido de evidências são daqui e
//   nunca são tocados;
// - condomínios: casa pelo código; na primeira vez, pelo nome ou por um dos outros nomes (o parênteses conta). Ligado
//   para a Carteira BGRE: entra se faltar; nome e administradora seguem o mestre. Desligado ou arquivado lá vira inativo
//   aqui (nada se apaga; avaliações, Flash Report e histórico ficam). Condomínio que só existe aqui não é tocado.
// Avaliações, flashSlug e "avaliado desde" são só daqui. Rodar duas vezes dá o mesmo resultado; só o que muda grava
// LogAlteracao, em nome de QUEM.

export const QUEM = "cadastro-mestre@actionlog";

const esquema = z.object({
  condominios: z.array(
    z.object({
      codigo: z.string().min(1),
      nome: z.string().trim().min(1).max(120),
      outrosNomes: z.array(z.string()).default([]),
      administradora: z.string().nullable().optional(),
      ativo: z.boolean(),
    }),
  ),
  administradoras: z.array(z.object({ codigo: z.string().min(1), nome: z.string().trim().min(1).max(120) })),
});
export type DadosMestre = z.input<typeof esquema>;

export type ResumoSincronizacao = {
  administradoras: { ligadas: number; criadas: number; renomeadas: number };
  condominios: { criados: number; atualizados: number; inativados: number; juntados: number };
  soAqui: string[];
  conflitos: string[];
};

type ComNome = { id: string; nome: string; codigoMestre: string | null };

/** Linha local do condomínio do mestre: pelo código; sem código, pelo nome ou outro nome (só entre as que não têm código). */
function acharLocal<T extends ComNome>(linhas: T[], m: { codigo: string; nome: string; outrosNomes: string[] }): T | undefined {
  const porCodigo = linhas.find((l) => l.codigoMestre === m.codigo);
  if (porCodigo) return porCodigo;
  return acharSemCodigo(linhas, m);
}

function acharSemCodigo<T extends ComNome>(linhas: T[], m: { nome: string; outrosNomes: string[] }): T | undefined {
  const livres = linhas.filter((l) => !l.codigoMestre);
  for (const n of [m.nome, ...m.outrosNomes]) {
    const achado = acharCondominioPorNome(livres, n);
    if (achado) return achado;
  }
  return undefined;
}

export async function sincronizarComMestre(entrada: unknown, agora = new Date()): Promise<ResumoSincronizacao> {
  const d = esquema.parse(entrada);
  // Trava: sem nenhum condomínio ligado à Carteira BGRE no Action Log (ex.: antes de marcar as chaves), não faz nada;
  // senão a primeira leitura inativaria todos os condomínios daqui. Vira "falhou" com o motivo na tela.
  if (!d.condominios.some((c) => c.ativo)) throw new Error("nenhum condomínio ligado à Carteira BGRE no Action Log (Configurações → Sistemas): nada foi feito");
  const r: ResumoSincronizacao = {
    administradoras: { ligadas: 0, criadas: 0, renomeadas: 0 },
    condominios: { criados: 0, atualizados: 0, inativados: 0, juntados: 0 },
    soAqui: [],
    conflitos: [],
  };

  await prisma.$transaction(
    async (tx) => {
      // Uma sincronização por vez (a da hora e um "Sincronizar agora" juntos).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7712027)`;

      // 1. Administradoras: liga e renomeia as que já existem; as que faltam ficam para quando um condomínio precisar.
      const adms = await tx.administradora.findMany({ select: { id: true, nome: true, codigoMestre: true } });
      const admDe = new Map<string, string>();
      for (const ma of d.administradoras) {
        const a = adms.find((l) => l.codigoMestre === ma.codigo) ?? adms.find((l) => !l.codigoMestre && normalizar(l.nome) === normalizar(ma.nome));
        if (!a) continue;
        if (!a.codigoMestre) {
          await tx.administradora.update({ where: { id: a.id }, data: { codigoMestre: ma.codigo } });
          await registrar(tx, QUEM, "Administradora", a.id, "ligada ao cadastro mestre", null, ma.nome);
          a.codigoMestre = ma.codigo;
          r.administradoras.ligadas++;
        }
        if (a.nome !== ma.nome) {
          if (adms.some((x) => x.id !== a.id && x.nome === ma.nome)) r.conflitos.push(`Administradora ${a.nome}: o nome do Action Log (${ma.nome}) já existe aqui`);
          else {
            await tx.administradora.update({ where: { id: a.id }, data: { nome: ma.nome } });
            await registrar(tx, QUEM, "Administradora", a.id, "nome", a.nome, ma.nome);
            a.nome = ma.nome;
            r.administradoras.renomeadas++;
          }
        }
        admDe.set(ma.codigo, a.id);
      }

      /** Id local da administradora do mestre; cria se faltar (só chamado para condomínio ligado). */
      const administradoraPara = async (codigo: string | null | undefined, condominio: string): Promise<string | undefined> => {
        if (!codigo) return undefined;
        const ja = admDe.get(codigo);
        if (ja) return ja;
        const ma = d.administradoras.find((a) => a.codigo === codigo);
        if (!ma) {
          r.conflitos.push(`${condominio}: a administradora do Action Log não veio no cadastro`);
          return undefined;
        }
        if (adms.some((x) => x.nome === ma.nome)) {
          r.conflitos.push(`Administradora ${ma.nome}: já existe aqui ligada a outro código`);
          return undefined;
        }
        const nova = await tx.administradora.create({ data: { nome: ma.nome, codigoMestre: ma.codigo }, select: { id: true, nome: true, codigoMestre: true } });
        await registrar(tx, QUEM, "Administradora", nova.id, "incluída pelo cadastro mestre", null, ma.nome);
        adms.push(nova);
        admDe.set(codigo, nova.id);
        r.administradoras.criadas++;
        return nova.id;
      };

      // 2. Condomínios.
      const conds = await tx.condominio.findMany({ select: { id: true, nome: true, codigoMestre: true, ativo: true, administradoraId: true } });
      for (const m of d.condominios) {
        let c = acharLocal(conds, m);
        // Juntar duplicado (problema visto pelo usuário em 2026-11-12): a 1ª leitura criou um condomínio novo porque o nome
        // antigo não casava; depois que o nome casa (outros nomes no Action Log ou pontuação), o antigo, com as avaliações,
        // fica com o código e o novo, se ainda estiver vazio, é retirado.
        if (c?.codigoMestre === m.codigo) {
          const antigo = acharSemCodigo(conds.filter((x) => x.ativo), m);
          const vazio = async (id: string) =>
            (await tx.avaliacao.count({ where: { condominioId: id } })) === 0 &&
            (await tx.flashSemana.count({ where: { condominioId: id } })) === 0 &&
            (await tx.demanda.count({ where: { condominioId: id } })) === 0 &&
            !(await tx.condominio.findUniqueOrThrow({ where: { id }, select: { flashSlug: true } })).flashSlug;
          if (antigo && antigo.id !== c.id && (await vazio(c.id))) {
            await tx.condominio.delete({ where: { id: c.id } });
            await registrar(tx, QUEM, "Condominio", c.id, "retirado: duplicado vazio, juntado a " + antigo.nome, c.nome, null);
            conds.splice(conds.indexOf(c), 1);
            c = antigo;
            r.condominios.juntados++;
          }
        }
        if (!m.ativo) {
          // Desligado ou arquivado no Action Log: inativo aqui, sem apagar nada. Não entra se ainda não existe.
          if (!c || (!c.ativo && c.codigoMestre === m.codigo)) continue;
          const dados: { codigoMestre?: string; ativo?: boolean } = {};
          if (c.codigoMestre !== m.codigo) dados.codigoMestre = m.codigo;
          if (c.ativo) dados.ativo = false;
          await tx.condominio.update({ where: { id: c.id }, data: dados });
          if (dados.codigoMestre) await registrar(tx, QUEM, "Condominio", c.id, "ligado ao cadastro mestre", null, m.nome);
          if (dados.ativo === false) {
            await registrar(tx, QUEM, "Condominio", c.id, "ativo", "true", "false");
            r.condominios.inativados++;
          } else r.condominios.atualizados++;
          Object.assign(c, dados);
          continue;
        }

        const administradoraId = await administradoraPara(m.administradora, m.nome);
        if (!c) {
          if (conds.some((x) => x.nome === m.nome)) {
            r.conflitos.push(`${m.nome}: já existe aqui ligado a outro código`);
            continue;
          }
          if (!administradoraId) {
            r.conflitos.push(`${m.nome}: sem administradora no Action Log, não foi incluído`);
            continue;
          }
          const novo = await tx.condominio.create({
            data: { nome: m.nome, administradoraId, codigoMestre: m.codigo },
            select: { id: true, nome: true, codigoMestre: true, ativo: true, administradoraId: true },
          });
          await registrar(tx, QUEM, "Condominio", novo.id, "incluído pelo cadastro mestre", null, m.nome);
          conds.push(novo);
          r.condominios.criados++;
          continue;
        }

        const dados: { codigoMestre?: string; nome?: string; administradoraId?: string; ativo?: boolean } = {};
        if (c.codigoMestre !== m.codigo) dados.codigoMestre = m.codigo;
        if (c.nome !== m.nome) {
          if (conds.some((x) => x.id !== c.id && x.nome === m.nome)) r.conflitos.push(`${c.nome}: o nome do Action Log (${m.nome}) já existe aqui`);
          else dados.nome = m.nome;
        }
        if (administradoraId && c.administradoraId !== administradoraId) dados.administradoraId = administradoraId;
        if (!c.ativo) dados.ativo = true;
        if (!Object.keys(dados).length) continue;
        await tx.condominio.update({ where: { id: c.id }, data: dados });
        // Mesmos campos e formato do log da tela de Cadastro (src/lib/cadastro.ts).
        if (dados.codigoMestre) await registrar(tx, QUEM, "Condominio", c.id, "ligado ao cadastro mestre", null, m.nome);
        if (dados.nome) await registrar(tx, QUEM, "Condominio", c.id, "nome", c.nome, dados.nome);
        if (dados.administradoraId) await registrar(tx, QUEM, "Condominio", c.id, "administradoraId", c.administradoraId, dados.administradoraId);
        if (dados.ativo) await registrar(tx, QUEM, "Condominio", c.id, "ativo", "false", "true");
        r.condominios.atualizados++;
        Object.assign(c, dados);
      }
      r.conflitos = [...new Set(r.conflitos)];
      r.soAqui = conds.filter((c) => !c.codigoMestre && c.ativo).map((c) => c.nome).sort((a, b) => a.localeCompare(b, "pt-BR"));

      await tx.sincronizacaoMestre.create({ data: { em: agora, ok: true, resumo: r } });
    },
    { timeout: 60_000 },
  );
  return r;
}

/** Lê o mestre e sincroniza. Falha (Action Log fora, token errado) fica registrada e a cópia segue como estava. */
export async function executarSincronizacao(
  agora = new Date(),
  buscar: typeof fetch = fetch,
): Promise<{ ok: true; resumo: ResumoSincronizacao } | { ok: false; erro: string }> {
  const token = process.env.INTEGRACAO_TOKEN;
  const url = (process.env.MESTRE_URL || "https://actionlog.gestaodfsindicos.tech").replace(/\/$/, "");
  let erro: string;
  if (!token) erro = "INTEGRACAO_TOKEN não configurado no servidor.";
  else {
    try {
      const resp = await buscar(`${url}/api/integracao/cadastro?sistema=bgre`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      if (!resp.ok) throw new Error(`o Action Log respondeu ${resp.status}`);
      return { ok: true, resumo: await sincronizarComMestre(await resp.json(), agora) };
    } catch (e) {
      erro = e instanceof z.ZodError ? "resposta do Action Log fora do formato" : e instanceof Error ? e.message : "falha desconhecida";
    }
  }
  await prisma.sincronizacaoMestre.create({ data: { em: agora, ok: false, resumo: { erro } } });
  return { ok: false, erro };
}

/** A última sincronização e a última que deu certo, para a tela de Cadastro. */
export async function estadoDoMestre() {
  const [ultima, ultimaOk] = await Promise.all([
    prisma.sincronizacaoMestre.findFirst({ orderBy: { em: "desc" } }),
    prisma.sincronizacaoMestre.findFirst({ where: { ok: true }, orderBy: { em: "desc" } }),
  ]);
  return {
    ultima: ultima ? { em: ultima.em, ok: ultima.ok, erro: ultima.ok ? null : String((ultima.resumo as { erro?: string }).erro ?? "") } : null,
    ultimaOk: ultimaOk ? { em: ultimaOk.em, resumo: ultimaOk.resumo as unknown as ResumoSincronizacao } : null,
  };
}
