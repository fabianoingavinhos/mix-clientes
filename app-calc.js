// Calculos compartilhados entre o app (navegador) e o agente (Node): roteiro do dia, dias uteis, metas e projecao.
// Mesmo arquivo em mix-clientes/app-calc.js e winthor-sync/src/calc.js.
(function (raiz) {
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const diffDias = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 864e5);
const addDias = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoLocal(d); };

// Uma loja e visitada no dia D se D = proxima_visita + k * periodicidade (k >= 0)
function visitaEm(r, iso) {
  if (!r.proxima_visita) return false;
  const d = diffDias(r.proxima_visita, iso);
  if (d === 0) return true;
  if (d < 0) return false;
  const per = +r.periodicidade || 0;
  return per > 0 && d % per === 0;
}

const diasSemana = (txt) => new Set(String(txt || '1,2,3,4,5,6').split(',').map((x) => +x.trim()).filter((x) => x >= 0 && x <= 6));

// Dias uteis do mes de "iso": total, anteriores a hoje e restantes (incluindo hoje)
function diasUteis(iso, diasTxt) {
  const ds = diasSemana(diasTxt);
  const d = parseIso(iso), y = d.getFullYear(), m = d.getMonth();
  const ult = new Date(y, m + 1, 0).getDate();
  let total = 0, antes = 0;
  for (let i = 1; i <= ult; i++) {
    if (!ds.has(new Date(y, m, i).getDay())) continue;
    total++;
    if (i < d.getDate()) antes++;
  }
  const hojeUtil = ds.has(d.getDay());
  return { total, antes, restantes: total - antes, hojeUtil };
}

// Fracao do dia util ja trabalhada (8h -> 0, 18h -> 1)
const fracaoDia = (agora = new Date()) => Math.min(1, Math.max(0, (agora.getHours() + agora.getMinutes() / 60 - 8) / 10));

/**
 * Resumo de um vendedor (ou de uma equipe, somando varios) num dia.
 * dados: { rotVend, rotProm, pedidos, presencas, entregas, promVisitas, clientes }
 * meta: { valor, positivacao, visitas } do mes
 */
function resumo(cods, dia, dados, meta, cfg, agora = new Date()) {
  const set = new Set(cods.map(Number));
  const doVend = (x) => set.has(Number(x.cod_vendedor));
  const mesIni = dia.slice(0, 8) + '01';
  const planejadas = new Set(dados.rotVend.filter((r) => doVend(r) && visitaEm(r, dia)).map((r) => r.codcli));
  const pres = dados.presencas.filter((p) => doVend(p) && p.data === dia && (p.duracao_seg || 0) >= (cfg.permanencia_min || 3) * 60);
  const visitadas = new Set(pres.map((p) => p.codcli));
  const pedDia = dados.pedidos.filter((p) => doVend(p) && p.data === dia);
  const pedMes = dados.pedidos.filter((p) => doVend(p) && p.data >= mesIni && p.data <= dia);
  const pedAteOntem = pedMes.filter((p) => p.data < dia);
  const soma = (a) => a.reduce((s, p) => s + (+p.valor || 0), 0);
  const posDia = new Set(pedDia.map((p) => p.codcli));
  const posMes = new Set(pedMes.map((p) => p.codcli));
  const carteira = dados.clientes.filter(doVend).length;
  const ent = dados.entregas.filter((e) => doVend(e) && e.data_ref === dia);
  const promRota = dados.rotProm.filter((r) => doVend(r) && visitaEm(r, dia));
  const promFeitas = dados.promVisitas.filter((v) => doVend(v) && v.data === dia && v.status === 'concluida');
  const du = diasUteis(dia, cfg.dias_uteis);
  const realMes = soma(pedMes), realDia = soma(pedDia), realAteOntem = soma(pedAteOntem);
  const metaMes = +meta.valor || 0;
  const gap = Math.max(0, metaMes - realMes);
  const metaDia = du.restantes > 0 ? Math.max(0, metaMes - realAteOntem) / du.restantes : 0;
  const decorridos = du.antes + (du.hojeUtil ? fracaoDia(agora) : 0);
  const projecao = decorridos > 0 ? realMes / decorridos * du.total : 0;
  return {
    dia, carteira,
    visitasPlanejadas: planejadas.size,
    visitadasPlanejadas: [...planejadas].filter((c) => visitadas.has(c)).length,
    visitadasTotal: visitadas.size,
    positivadosDia: posDia.size, positivadosMes: posMes.size, pedidosDia: pedDia.length,
    realDia, realMes, metaMes, metaDia, gap, projecao,
    pctMes: metaMes ? realMes / metaMes : 0, pctDia: metaDia ? realDia / metaDia : 0, pctProj: metaMes ? projecao / metaMes : 0,
    metaPositivacao: +meta.positivacao || 0,
    entregas: {
      total: ent.length,
      emRota: ent.filter((e) => e.status === 'em_rota').length,
      entregues: ent.filter((e) => e.status === 'entregue').length,
      problema: ent.filter((e) => ['nao_entregue', 'ocorrencia', 'devolvida'].includes(e.status)).length
    },
    promotor: { rota: new Set(promRota.map((r) => r.codcli)).size, feitas: promFeitas.length },
    dias: du
  };
}

const API = { isoLocal, addDias, diffDias, visitaEm, diasUteis, fracaoDia, resumo };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else raiz.AppCalc = API;
})(typeof window !== 'undefined' ? window : globalThis);
