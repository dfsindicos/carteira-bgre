// Prazos das demandas da BGRE (decisão do usuário de 2026-11-03: o SLA do Einstein como padrão, editável em
// /demandas/sla). Funções puras: sem banco e sem relógio implícito (quem chama passa "agora"). Feriados e dias úteis
// copiados do módulo Einstein (src/lib/prazos.ts de lá), com a opção de não contar os feriados.

export const CRITICIDADES = ["CRITICA", "URGENTE", "ORDINARIA", "COMPLEXA"] as const;
export type Criticidade = (typeof CRITICIDADES)[number];
export const UNIDADES = ["HORAS", "DIAS_UTEIS", "COMBINADO"] as const;
export type Unidade = (typeof UNIDADES)[number];

export const ROTULO_CRITICIDADE: Record<Criticidade, string> = { CRITICA: "Crítica", URGENTE: "Urgente", ORDINARIA: "Ordinária", COMPLEXA: "Complexa" };
export const ROTULO_UNIDADE: Record<Unidade, string> = { HORAS: "horas corridas", DIAS_UTEIS: "dias úteis", COMBINADO: "prazo combinado" };
export const USO_CRITICIDADE: Record<Criticidade, string> = {
  CRITICA: "Risco à segurança, às pessoas ou à operação do prédio. Na conclusão, conta o plano de ação.",
  URGENTE: "Pedido com data no mesmo dia ou no seguinte, cobrança da diretoria da BGRE.",
  ORDINARIA: "Documento, informação, aprovação de rotina.",
  COMPLEXA: "Estudo, orçamento, revisão de PO, assembleia. Conclusão no prazo combinado com a BGRE (até 10 dias úteis).",
};

export type Regra = { valor: number; unidade: Unidade };
export type RegraSla = { resposta: Regra; conclusao: Regra };
export type ConfigSla = { regras: Record<Criticidade, RegraSla>; contarFeriados: boolean; prazoEmailPrevalece: boolean };

/** O SLA do Einstein (referência de 30/09/2026): o padrão e o "Voltar ao padrão". */
export const SLA_PADRAO: ConfigSla = {
  regras: {
    CRITICA: { resposta: { valor: 1, unidade: "HORAS" }, conclusao: { valor: 4, unidade: "HORAS" } },
    URGENTE: { resposta: { valor: 4, unidade: "HORAS" }, conclusao: { valor: 1, unidade: "DIAS_UTEIS" } },
    ORDINARIA: { resposta: { valor: 1, unidade: "DIAS_UTEIS" }, conclusao: { valor: 5, unidade: "DIAS_UTEIS" } },
    COMPLEXA: { resposta: { valor: 2, unidade: "DIAS_UTEIS" }, conclusao: { valor: 10, unidade: "COMBINADO" } },
  },
  contarFeriados: true,
  prazoEmailPrevalece: true,
};

export const descreverRegra = (r: Regra) => (r.unidade === "COMBINADO" ? `prazo combinado (até ${r.valor} dias úteis)` : `${r.valor} ${r.unidade === "HORAS" ? (r.valor === 1 ? "hora corrida" : "horas corridas") : r.valor === 1 ? "dia útil" : "dias úteis"}`);

const HORA = 3_600_000;
const DIA = 24 * HORA;
// O Brasil não tem horário de verão desde 2019: São Paulo é sempre UTC-3.
const OFFSET_SP = -3 * HORA;
const sp = (d: Date) => new Date(d.getTime() + OFFSET_SP); // "relógio de parede" de SP lido com getUTC*
const deSp = (d: Date) => new Date(d.getTime() - OFFSET_SP);
const chave = (d: Date) => d.toISOString().slice(0, 10);

function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const cacheFeriados = new Map<number, Set<string>>();
/** Feriados nacionais, do estado e da cidade de São Paulo, mais Carnaval (AAAA-MM-DD). */
export function feriados(ano: number): Set<string> {
  const pronto = cacheFeriados.get(ano);
  if (pronto) return pronto;
  const fixos = ["01-01", "01-25", "04-21", "05-01", "07-09", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
  const set = new Set(fixos.map((md) => `${ano}-${md}`));
  const p = pascoa(ano).getTime();
  for (const delta of [-48, -47, -2, 60]) set.add(chave(new Date(p + delta * DIA))); // Carnaval (2ª e 3ª), Sexta-feira Santa, Corpus Christi
  cacheFeriados.set(ano, set);
  return set;
}

export function ehDiaUtil(data: Date, contarFeriados = true): boolean {
  const l = sp(data);
  const dow = l.getUTCDay();
  return dow !== 0 && dow !== 6 && !(contarFeriados && feriados(l.getUTCFullYear()).has(chave(l)));
}

/** Soma n dias úteis mantendo o horário. Se o início cai em dia não útil, conta a partir das 8h do próximo dia útil. */
export function somarDiasUteis(inicio: Date, n: number, contarFeriados = true): Date {
  let d = new Date(inicio);
  if (!ehDiaUtil(d, contarFeriados)) {
    while (!ehDiaUtil(d, contarFeriados)) d = new Date(d.getTime() + DIA);
    const l = sp(d);
    d = deSp(new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 8)));
  }
  let restam = n;
  while (restam > 0) {
    d = new Date(d.getTime() + DIA);
    if (ehDiaUtil(d, contarFeriados)) restam--;
  }
  return d;
}

export const somarHoras = (inicio: Date, h: number) => new Date(inicio.getTime() + h * HORA);

/** Fim do dia (23:59:59 de São Paulo) de uma data sem hora (AAAA-MM-DD, ou Date de coluna @db.Date). */
export function fimDoDia(data: Date | string): Date {
  const d = typeof data === "string" ? new Date(`${data}T00:00:00Z`) : data;
  return deSp(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59)));
}

/** "AAAA-MM-DDTHH:mm" (campo datetime-local) lido como horário de São Paulo. */
export function lerDataHoraSP(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const [, a, me, di, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const d = deSp(new Date(Date.UTC(a, me - 1, di, h, mi)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** O contrário de lerDataHoraSP, para preencher o campo. */
export const paraDataHoraSP = (d: Date) => sp(d).toISOString().slice(0, 16);

/** Limite de uma regra a partir do início; prazo combinado não tem limite calculado (null). */
export function limite(inicio: Date, r: Regra, contarFeriados = true): Date | null {
  if (r.unidade === "HORAS") return somarHoras(inicio, r.valor);
  if (r.unidade === "DIAS_UTEIS") return somarDiasUteis(inicio, r.valor, contarFeriados);
  return null;
}

export type DemandaPrazo = {
  criticidade: Criticidade;
  chegadaEm: Date;
  prazoEmail: Date | null;
  prazoCombinado: Date | null;
  primeiraRespostaEm: Date | null;
  situacao: string;
  concluidaEm: Date | null;
};

export const SITUACOES_ABERTAS = ["ABERTA", "EM_ANDAMENTO", "AGUARDANDO"];
export const estaAberta = (d: { situacao: string }) => SITUACOES_ABERTAS.includes(d.situacao);

export const prazoResposta = (d: DemandaPrazo, cfg: ConfigSla) => limite(d.chegadaEm, cfg.regras[d.criticidade].resposta, cfg.contarFeriados);

export type OrigemPrazo = "email" | "sla" | "combinado" | "a-combinar";
/**
 * Prazo de conclusão: o escrito no e-mail (se a configuração mandar ele prevalecer); senão o do SLA; na unidade
 * "prazo combinado", a data combinada com a BGRE (ou a do e-mail), e sem ela, "a combinar".
 */
export function prazoConclusao(d: DemandaPrazo, cfg: ConfigSla): { em: Date | null; origem: OrigemPrazo } {
  if (d.prazoEmail && cfg.prazoEmailPrevalece) return { em: fimDoDia(d.prazoEmail), origem: "email" };
  const regra = cfg.regras[d.criticidade].conclusao;
  if (regra.unidade === "COMBINADO") {
    if (d.prazoCombinado) return { em: fimDoDia(d.prazoCombinado), origem: "combinado" };
    if (d.prazoEmail) return { em: fimDoDia(d.prazoEmail), origem: "email" };
    return { em: null, origem: "a-combinar" };
  }
  return { em: limite(d.chegadaEm, regra, cfg.contarFeriados), origem: "sla" };
}

export type Tom = "erro" | "atencao" | "ok" | "info" | "neutro";
export type Etiqueta = { tom: Tom; texto: string };

const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
/** "30/10 16h42" no horário de São Paulo. */
export const diaHora = (d: Date) => fmt.format(d).replace(", ", " ").replace(":", "h");
export const diaMes = (d: Date) => fmtDia.format(d);

/** Situação da 1ª resposta: respondida (no prazo ou não), vencida ou o limite. */
export function situacaoResposta(d: DemandaPrazo, cfg: ConfigSla, agora: Date): Etiqueta {
  const lim = prazoResposta(d, cfg);
  if (d.primeiraRespostaEm) {
    if (!lim || d.primeiraRespostaEm <= lim) return { tom: "ok", texto: `Respondida ${diaHora(d.primeiraRespostaEm)}` };
    return { tom: "atencao", texto: `Respondida com atraso (${diaHora(d.primeiraRespostaEm)})` };
  }
  if (!estaAberta(d)) return { tom: "neutro", texto: "Sem 1ª resposta registrada" };
  if (!lim) return { tom: "neutro", texto: "Sem prazo de resposta" };
  if (agora > lim) return { tom: "erro", texto: `Sem resposta · venceu ${diaHora(lim)}` };
  return { tom: "atencao", texto: `Responder até ${diaHora(lim)}` };
}

/** Situação do prazo de conclusão, com a cor do protótipo (vermelho até 2 dias, âmbar até 7). */
export function situacaoPrazo(d: DemandaPrazo, cfg: ConfigSla, agora: Date): Etiqueta {
  const { em } = prazoConclusao(d, cfg);
  if (!em) return { tom: "neutro", texto: d.situacao === "CONCLUIDA" ? "Concluída" : "Prazo a combinar" };
  const ds = diaMes(em);
  if (d.situacao === "ARQUIVADA") return { tom: "neutro", texto: `Arquivada · prazo ${ds}` };
  if (d.situacao === "CONCLUIDA") return d.concluidaEm && d.concluidaEm <= em ? { tom: "ok", texto: `Cumprido · ${ds}` } : { tom: "atencao", texto: `Concluída após ${ds}` };
  const dias = (em.getTime() - agora.getTime()) / DIA;
  if (dias < 0) return { tom: "erro", texto: `Venceu ${ds}` };
  if (dias < 1 && diaMes(agora) === ds) return { tom: "erro", texto: "Vence hoje" };
  if (dias <= 2) return { tom: "erro", texto: `Vence ${ds}` };
  if (dias <= 7) return { tom: "atencao", texto: `Vence ${ds}` };
  return { tom: "info", texto: ds };
}

/** Prazo vencido (aberta e passou do prazo de conclusão). */
export const vencida = (d: DemandaPrazo, cfg: ConfigSla, agora: Date) => {
  const { em } = prazoConclusao(d, cfg);
  return estaAberta(d) && !!em && em < agora;
};
