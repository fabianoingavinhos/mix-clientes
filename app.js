/* =====================================================================
   Mix Campo — app do vendedor e do supervisor
   Início (missões do dia), roteiro do vendedor, roteiro do promotor, entregas,
   desempenho (visitas presenciais e positivação), oportunidades/estoque e equipe.
   A visita presencial é registrada sozinha: 3 min dentro do raio da loja.
   ===================================================================== */
(async () => {
  const { sb, esc, el, fmtBRL, fmtInt, fmtDate } = Mix;
  const C = window.AppCalc;
  const root = el("root");
  const hoje = () => C.isoLocal();
  const brl = (v) => fmtBRL.format(Math.round(+v || 0)).replace(/,00$/, "");
  const pct = (v) => Math.round((+v || 0) * 100) + "%";
  const hm = (ts) => ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";
  const dur = (s) => { s = Math.round(+s || 0); const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`; };
  const toast = (t, k) => Mix.toast(t, k);
  const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };

  if (!sb) { root.innerHTML = `<div class="ap-main"><div class="msg err">config.js sem Supabase configurado.</div></div>`; return; }

  // ------------------------------------------------------------------ login
  let ctx = await Mix.getSessionProfile();
  if (!ctx) {
    root.innerHTML = `
      <div class="login-app">
        <form class="card login-card" id="lf" style="width:100%;max-width:360px;padding:22px">
          <div class="brand" style="display:flex;gap:10px;align-items:center;margin-bottom:14px"><div class="mark" style="background:var(--brand);color:#fff;border-radius:10px;width:42px;height:42px;display:grid;place-items:center;font-weight:800">M</div>
            <div><b>Mix Campo</b><div class="muted" style="font-size:13px">Vendedores e supervisores</div></div></div>
          <div class="field"><label>Usuário</label><input type="text" id="lu" autocomplete="username" autocapitalize="none" required></div>
          <div class="field"><label>Senha</label><input type="password" id="lp" autocomplete="current-password" required></div>
          <div id="lm"></div>
          <button class="btn block" id="lb">Entrar</button>
          ${window.Capacitor ? "" : `<a href="baixar.html" style="display:block;text-align:center;margin-top:14px;font-size:14px">📲 Baixar o app para Android</a>`}
        </form>
      </div>`;
    el("lf").onsubmit = async (e) => {
      e.preventDefault(); el("lb").disabled = true;
      try { await Mix.login(el("lu").value, el("lp").value); location.reload(); }
      catch (err) { Mix.showMsg(el("lm"), err.message, "err"); el("lb").disabled = false; }
    };
    return;
  }
  const P = ctx.profile;
  const SUP = P.role !== "vendedor";

  // ------------------------------------------------------------------ estado
  const S = {
    cfg: { raio_padrao_m: 80, permanencia_min: 3, hora_inicio: 6, hora_fim: 20, dias_uteis: "1,2,3,4,5,6" },
    sel: SUP ? LS.get("mc.sel", "") : String(P.cod_vendedor),
    clientes: [], cli: new Map(), geo: new Map(), rotVend: [], rotProm: [], pedidos: [], presencas: [], entregas: [], promVisitas: [],
    metasV: [], metaCalc: new Map(), notifs: [], mix: null, carregadoEm: null, erroCarga: null,
    rota: decodeURIComponent(location.hash.replace("#", "")) || "inicio", promDia: hoje(), entFiltro: "todos", entDias: 1, desPeriodo: "hoje", oppFiltro: "roteiro"
  };

  async function tudo(tabela, cols, filtro) {
    const out = []; const PAGE = 1000;
    for (let de = 0; ; de += PAGE) {
      let q = sb.from(tabela).select(cols).range(de, de + PAGE - 1);
      if (filtro) q = filtro(q);
      const { data, error } = await q;
      if (error) { if (/does not exist|schema cache|relation/i.test(error.message)) return []; throw error; }
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  async function carregar() {
    const d31 = C.addDias(hoje(), -35), d7 = C.addDias(hoje(), -7);
    try {
      const [cfg, clientes, geo, rotVend, rotProm, pedidos, presencas, entregas, promVisitas, metasV, metasCli] = await Promise.all([
        sb.from("app_config").select("*").eq("id", 1).maybeSingle().then((r) => r.data),
        tudo("clientes", "codcli,cliente,fantasia,cnpj_cpf,endereco,numero,bairro,cidade,uf,telefone,cod_vendedor,vendedor,cod_supervisor,supervisor,ultima_compra,dias_sem_comprar"),
        tudo("lojas_geo", "codcli,lat,lng,raio_m,origem"),
        tudo("roteiro_vendedor", "codcli,cod_vendedor,vendedor,cod_supervisor,proxima_visita,periodicidade,sequencia_visita,horario_visita,dia_semana"),
        tudo("roteiro", "codcli,cliente,fantasia,cod_vendedor,cod_supervisor,cod_promotor,promotor,proxima_visita,periodicidade,sequencia_visita,horario_visita"),
        tudo("pedidos_mes", "numped,data,hora,codcli,cod_vendedor,cod_supervisor,valor,posicao"),
        tudo("presencas", "codcli,cod_vendedor,cod_supervisor,user_id,data,inicio,fim,duracao_seg,distancia_m", (q) => q.gte("data", d31)),
        tudo("entregas", "*", (q) => q.gte("data_ref", d7)),
        tudo("promotor_visitas", "*", (q) => q.gte("data", d7)),
        tudo("metas_vendedor", "*", (q) => q.eq("mes", hoje().slice(0, 8) + "01")),
        sb.rpc("metas_clientes").then((r) => r.data || [], () => [])
      ]);
      if (cfg) Object.assign(S.cfg, cfg);
      S.clientes = clientes; S.cli = new Map(clientes.map((c) => [c.codcli, c]));
      S.geo = new Map(geo.map((g) => [g.codcli, g]));
      Object.assign(S, { rotVend, rotProm, pedidos, presencas, entregas, promVisitas, metasV });
      S.metaCalc = new Map();
      const pctV = (Mix.cfg.METAS && Mix.cfg.METAS.valor) ?? 15;
      metasCli.forEach((r) => { const k = Number(r.cod_vendedor); if (k) S.metaCalc.set(k, (S.metaCalc.get(k) || 0) + (+r.base_valor || 0) * (1 + pctV / 100)); });
      S.carregadoEm = new Date(); S.erroCarga = null;
    } catch (e) { S.erroCarga = e.message; }
    await carregarAvisos();
  }

  async function carregarAvisos() {
    const { data } = await sb.from("notificacoes").select("*").eq("user_id", P.id).order("criado_em", { ascending: false }).limit(60);
    S.notifs = data || [];
  }

  // ------------------------------------------------------------------ escopo (vendedor / equipe)
  function vendedores() {
    const m = new Map();
    S.clientes.forEach((c) => { if (c.cod_vendedor != null) m.set(Number(c.cod_vendedor), c.vendedor || "Vendedor " + c.cod_vendedor); });
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "pt-BR"));
  }
  const cods = () => S.sel ? [Number(S.sel)] : vendedores().map(([c]) => c);
  const doEscopo = (x) => cods().includes(Number(x.cod_vendedor));
  const metaDe = (cs) => cs.reduce((a, c) => {
    const w = S.metasV.find((m) => Number(m.cod_vendedor) === c);
    a.valor += +(w?.meta_valor ?? S.metaCalc.get(c) ?? 0); a.positivacao += +(w?.meta_positivacao || 0); a.visitas += +(w?.meta_visitas || 0);
    if (w) a.origem = "winthor"; return a;
  }, { valor: 0, positivacao: 0, visitas: 0, origem: "calculada" });
  const dados = () => ({ rotVend: S.rotVend, rotProm: S.rotProm, pedidos: S.pedidos, presencas: S.presencas.filter((p) => p.cod_vendedor != null), entregas: S.entregas, promVisitas: S.promVisitas, clientes: S.clientes });
  const resumoDia = (dia, cs = cods()) => C.resumo(cs, dia, dados(), metaDe(cs), S.cfg);
  const nomeCli = (codcli) => { const c = S.cli.get(codcli); return c ? (c.fantasia || c.cliente) : "Cliente " + codcli; };
  const minPerm = () => (S.cfg.permanencia_min || 3) * 60;
  const visitouPres = (codcli, dia) => S.presencas.find((p) => p.codcli === codcli && p.data === dia && p.cod_vendedor != null && doEscopo(p) && p.duracao_seg >= minPerm());
  const pedidosDe = (codcli, dia) => S.pedidos.filter((p) => p.codcli === codcli && (!dia || p.data === dia));
  const corPct = (v) => v >= 1 ? "ok" : v >= .8 ? "warn" : "bad";
  const barra = (v, marca) => `<div class="pbar ${corPct(v)}"><div style="width:${Math.min(100, Math.round(v * 100))}%"></div>${marca != null ? `<span class="mk" style="left:${Math.min(100, Math.round(marca * 100))}%"></span>` : ""}</div>`;

  // ------------------------------------------------------------------ GPS: presença automática
  const G = { watch: null, pos: null, loja: null, desde: null, ultimoEnvio: 0, status: "off", msg: "", pendentes: LS.get("mc.pend", []) };
  const dist = (a, b, c, d) => { const R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function lojaProxima(lat, lng) {
    let best = null;
    for (const [codcli, g] of S.geo) {
      if (!S.cli.has(codcli)) continue;
      const d = dist(lat, lng, g.lat, g.lng);
      if (!best || d < best.d) best = { codcli, d, raio: g.raio_m || S.cfg.raio_padrao_m || 80 };
    }
    return best;
  }
  async function enviarPresenca(p) {
    const { error } = await sb.rpc("app_registrar_presenca", p);
    if (error) { if (!/carteira|inválido|encontrado/.test(error.message)) { G.pendentes.push(p); LS.set("mc.pend", G.pendentes.slice(-200)); } return false; }
    return true;
  }
  async function reenviarPendentes() {
    if (!G.pendentes.length || !navigator.onLine) return;
    const fila = G.pendentes.splice(0); LS.set("mc.pend", []);
    for (const p of fila) await enviarPresenca(p);
  }
  function onPos(pos) {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    G.pos = { lat, lng, acc: accuracy, em: Date.now() };
    avaliar(lat, lng, accuracy);
  }
  // Reavalia a cada 30 s com a última posição: parado na loja o GPS pode não mandar leitura nova
  setInterval(() => { if (G.pos && Date.now() - G.pos.em < 10 * 60000) avaliar(G.pos.lat, G.pos.lng, G.pos.acc); }, 30000);
  function avaliar(lat, lng, accuracy) {
    const h = new Date().getHours();
    if (h < S.cfg.hora_inicio || h >= S.cfg.hora_fim) { G.status = "pausa"; G.msg = "fora do horário de trabalho"; return pintarGps(); }
    if (accuracy > 150) { G.status = "on"; G.msg = `sinal fraco (±${Math.round(accuracy)} m)`; return pintarGps(); }
    const b = lojaProxima(lat, lng);
    const folga = Math.min(accuracy, 50);
    if (b && b.d <= b.raio + folga) {
      if (G.loja !== b.codcli) { G.loja = b.codcli; G.desde = Date.now(); }
      const tempo = (Date.now() - G.desde) / 1000;
      G.status = "on";
      G.msg = tempo >= minPerm() ? `✔ visita registrada em ${nomeCli(b.codcli)}` : `em ${nomeCli(b.codcli)} há ${Math.floor(tempo / 60)} min`;
      if (tempo >= minPerm() && Date.now() - G.ultimoEnvio >= 60000) {
        G.ultimoEnvio = Date.now();
        const p = { p_codcli: b.codcli, p_inicio: new Date(G.desde).toISOString(), p_fim: new Date().toISOString(), p_lat: lat, p_lng: lng, p_precisao: Math.round(accuracy), p_distancia: Math.round(b.d) };
        enviarPresenca(p).then((ok) => {
          if (!ok) return;
          const d = hoje(), ex = S.presencas.find((x) => x.codcli === b.codcli && x.data === d && x.user_id === P.id);
          if (ex) { ex.fim = p.p_fim; ex.duracao_seg = Math.max(ex.duracao_seg, Math.round(tempo)); }
          else S.presencas.push({ codcli: b.codcli, cod_vendedor: SUP ? null : P.cod_vendedor, cod_supervisor: P.cod_supervisor, user_id: P.id, data: d, inicio: p.p_inicio, fim: p.p_fim, duracao_seg: Math.round(tempo), distancia_m: p.p_distancia });
          if (["inicio", "roteiro", "desempenho"].includes(S.rota)) render();
        });
      }
    } else if (!b || b.d > b.raio + folga + 40) {
      G.loja = null; G.desde = null; G.status = "on";
      G.msg = b ? `loja mais próxima: ${nomeCli(b.codcli)} a ${b.d > 1000 ? (b.d / 1000).toFixed(1) + " km" : Math.round(b.d) + " m"}` : "nenhuma loja com localização";
    }
    pintarGps();
  }
  function onErr(e) { G.status = "err"; G.msg = e.code === 1 ? "localização bloqueada — permita nas configurações" : "sem sinal de GPS"; pintarGps(); }
  const CAP = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function iniciarGps() {
    if (G.watch != null) return;
    // App Android instalado: localização em segundo plano (continua com a tela desligada)
    const BG = CAP && window.Capacitor.Plugins.BackgroundGeolocation;
    if (BG) {
      G.watch = "cap";
      BG.addWatcher({ backgroundTitle: "Mix Campo", backgroundMessage: "Registrando suas visitas às lojas", requestPermissions: true, stale: false, distanceFilter: 15 },
        (loc, err) => {
          if (err) { if (err.code === "NOT_AUTHORIZED") { G.status = "err"; G.msg = "permita a localização \"o tempo todo\" nas configurações"; if (confirm("Para registrar as visitas com a tela desligada, permita a localização o tempo todo. Abrir configurações?")) BG.openSettings(); } else onErr({}); pintarGps(); return; }
          onPos({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy } });
        }).then((id) => { G.capId = id; });
      LS.set("mc.gps", true); G.status = "on"; G.msg = "procurando sinal…"; pintarGps();
      return;
    }
    if (!("geolocation" in navigator)) { G.status = "err"; G.msg = "aparelho sem GPS"; return; }
    G.watch = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 20000, timeout: 60000 });
    LS.set("mc.gps", true); G.status = "on"; G.msg = "procurando sinal…"; pintarGps();
  }
  function pintarGps() {
    const e = el("gpsLinha"); if (!e) return;
    e.innerHTML = `<span class="pt ${G.status === "on" ? "on" : G.status === "err" ? "err" : ""}"></span> ${G.status === "off" ? "Presença automática desligada" : esc(G.msg)}`;
  }

  // ------------------------------------------------------------------ push
  const b64 = (s) => { const p = "=".repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  async function ativarPush() {
    if (CAP && window.Capacitor.Plugins.LocalNotifications) {
      const r = await window.Capacitor.Plugins.LocalNotifications.requestPermissions().catch(() => ({}));
      LS.set("mc.push", r.display === "granted"); toast(r.display === "granted" ? "Notificações ativadas." : "Permissão negada.", r.display === "granted" ? "ok" : "err"); return;
    }
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este aparelho não aceita notificações pelo navegador. Instale o app (Adicionar à tela inicial).");
      if (!S.cfg.vapid_public) throw new Error("O agente ainda não publicou a chave de notificações. Tente mais tarde.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permissão de notificação negada.");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(S.cfg.vapid_public) });
      const j = sub.toJSON();
      const { error } = await sb.from("push_subs").upsert({ endpoint: j.endpoint, user_id: P.id, p256dh: j.keys.p256dh, auth: j.keys.auth, plataforma: navigator.userAgent.slice(0, 120) });
      if (error) throw error;
      LS.set("mc.push", true); toast("Notificações ativadas neste aparelho.");
    } catch (e) { toast(e.message, "err"); }
  }

  // ------------------------------------------------------------------ casco
  // Telas completas do site, abertas dentro do app (menu lateral no computador, "Mais" no celular)
  const PAGINAS = [
    ["index.html", "🧾", "Consulta mix", "Mix de produtos por cliente, sugestão de pedido e metas"],
    ["clientes.html", "🏪", "Clientes", "Carteira com venda dos últimos meses"],
    ["roteiro.html?tipo=vendedor", "🧭", "Roteiro vendedor", "Visitas planejadas por vendedor"],
    ["roteiro.html", "🗂️", "Roteiro promotor", "Lojas e frequência do promotor"],
    ["metas.html", "📈", "Metas", "Meta do mês por cliente e por vendedor"]
  ];
  const nomePagina = (pg) => (PAGINAS.find((x) => x[0] === pg) || (pg.startsWith("admin.html") ? [0, "⚙️", "Administração"] : [0, "📄", pg]))[2];
  const ROTAS_CAMPO = [
    ["inicio", "🏠", "Início"], ["roteiro", "🗺️", "Roteiro do dia"], ["promotor", "📸", "Promotor"], ["entregas", "🚚", "Entregas"],
    ["desempenho", "📊", "Desempenho"], ["oportunidades", "💡", "Oportunidades"]
  ];
  function lateral() {
    const on = (r) => S.rota === r ? "on" : "";
    const link = (href, i, n, cls = "", extra = "") => `<a href="${href}" class="${cls}" ${extra}><span class="i">${i}</span><span>${n}</span></a>`;
    const nl = S.notifs.filter((n) => !n.lida_em).length;
    return `<aside class="side">
      <div class="side-top"><div class="mark">M</div><div><b>${esc(Mix.cfg.EMPRESA || "Mix Clientes")}</b><small>App de campo</small></div></div>
      <div class="grp">No campo</div>
      ${ROTAS_CAMPO.map(([r, i, n]) => link("#" + r, i, n + (r === "entregas" && contEntregasProblema() ? ` <em>${contEntregasProblema()}</em>` : ""), on(r))).join("")}
      ${SUP ? link("#equipe", "👥", "Equipe", on("equipe")) : ""}
      ${link("#avisos", "🔔", "Avisos" + (nl ? ` <em>${nl}</em>` : ""), on("avisos"))}
      <div class="grp">Consultas e relatórios</div>
      ${PAGINAS.map(([pg, i, n]) => link("#pg/" + pg, i, n, on("pg/" + pg))).join("")}
      ${P.role === "admin" ? `<div class="grp">Gestão</div>${link("#pg/admin.html", "⚙️", "Administração", S.rota.startsWith("pg/admin.html") ? "on" : "")}` : ""}
      <div class="side-fim">
        ${link("baixar.html", "📲", "Baixar app Android", "", 'target="_blank" rel="noopener"')}
        <a href="#" id="sSenha"><span class="i">🔑</span><span>Trocar senha</span></a>
        <a href="#" id="sSair"><span class="i">↩</span><span>Sair</span></a>
      </div>
    </aside>`;
  }

  const ROTAS = [
    ["inicio", "🏠", "Início"], ["roteiro", "🗺️", "Roteiro"], ["promotor", "📸", "Promotor"], ["entregas", "🚚", "Entregas"], ["mais", "☰", "Mais"]
  ];
  function casco() {
    const naoLidas = S.notifs.filter((n) => !n.lida_em).length;
    const vs = vendedores();
    const PG = S.rota.startsWith("pg/");
    document.body.classList.toggle("modo-pg", PG);
    root.innerHTML = `${lateral()}
      <header class="ap-top">
        <div class="l1">
          <div class="mark">M</div>
          <div class="who"><b>${esc(P.nome)}</b><small>${esc(Mix.ROLE_LABEL[P.role] || P.role)} · ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</small></div>
          <button class="ic" id="btAvisos" title="Avisos">🔔${naoLidas ? `<span class="dot">${naoLidas}</span>` : ""}</button>
          <button class="ic" id="btAtual" title="Atualizar">⟳</button>
        </div>
        ${SUP && !PG ? `<select id="selVend"><option value="">Toda a equipe (${vs.length} vendedores)</option>${vs.map(([c, n]) => `<option value="${c}" ${String(S.sel) === String(c) ? "selected" : ""}>${esc(n)} (${c})</option>`).join("")}</select>` : ""}
        <div class="ap-gps" id="gpsLinha"></div>
      </header>
      <main class="ap-main" id="tela"></main>
      <nav class="navb">${ROTAS.map(([id, i, n]) => `<a href="#${id}" data-r="${id}" class="${S.rota === id || (id === "mais" && (["desempenho", "oportunidades", "equipe", "avisos"].includes(S.rota) || PG)) ? "on" : ""}"><span class="i">${i}</span>${n}${id === "entregas" && contEntregasProblema() ? `<span class="n">${contEntregasProblema()}</span>` : ""}</a>`).join("")}</nav>`;
    el("btAvisos").onclick = () => ir("avisos");
    el("sSair").onclick = (e) => { e.preventDefault(); Mix.logout(); };
    el("sSenha").onclick = (e) => { e.preventDefault(); Mix.trocarSenha(); };
    el("btAtual").onclick = async () => { el("btAtual").textContent = "…"; await carregar(); casco(); render(); };
    el("selVend")?.addEventListener("change", (e) => { S.sel = e.target.value; LS.set("mc.sel", S.sel); render(); });
    pintarGps();
  }
  const contEntregasProblema = () => S.entregas.filter((e) => doEscopo(e) && e.data_ref === hoje() && ["nao_entregue", "ocorrencia", "devolvida"].includes(e.status)).length;
  function ir(r) { if (location.hash !== "#" + r) location.hash = r; else { S.rota = r; casco(); render(); } }
  window.addEventListener("hashchange", () => {
    const nova = decodeURIComponent(location.hash.replace("#", "")) || "inicio";
    // mesma tela do site já aberta: não recarrega o iframe
    if (nova === S.rota && nova.startsWith("pg/")) return;
    S.rota = nova; fecharFolha(); casco(); render(); window.scrollTo(0, 0);
  });

  // ------------------------------------------------------------------ TELAS DO SITE DENTRO DO APP
  function telaPagina(t, pg) {
    const base = pg.split("?")[0];
    if (base === "admin.html" && P.role !== "admin") { t.innerHTML = `<div class="vazio">Disponível só para o administrador.</div>`; return; }
    const src = pg + (pg.includes("?") ? "&" : "?") + "embed=1";
    const solo = pg + (pg.includes("?") ? "&" : "?") + "solo=1";
    t.innerHTML = `<div class="pg-bar"><b>${esc(nomePagina(pg))}</b><a href="${esc(solo)}" target="_blank" rel="noopener">abrir em tela cheia ↗</a></div>
      <iframe class="pg-frame" id="pgFrame" src="${esc(src)}" title="${esc(nomePagina(pg))}"></iframe>`;
    const f = el("pgFrame");
    const ajustar = () => { const top = f.getBoundingClientRect().top; const nav = document.querySelector(".navb"); const nb = nav && getComputedStyle(nav).display !== "none" ? nav.offsetHeight : 0; f.style.height = Math.max(420, window.innerHeight - top - nb - 8) + "px"; };
    ajustar(); window.onresize = ajustar;
  }

  function render() {
    const t = el("tela"); if (!t) return;
    if (S.erroCarga) { t.innerHTML = `<div class="msg err">${esc(S.erroCarga)}</div>`; return; }
    if (S.rota.startsWith("pg/")) return telaPagina(t, S.rota.slice(3));
    const f = { inicio: telaInicio, roteiro: telaRoteiro, promotor: telaPromotor, entregas: telaEntregas, mais: telaMais, desempenho: telaDesempenho, oportunidades: telaOportunidades, equipe: telaEquipe, avisos: telaAvisos }[S.rota] || telaInicio;
    f(t);
  }

  // ------------------------------------------------------------------ INÍCIO
  function telaInicio(t) {
    const d = hoje(), r = resumoDia(d), m = metaDe(cods());
    const metaVis = S.cfg.meta_visitas_dia || r.visitasPlanejadas;
    const novos = S.notifs.filter((n) => !n.lida_em).slice(0, 3);
    const pendentes = S.rotVend.filter((x) => doEscopo(x) && C.visitaEm(x, d) && !visitouPres(x.codcli, d)).sort((a, b) => (a.sequencia_visita ?? 999) - (b.sequencia_visita ?? 999));
    const alertasEstoque = alertasDeEstoque().length;
    const semGps = !LS.get("mc.gps", false) && !SUP;
    t.innerHTML = `
      ${semGps ? `<div class="aviso-gps"><b>Ative a presença automática.</b> O app registra a visita sozinho quando você fica ${S.cfg.permanencia_min} min na loja — sem check-in.<br><button class="btn sm" id="btGps">Ativar localização</button></div>` : ""}
      ${novos.map((n) => `<div class="banner" data-n="${n.id}"><span>🔔</span><div><b>${esc(n.titulo)}</b><small>${esc((n.corpo || "").split("\n")[0])} · ${hm(n.criado_em)}</small></div></div>`).join("")}
      <div class="tiles">
        <div class="tile" data-go="roteiro"><div class="l">🗺️ Visitas hoje</div><div class="v">${r.visitadasPlanejadas}<small> / ${r.visitasPlanejadas}</small></div>${barra(r.visitasPlanejadas ? r.visitadasPlanejadas / r.visitasPlanejadas : 0)}<div class="s">${r.visitadasTotal - r.visitadasPlanejadas > 0 ? `+${r.visitadasTotal - r.visitadasPlanejadas} fora do roteiro · ` : ""}presenciais</div></div>
        <div class="tile" data-go="entregas"><div class="l">🚚 Entregas a caminho</div><div class="v">${r.entregas.emRota}</div><div class="s">${r.entregas.entregues} entregues${r.entregas.problema ? ` · <b style="color:var(--bad)">${r.entregas.problema} ocorrência(s)</b>` : ""}</div></div>
        <div class="tile" data-go="promotor"><div class="l">📸 Promotor na rota</div><div class="v">${r.promotor.feitas}<small> / ${r.promotor.rota}</small></div>${barra(r.promotor.rota ? r.promotor.feitas / r.promotor.rota : 0)}<div class="s">lojas atendidas hoje</div></div>
        <div class="tile" data-go="desempenho"><div class="l">🎯 Meta de visitas</div><div class="v">${r.visitadasTotal}<small> / ${metaVis}</small></div>${barra(metaVis ? r.visitadasTotal / metaVis : 0)}<div class="s">${r.positivadosDia} positivadas hoje</div></div>
        <div class="tile wide" data-go="desempenho"><div class="l">💰 Faturamento de hoje</div><div class="v">${brl(r.realDia)}<small> / ${brl(r.metaDia)}</small></div>${barra(r.pctDia, C.fracaoDia())}<div class="s">${r.pedidosDia} pedidos · a marca na barra é onde você deveria estar a esta hora</div></div>
        <div class="tile wide" data-go="desempenho"><div class="l">📅 Mês</div><div class="v">${pct(r.pctMes)}<small> · ${brl(r.realMes)} de ${brl(r.metaMes)}</small></div>${barra(r.pctMes, r.dias.total ? (r.dias.antes + C.fracaoDia()) / r.dias.total : null)}
          <div class="s">GAP ${brl(r.gap)} · projeção ${brl(r.projecao)} (${pct(r.pctProj)}) · ${r.dias.restantes} dias úteis restantes${m.origem === "calculada" ? " · meta calculada (ano passado + " + ((Mix.cfg.METAS && Mix.cfg.METAS.valor) ?? 15) + "%)" : ""}</div></div>
      </div>
      ${alertasEstoque ? `<div class="banner" data-go="oportunidades" style="background:var(--bad-soft);border-color:#f5c2bd;color:var(--bad)"><span>⚠️</span><div><b>${alertasEstoque} alerta(s) de estoque baixo nas lojas</b><small>Veja em Oportunidades</small></div></div>` : ""}
      <div class="ap-h">Próximas visitas do roteiro <a href="#roteiro">ver tudo</a></div>
      <div class="lst">${pendentes.slice(0, 6).map((x) => itemLoja(x.codcli, d, x)).join("") || `<div class="vazio">${r.visitasPlanejadas ? "🎉 Todas as visitas do roteiro de hoje feitas!" : "Nenhuma visita no roteiro de hoje."}</div>`}</div>
      <div class="ap-h">Atualizado ${S.carregadoEm ? hm(S.carregadoEm) : "—"}</div>`;
    el("btGps")?.addEventListener("click", iniciarGps);
    ligarCliques(t);
  }

  function itemLoja(codcli, dia, rot) {
    const c = S.cli.get(codcli) || {};
    const pres = visitouPres(codcli, dia);
    const ped = pedidosDe(codcli, dia);
    const pv = S.promVisitas.find((v) => v.codcli === codcli && v.data === dia);
    const st = pres ? (ped.length ? ["ok", "💰"] : ["ok", "✔"]) : ped.length ? ["info", "💰"] : ["", String(rot?.sequencia_visita ?? "•")];
    return `<div class="it" data-cli="${codcli}">
      <div class="st ${st[0]}">${st[1]}</div>
      <div class="bd"><div class="t">${esc(c.fantasia || c.cliente || rot?.fantasia || "Cliente " + codcli)}</div>
        <div class="d">${esc([c.bairro, c.cidade].filter(Boolean).join(" · "))}${rot?.horario_visita ? " · " + esc(rot.horario_visita) : ""}${SUP && c.vendedor ? " · " + esc(c.vendedor) : ""}</div>
        <div class="d">${pres ? `presencial ${hm(pres.inicio)}–${hm(pres.fim)} (${dur(pres.duracao_seg)})` : "não visitado"}${ped.length ? ` · pedido ${brl(ped.reduce((s, p) => s + +p.valor, 0))}` : ""}${pv ? ` · promotor: ${rotPromStatus(pv.status)}` : ""}${!S.geo.has(codcli) ? ` · <span style="color:var(--warn)">sem localização</span>` : ""}</div>
      </div>
      <div class="rt">›</div></div>`;
  }
  const rotPromStatus = (s) => ({ pendente: "pendente", em_andamento: "na loja agora", concluida: "concluída ✔", nao_realizada: "não realizada", justificada: "justificada" }[s] || s);

  function ligarCliques(t) {
    t.querySelectorAll("[data-go]").forEach((x) => x.onclick = () => ir(x.dataset.go));
    t.querySelectorAll("[data-cli]").forEach((x) => x.onclick = () => abrirLoja(+x.dataset.cli));
    t.querySelectorAll("[data-n]").forEach((x) => x.onclick = () => abrirAviso(+x.dataset.n));
    t.querySelectorAll("[data-prom]").forEach((x) => x.onclick = (e) => { e.stopPropagation(); abrirPromotor(x.dataset.prom, x.dataset.o); });
  }

  // ------------------------------------------------------------------ ROTEIRO DO VENDEDOR
  function telaRoteiro(t) {
    const d = S.rotDia || hoje();
    const lst = S.rotVend.filter((x) => doEscopo(x) && C.visitaEm(x, d)).sort((a, b) => String(a.vendedor || "").localeCompare(String(b.vendedor || "")) || (a.sequencia_visita ?? 999) - (b.sequencia_visita ?? 999));
    const feitas = lst.filter((x) => visitouPres(x.codcli, d)).length;
    const plan = new Set(lst.map((x) => x.codcli));
    const fora = [...new Set(S.presencas.filter((p) => p.data === d && p.cod_vendedor != null && doEscopo(p) && p.duracao_seg >= minPerm() && !plan.has(p.codcli)).map((p) => p.codcli))];
    const dias = [-1, 0, 1, 2].map((n) => C.addDias(hoje(), n));
    t.innerHTML = `
      <div class="chips">${dias.map((x, i) => `<span class="chip ${x === d ? "on" : ""}" data-dia="${x}">${["Ontem", "Hoje", "Amanhã", "Depois"][i]} ${fmtDate(x).slice(0, 5)}</span>`).join("")}</div>
      <div class="tiles"><div class="tile"><div class="l">Visitas do roteiro</div><div class="v">${feitas}<small> / ${lst.length}</small></div>${barra(lst.length ? feitas / lst.length : 0)}</div>
        <div class="tile"><div class="l">Positivadas</div><div class="v">${lst.filter((x) => pedidosDe(x.codcli, d).length).length}<small> / ${lst.length}</small></div><div class="s">+${fora.length} visitas fora do roteiro</div></div></div>
      <div class="ap-h">Roteiro do vendedor</div>
      <div class="lst">${lst.map((x) => itemLoja(x.codcli, d, x)).join("") || `<div class="vazio">Sem visitas no roteiro deste dia.</div>`}</div>
      ${fora.length ? `<div class="ap-h">Visitas presenciais fora do roteiro</div><div class="lst">${fora.map((c) => itemLoja(c, d)).join("")}</div>` : ""}`;
    t.querySelectorAll("[data-dia]").forEach((x) => x.onclick = () => { S.rotDia = x.dataset.dia; render(); });
    ligarCliques(t);
  }

  // ------------------------------------------------------------------ ROTEIRO DO PROMOTOR
  function telaPromotor(t) {
    const d = S.promDia;
    const plan = S.rotProm.filter((x) => doEscopo(x) && C.visitaEm(x, d));
    const vis = S.promVisitas.filter((v) => doEscopo(v) && v.data === d);
    const porCli = new Map();
    plan.forEach((x) => porCli.set(x.codcli, { codcli: x.codcli, promotor: x.promotor, seq: x.sequencia_visita, hora: x.horario_visita, v: null }));
    vis.forEach((v) => { const o = porCli.get(v.codcli) || { codcli: v.codcli, promotor: v.promotor, seq: 999 }; o.v = v; o.promotor = v.promotor || o.promotor; porCli.set(v.codcli, o); });
    const itens = [...porCli.values()].sort((a, b) => (a.v?.checkin || "~").localeCompare(b.v?.checkin || "~") || (a.seq ?? 999) - (b.seq ?? 999));
    const feitas = itens.filter((i) => i.v?.status === "concluida").length;
    const eventos = [];
    vis.forEach((v) => {
      if (v.checkin) eventos.push({ t: v.checkin, cls: "", txt: `${esc(v.promotor || "Promotor")} chegou em <b>${esc(nomeCli(v.codcli))}</b>` });
      if (v.checkout) eventos.push({ t: v.checkout, cls: v.status === "concluida" ? "ok" : "warn", txt: `${esc(v.promotor || "Promotor")} ${v.status === "concluida" ? "concluiu" : "saiu de"} <b>${esc(nomeCli(v.codcli))}</b>${(v.fotos || []).length ? ` · ${(v.fotos || []).length} fotos` : ""}` });
      if (v.status === "nao_realizada" || v.status === "justificada") eventos.push({ t: v.atualizado_em, cls: "bad", txt: `Visita em <b>${esc(nomeCli(v.codcli))}</b> não realizada${v.justificativa ? ": " + esc(v.justificativa) : ""}` });
    });
    eventos.sort((a, b) => String(b.t).localeCompare(String(a.t)));
    const semIntegracao = !S.promVisitas.length;
    const dias = [-1, 0, 1].map((n) => C.addDias(hoje(), n));
    t.innerHTML = `
      <div class="chips">${dias.map((x, i) => `<span class="chip ${x === d ? "on" : ""}" data-dia="${x}">${["Ontem", "Hoje", "Amanhã"][i]} ${fmtDate(x).slice(0, 5)}</span>`).join("")}</div>
      <div class="tiles"><div class="tile"><div class="l">Lojas feitas</div><div class="v">${feitas}<small> / ${itens.length}</small></div>${barra(itens.length ? feitas / itens.length : 0)}</div>
        <div class="tile"><div class="l">Na loja agora</div><div class="v">${itens.filter((i) => i.v?.status === "em_andamento").length}</div><div class="s">${new Set(itens.map((i) => i.promotor).filter(Boolean)).size} promotores</div></div></div>
      ${semIntegracao ? `<div class="aviso-gps" style="margin-top:10px">Mostrando o <b>roteiro planejado</b>. O status em tempo real, as fotos e a contagem aparecem quando a integração com o <b>Promotor na Rede</b> estiver ligada.</div>` : ""}
      ${eventos.length ? `<div class="ap-h">Histórico do dia</div><div class="card card-pad"><div class="tl">${eventos.slice(0, 15).map((e) => `<div class="ev ${e.cls}"><div class="h">${hm(e.t)}</div>${e.txt}</div>`).join("")}</div></div>` : ""}
      <div class="ap-h">Lojas do promotor</div>
      <div class="lst">${itens.map((i) => {
        const v = i.v, s = v?.status || "pendente";
        const st = s === "concluida" ? ["ok", "✔"] : s === "em_andamento" ? ["info", "⏳"] : ["nao_realizada", "justificada"].includes(s) ? ["bad", "✖"] : ["", "•"];
        const nf = (v?.fotos || []).length + (v?.link_fotos ? 1 : 0), nc = (v?.contagem || []).length;
        return `<div class="it" data-cli="${i.codcli}"><div class="st ${st[0]}">${st[1]}</div><div class="bd">
          <div class="t">${esc(nomeCli(i.codcli))}</div>
          <div class="d">${esc(i.promotor || "—")} · ${rotPromStatus(s)}${v?.checkin ? ` · ${hm(v.checkin)}${v.checkout ? "–" + hm(v.checkout) : ""}` : i.hora ? " · previsto " + esc(i.hora) : ""}</div>
          ${v && (nf || nc) ? `<div class="acts">${nf ? `<span class="chip" data-prom="${esc(v.chave)}" data-o="fotos">📷 Fotos (${(v.fotos || []).length || "link"})</span>` : ""}${nc ? `<span class="chip" data-prom="${esc(v.chave)}" data-o="contagem">📦 Contagem (${nc})</span>` : ""}</div>` : ""}
        </div><div class="rt">›</div></div>`;
      }).join("") || `<div class="vazio">Nenhuma visita de promotor nas suas lojas neste dia.</div>`}</div>`;
    t.querySelectorAll("[data-dia]").forEach((x) => x.onclick = () => { S.promDia = x.dataset.dia; render(); });
    ligarCliques(t);
  }

  function abrirPromotor(chave, o) {
    const v = S.promVisitas.find((x) => x.chave === chave); if (!v) return;
    const fotos = v.fotos || [];
    folha(`<h3>${esc(nomeCli(v.codcli))}</h3><div class="muted">${esc(v.promotor || "")} · ${fmtDate(v.data)} · ${hm(v.checkin)}–${hm(v.checkout)}</div>
      ${o !== "contagem" ? `${v.link_fotos ? `<p><a class="btn sm" href="${esc(v.link_fotos)}" target="_blank" rel="noopener">Abrir fotos no Promotor na Rede ↗</a></p>` : ""}
        <div class="fotos">${fotos.map((f) => `<a href="${esc(f.url || f)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(f.url || f)}" alt=""></a>`).join("")}</div>` : ""}
      ${(v.contagem || []).length ? `<h3 style="margin-top:14px">Contagem</h3>${tabelaContagem(v)}` : ""}
      ${v.obs ? `<p class="muted">${esc(v.obs)}</p>` : ""}`);
  }
  function tabelaContagem(v) {
    const med = mediaPedido(v.codcli);
    return `<table class="mini"><thead><tr><th>Produto</th><th class="n">Qtd</th><th class="n">Pedido médio</th><th></th></tr></thead><tbody>${(v.contagem || []).map((i) => {
      const m = med.get(Number(i.codprod)); const q = +i.qtd || 0;
      const b = q <= 0 ? `<span class="badge bad">ruptura</span>` : m && q < m * 0.3 ? `<span class="badge warn">baixo</span>` : "";
      return `<tr><td>${esc(i.descricao || i.codprod)}</td><td class="n">${fmtInt.format(q)}</td><td class="n">${m ? fmtInt.format(m) : "—"}</td><td>${b}</td></tr>`;
    }).join("")}</tbody></table>`;
  }

  // ------------------------------------------------------------------ ENTREGAS (Fusion)
  const ENT = { em_rota: ["info", "🚚", "Em rota"], entregue: ["ok", "✔", "Entregue"], nao_entregue: ["bad", "✖", "Não entregue"], ocorrencia: ["warn", "⚠", "Ocorrência"], devolvida: ["bad", "↩", "Devolvida"], pendente: ["", "•", "Aguardando saída"] };
  function telaEntregas(t) {
    const desde = C.addDias(hoje(), -(S.entDias - 1));
    const base = S.entregas.filter((e) => doEscopo(e) && e.data_ref >= desde);
    const lst = base.filter((e) => S.entFiltro === "todos" || (S.entFiltro === "problema" ? ["nao_entregue", "ocorrencia", "devolvida"].includes(e.status) : e.status === S.entFiltro))
      .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
    const n = (s) => base.filter((e) => s === "problema" ? ["nao_entregue", "ocorrencia", "devolvida"].includes(e.status) : e.status === s).length;
    t.innerHTML = `
      <div class="chips">${[[1, "Hoje"], [3, "3 dias"], [7, "7 dias"]].map(([v, l]) => `<span class="chip ${S.entDias === v ? "on" : ""}" data-d="${v}">${l}</span>`).join("")}</div>
      <div class="tiles">
        <div class="tile" data-f="em_rota"><div class="l">🚚 Em rota</div><div class="v">${n("em_rota")}</div></div>
        <div class="tile" data-f="entregue"><div class="l">✔ Entregues</div><div class="v">${n("entregue")}</div></div>
        <div class="tile" data-f="problema"><div class="l">⚠ Não entregues / ocorrência</div><div class="v" style="color:${n("problema") ? "var(--bad)" : "inherit"}">${n("problema")}</div></div>
        <div class="tile" data-f="pendente"><div class="l">• Aguardando saída</div><div class="v">${n("pendente")}</div></div>
      </div>
      <div class="chips" style="margin-top:10px">${[["todos", "Todas"], ["em_rota", "Em rota"], ["entregue", "Entregues"], ["problema", "Com problema"], ["pendente", "Aguardando"]].map(([v, l]) => `<span class="chip ${S.entFiltro === v ? "on" : ""}" data-f="${v}">${l}</span>`).join("")}</div>
      <div class="lst">${lst.map((e) => { const s = ENT[e.status] || ENT.pendente; return `<div class="it" data-cli="${e.codcli}"><div class="st ${s[0]}">${s[1]}</div><div class="bd">
          <div class="t">${esc(e.cliente || nomeCli(e.codcli))}</div>
          <div class="d">${s[2]}${e.numped ? " · pedido " + e.numped : ""}${e.numnota ? " · NF " + e.numnota : ""}${e.valor ? " · " + brl(e.valor) : ""}</div>
          <div class="d">${e.entregue_em ? "entregue " + hm(e.entregue_em) : e.saida_em ? "saiu " + hm(e.saida_em) : ""}${e.previsao && e.status === "em_rota" ? " · previsão " + hm(e.previsao) : ""}${e.motorista ? " · " + esc(e.motorista) : ""}${e.veiculo ? " · " + esc(e.veiculo) : ""}</div>
          ${e.ocorrencia ? `<div class="d" style="color:var(--bad)">⚠ ${esc(e.ocorrencia)}</div>` : ""}
          ${e.comprovante ? `<div class="acts"><a class="chip" href="${esc(e.comprovante)}" target="_blank" rel="noopener">📄 Comprovante</a></div>` : ""}
        </div><div class="rt">${hm(e.atualizado_em)}</div></div>`; }).join("") ||
        `<div class="vazio">${S.entregas.length ? "Nenhuma entrega neste filtro." : "As entregas aparecem aqui quando a integração com o <b>Fusion</b> estiver ligada."}</div>`}</div>`;
    t.querySelectorAll("[data-d]").forEach((x) => x.onclick = () => { S.entDias = +x.dataset.d; render(); });
    t.querySelectorAll("[data-f]").forEach((x) => x.onclick = () => { S.entFiltro = S.entFiltro === x.dataset.f && x.classList.contains("tile") ? "todos" : x.dataset.f; render(); });
    t.querySelectorAll("[data-cli]").forEach((x) => x.onclick = () => abrirLoja(+x.dataset.cli));
  }

  // ------------------------------------------------------------------ MAIS
  function telaMais(t) {
    t.innerHTML = `<div class="lst">
      ${[["desempenho", "📊", "Desempenho", "Visitas presenciais × não visitadas, positivação"], ["oportunidades", "💡", "Oportunidades e estoque", "Recompra atrasada e estoque baixo nas lojas"],
         ...(SUP ? [["equipe", "👥", "Equipe", "Ranking de metas, visitas e positivação"]] : []), ["avisos", "🔔", "Avisos", "Resumos e atualizações recebidas"]]
        .map(([r, i, n, d]) => `<div class="it" data-go="${r}"><div class="st">${i}</div><div class="bd"><div class="t">${n}</div><div class="d">${d}</div></div><div class="rt">›</div></div>`).join("")}
      <div class="ap-h" style="margin:14px 12px 6px">Consultas e relatórios</div>
      ${PAGINAS.map(([pg, i, n, d]) => `<a class="it" href="#pg/${pg}"><div class="st">${i}</div><div class="bd"><div class="t">${n}</div><div class="d">${d}</div></div><div class="rt">›</div></a>`).join("")}
      ${P.role === "admin" ? `<a class="it" href="#pg/admin.html"><div class="st">⚙️</div><div class="bd"><div class="t">Administração</div><div class="d">Usuários, integração Winthor e Fusion</div></div><div class="rt">›</div></a>` : ""}
      <div class="ap-h" style="margin:14px 12px 6px">Aparelho</div>
      <div class="it" id="mPush"><div class="st">📲</div><div class="bd"><div class="t">Ativar notificações</div><div class="d">${LS.get("mc.push", false) ? "Ativadas neste aparelho ✔" : "Receba entregas, promotor e resumos do dia"}</div></div></div>
      <div class="it" id="mGps"><div class="st">📍</div><div class="bd"><div class="t">Presença automática</div><div class="d">${G.watch != null ? "Ligada ✔ — deixe o app aberto na rota" : "Desligada — toque para ativar"}</div></div></div>
      <a class="it" href="baixar.html"><div class="st">📲</div><div class="bd"><div class="t">Baixar o app Android</div><div class="d">Link para instalar ou atualizar</div></div><div class="rt">›</div></a>
      <div class="it" id="mSenha"><div class="st">🔑</div><div class="bd"><div class="t">Trocar minha senha</div></div></div>
      <div class="it" id="mSair"><div class="st">↩</div><div class="bd"><div class="t">Sair</div></div></div>
    </div>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:14px">A localização só é usada em horário de trabalho (${S.cfg.hora_inicio}h–${S.cfg.hora_fim}h) para registrar visitas às lojas.</p>`;
    ligarCliques(t);
    el("mPush").onclick = ativarPush;
    el("mGps").onclick = () => { iniciarGps(); render(); };
    el("mSair").onclick = () => Mix.logout();
    el("mSenha").onclick = () => Mix.trocarSenha();
  }

  // ------------------------------------------------------------------ DESEMPENHO
  function periodoDias() {
    const d = hoje();
    if (S.desPeriodo === "hoje") return [d];
    if (S.desPeriodo === "7d") return [...Array(7)].map((_, i) => C.addDias(d, -6 + i));
    const ini = d.slice(0, 8) + "01"; const out = []; for (let x = ini; x <= d; x = C.addDias(x, 1)) out.push(x); return out;
  }
  function donut(a, b, cores) {
    const tot = a + b || 1, r = 34, c = 2 * Math.PI * r, f = a / tot;
    return `<svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="${cores[1]}" stroke-width="12"/>
      <circle cx="42" cy="42" r="${r}" fill="none" stroke="${cores[0]}" stroke-width="12" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 42 42)"/>
      <text x="42" y="47" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">${Math.round(f * 100)}%</text></svg>`;
  }
  function telaDesempenho(t) {
    const dias = periodoDias();
    let plan = 0, vis = 0, posPlan = 0; const naoVis = [];
    dias.forEach((d) => S.rotVend.filter((x) => doEscopo(x) && C.visitaEm(x, d)).forEach((x) => {
      plan++; const v = visitouPres(x.codcli, d); if (v) vis++; else if (d <= hoje()) naoVis.push({ d, codcli: x.codcli });
      if (pedidosDe(x.codcli, d).length) posPlan++;
    }));
    const presencas = S.presencas.filter((p) => p.cod_vendedor != null && doEscopo(p) && dias.includes(p.data) && p.duracao_seg >= minPerm()).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio)));
    const carteira = S.clientes.filter(doEscopo);
    const posit = new Set(S.pedidos.filter((p) => doEscopo(p) && dias.includes(p.data)).map((p) => p.codcli));
    const cores = ["var(--ok)", "#e6e9ee"];
    t.innerHTML = `
      <div class="chips">${[["hoje", "Hoje"], ["7d", "7 dias"], ["mes", "Mês"]].map(([v, l]) => `<span class="chip ${S.desPeriodo === v ? "on" : ""}" data-p="${v}">${l}</span>`).join("")}</div>
      <div class="card card-pad"><b>Visitas do roteiro</b><div class="donut" style="margin-top:8px">${donut(vis, plan - vis, cores)}
        <div class="legend"><div><i style="background:var(--ok)"></i>Visitadas presencialmente: <b>${vis}</b></div><div><i style="background:#e6e9ee"></i>Não visitadas: <b>${plan - vis}</b></div><div class="muted">${plan} visitas planejadas · ${presencas.length} presenças no total</div></div></div></div>
      <div class="card card-pad" style="margin-top:10px"><b>Positivação da carteira</b><div class="donut" style="margin-top:8px">${donut(posit.size, Math.max(0, carteira.length - posit.size), ["var(--brand)", "#e6e9ee"])}
        <div class="legend"><div><i style="background:var(--brand)"></i>Positivadas: <b>${posit.size}</b></div><div><i style="background:#e6e9ee"></i>Não positivadas: <b>${Math.max(0, carteira.length - posit.size)}</b></div><div class="muted">${carteira.length} clientes na carteira · ${posPlan} positivações em visitas do roteiro</div></div></div></div>
      <div class="ap-h">Lojas visitadas presencialmente</div>
      <div class="lst">${presencas.slice(0, 80).map((p) => { const ped = pedidosDe(p.codcli, p.data); return `<div class="it" data-cli="${p.codcli}"><div class="st ${ped.length ? "ok" : "info"}">${ped.length ? "💰" : "📍"}</div><div class="bd">
        <div class="t">${esc(nomeCli(p.codcli))}</div><div class="d">${fmtDate(p.data).slice(0, 5)} · ${hm(p.inicio)}–${hm(p.fim)} · ${dur(p.duracao_seg)}${p.distancia_m != null ? ` · a ${p.distancia_m} m` : ""}</div>
        <div class="d">${ped.length ? "positivou " + brl(ped.reduce((s, x) => s + +x.valor, 0)) : "sem pedido no dia"}${S.rotVend.some((x) => x.codcli === p.codcli && C.visitaEm(x, p.data)) ? "" : " · fora do roteiro"}</div></div></div>`; }).join("") || `<div class="vazio">Nenhuma visita presencial registrada no período.</div>`}</div>
      <div class="ap-h">Não visitadas (roteiro)</div>
      <div class="lst">${naoVis.slice(0, 80).map((x) => `<div class="it" data-cli="${x.codcli}"><div class="st bad">✖</div><div class="bd"><div class="t">${esc(nomeCli(x.codcli))}</div><div class="d">${fmtDate(x.d)}${pedidosDe(x.codcli, x.d).length ? " · positivou sem visita presencial" : ""}${!S.geo.has(x.codcli) ? " · loja sem localização" : ""}</div></div></div>`).join("") || `<div class="vazio">Nenhuma.</div>`}</div>`;
    t.querySelectorAll("[data-p]").forEach((x) => x.onclick = () => { S.desPeriodo = x.dataset.p; render(); });
    ligarCliques(t);
  }

  // ------------------------------------------------------------------ OPORTUNIDADES (recompra) e ESTOQUE (contagem do promotor)
  async function carregarMix() {
    if (S.mix) return;
    const alvo = new Set(S.clientes.filter(doEscopo).map((c) => c.codcli));
    const rows = await tudo("mix", "codcli,codprod,descricao,embalagem,primeira_compra_periodo,ultima_compra,dias_sem_comprar,qtd_pedidos,qtd_total_comprada,preco_medio,estoque_disponivel_filial_1,cod_vendedor",
      (q) => S.sel ? q.eq("cod_vendedor", Number(S.sel)) : q);
    S.mix = rows.filter((r) => alvo.has(r.codcli) || !S.sel);
    S.mixSel = S.sel;
  }
  function mediaPedido(codcli) {
    const m = new Map();
    (S.mix || []).filter((r) => r.codcli === codcli).forEach((r) => { if (r.qtd_pedidos > 0) m.set(Number(r.codprod), (+r.qtd_total_comprada || 0) / r.qtd_pedidos); });
    return m;
  }
  function oportunidades() {
    const out = [];
    for (const r of S.mix || []) {
      if (!(r.qtd_pedidos >= 3) || !r.primeira_compra_periodo || !r.ultima_compra || r.dias_sem_comprar == null) continue;
      const intervalo = C.diffDias(r.primeira_compra_periodo, r.ultima_compra) / (r.qtd_pedidos - 1);
      if (!(intervalo >= 5)) continue;
      const atraso = r.dias_sem_comprar / intervalo;
      if (atraso < 1.3 || r.dias_sem_comprar > 180) continue;
      out.push({ ...r, intervalo: Math.round(intervalo), atraso, sugerido: Math.max(1, Math.round((+r.qtd_total_comprada || 0) / r.qtd_pedidos)), valor: ((+r.qtd_total_comprada || 0) / r.qtd_pedidos) * (+r.preco_medio || 0) });
    }
    return out;
  }
  function alertasDeEstoque() {
    const ult = new Map();
    S.promVisitas.filter((v) => doEscopo(v) && (v.contagem || []).length).forEach((v) => { const o = ult.get(v.codcli); if (!o || v.data > o.data) ult.set(v.codcli, v); });
    const out = [];
    for (const v of ult.values()) {
      const med = S.mix ? mediaPedido(v.codcli) : new Map();
      for (const i of v.contagem) {
        const q = +i.qtd || 0, m = med.get(Number(i.codprod));
        if (q <= 0 || (m && q < m * 0.3)) out.push({ codcli: v.codcli, data: v.data, item: i, media: m, ruptura: q <= 0, chave: v.chave });
      }
    }
    return out;
  }
  async function telaOportunidades(t) {
    t.innerHTML = `<div class="vazio"><span class="spinner dark"></span> Analisando o histórico de pedidos…</div>`;
    if (S.mix && S.mixSel !== S.sel) S.mix = null;
    try { await carregarMix(); } catch (e) { t.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
    const d = hoje();
    const rotHoje = new Set(S.rotVend.filter((x) => doEscopo(x) && C.visitaEm(x, d)).map((x) => x.codcli));
    let opps = oportunidades();
    if (S.oppFiltro === "roteiro") opps = opps.filter((o) => rotHoje.has(o.codcli));
    const porCli = new Map();
    opps.forEach((o) => { if (!porCli.has(o.codcli)) porCli.set(o.codcli, []); porCli.get(o.codcli).push(o); });
    const cli = [...porCli.entries()].map(([c, l]) => ({ c, l: l.sort((a, b) => b.valor - a.valor), v: l.reduce((s, o) => s + o.valor, 0) })).sort((a, b) => b.v - a.v);
    const est = alertasDeEstoque();
    t.innerHTML = `
      ${est.length ? `<div class="ap-h">⚠️ Estoque baixo nas lojas (contagem do promotor)</div><div class="lst">${est.slice(0, 40).map((a) => `<div class="it" data-cli="${a.codcli}"><div class="st ${a.ruptura ? "bad" : "warn"}">${a.ruptura ? "0" : "↓"}</div><div class="bd">
        <div class="t">${esc(nomeCli(a.codcli))}</div><div class="d">${esc(a.item.descricao || a.item.codprod)}: <b>${fmtInt.format(+a.item.qtd || 0)}</b> na gôndola${a.media ? ` · compra em média ${fmtInt.format(a.media)} por pedido` : ""}</div>
        <div class="d">contagem de ${fmtDate(a.data)} — ${a.ruptura ? "ruptura, oferecer reposição" : "estoque baixo, oferecer reposição"}</div></div></div>`).join("")}</div>` : ""}
      <div class="ap-h">💡 Recompra atrasada</div>
      <div class="chips">${[["roteiro", "Lojas do roteiro de hoje"], ["todas", "Toda a carteira"]].map(([v, l]) => `<span class="chip ${S.oppFiltro === v ? "on" : ""}" data-o="${v}">${l}</span>`).join("")}</div>
      <p class="muted" style="font-size:12.5px;margin:0 4px 8px">Itens que o cliente compra com frequência e já passaram do intervalo normal de recompra (≥ 1,3× o intervalo médio).</p>
      <div class="lst">${cli.slice(0, 60).map(({ c, l, v }) => `<div class="it" data-cli="${c}"><div class="st warn">${l.length}</div><div class="bd">
        <div class="t">${esc(nomeCli(c))} <span class="muted" style="font-weight:400">· potencial ${brl(v)}</span></div>
        ${l.slice(0, 4).map((o) => `<div class="d">• ${esc(o.descricao)} — compra a cada ~${o.intervalo} dias, está há <b>${o.dias_sem_comprar}</b> · sugerido ${fmtInt.format(o.sugerido)}${o.estoque_disponivel_filial_1 != null && o.estoque_disponivel_filial_1 <= 0 ? " · <span style='color:var(--bad)'>sem estoque no CD</span>" : ""}</div>`).join("")}
        ${l.length > 4 ? `<div class="d">+ ${l.length - 4} itens</div>` : ""}</div></div>`).join("") || `<div class="vazio">${S.oppFiltro === "roteiro" ? "Nenhuma recompra atrasada nas lojas do roteiro de hoje." : "Nenhuma recompra atrasada."}</div>`}</div>`;
    t.querySelectorAll("[data-o]").forEach((x) => x.onclick = () => { S.oppFiltro = x.dataset.o; render(); });
    ligarCliques(t);
  }

  // ------------------------------------------------------------------ EQUIPE (supervisor / admin)
  function telaEquipe(t) {
    if (!SUP) { t.innerHTML = `<div class="vazio">Disponível para supervisores.</div>`; return; }
    const d = hoje();
    const linhas = vendedores().map(([c, n]) => ({ c, n, r: resumoDia(d, [c]) })).sort((a, b) => b.r.pctProj - a.r.pctProj);
    const tot = resumoDia(d, linhas.map((l) => l.c));
    t.innerHTML = `
      <div class="tiles">
        <div class="tile wide"><div class="l">Equipe no mês</div><div class="v">${pct(tot.pctMes)}<small> · ${brl(tot.realMes)} de ${brl(tot.metaMes)}</small></div>${barra(tot.pctMes)}<div class="s">GAP ${brl(tot.gap)} · projeção ${brl(tot.projecao)} (${pct(tot.pctProj)})</div></div>
        <div class="tile"><div class="l">Hoje</div><div class="v">${brl(tot.realDia)}</div><div class="s">meta ${brl(tot.metaDia)} (${pct(tot.pctDia)})</div></div>
        <div class="tile"><div class="l">Visitas / positivação</div><div class="v">${tot.visitadasPlanejadas}<small>/${tot.visitasPlanejadas}</small></div><div class="s">${tot.positivadosDia} positivadas hoje</div></div>
      </div>
      <div class="ap-h">Por vendedor <span class="muted">toque para ver o dia dele</span></div>
      <div class="lst">${linhas.map(({ c, n, r }) => `<div class="it" data-v="${c}"><div class="st ${corPct(r.pctProj)}">${pct(r.pctProj).replace("%", "")}</div><div class="bd">
        <div class="t">${esc(n)}</div>
        <div class="d">Mês ${pct(r.pctMes)} · proj. ${pct(r.pctProj)} · GAP ${brl(r.gap)}</div>
        <div class="d">Hoje ${brl(r.realDia)} de ${brl(r.metaDia)} · visitas ${r.visitadasPlanejadas}/${r.visitasPlanejadas} · ${r.positivadosDia} posit.${r.entregas.problema ? ` · <span style="color:var(--bad)">${r.entregas.problema} entrega(s) c/ problema</span>` : ""}</div>
        ${barra(r.pctMes)}</div></div>`).join("")}</div>`;
    t.querySelectorAll("[data-v]").forEach((x) => x.onclick = () => { S.sel = x.dataset.v; LS.set("mc.sel", S.sel); casco(); ir("inicio"); });
  }

  // ------------------------------------------------------------------ AVISOS
  function telaAvisos(t) {
    t.innerHTML = `<div class="lst">${S.notifs.map((n) => `<div class="it" data-n="${n.id}"><div class="st ${n.lida_em ? "" : "warn"}">${{ entrega: "🚚", promotor: "📸", estoque: "⚠️", resumo: "📋", meta: "🎯" }[n.tipo] || "🔔"}</div>
      <div class="bd"><div class="t">${esc(n.titulo)}</div><div class="d">${esc((n.corpo || "").split("\n")[0])}</div></div><div class="rt">${new Date(n.criado_em).toLocaleDateString("pt-BR").slice(0, 5)}<br>${hm(n.criado_em)}</div></div>`).join("") || `<div class="vazio">Nenhum aviso ainda.</div>`}</div>
      ${S.notifs.some((n) => !n.lida_em) ? `<p style="text-align:center"><button class="btn ghost sm" id="lerTodos">Marcar todos como lidos</button></p>` : ""}`;
    ligarCliques(t);
    el("lerTodos")?.addEventListener("click", async () => { await sb.from("notificacoes").update({ lida_em: new Date().toISOString() }).eq("user_id", P.id).is("lida_em", null); await carregarAvisos(); casco(); render(); });
  }
  async function abrirAviso(id) {
    const n = S.notifs.find((x) => x.id === id); if (!n) return;
    folha(`<h3>${esc(n.titulo)}</h3><div class="muted" style="font-size:12px">${new Date(n.criado_em).toLocaleString("pt-BR")}</div><p style="white-space:pre-line">${esc(n.corpo || "")}</p>
      ${n.link && !n.link.startsWith("app.html#resumo") ? `<a class="btn sm" href="${esc(n.link)}">Abrir</a>` : ""}`);
    if (!n.lida_em) { n.lida_em = new Date().toISOString(); await sb.from("notificacoes").update({ lida_em: n.lida_em }).eq("id", id); casco(); render(); }
  }

  // ------------------------------------------------------------------ DETALHE DA LOJA
  function abrirLoja(codcli) {
    const c = S.cli.get(codcli) || { codcli };
    const d = hoje();
    const g = S.geo.get(codcli);
    const pres = S.presencas.filter((p) => p.codcli === codcli && p.cod_vendedor != null).sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).slice(0, 5);
    const peds = pedidosDe(codcli).sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 5);
    const pv = S.promVisitas.filter((v) => v.codcli === codcli).sort((a, b) => String(b.data).localeCompare(String(a.data)))[0];
    const ents = S.entregas.filter((e) => e.codcli === codcli).slice(0, 5);
    const end = [c.endereco, c.numero, c.bairro, c.cidade, c.uf].filter(Boolean).join(", ");
    const maps = g ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}` : end ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end)}` : null;
    folha(`<h3>${esc(c.fantasia || c.cliente || "Cliente " + codcli)}</h3>
      <div class="muted" style="font-size:13px">${esc(c.cliente || "")} · ${codcli}${c.vendedor ? " · " + esc(c.vendedor) : ""}</div>
      <div class="muted" style="font-size:13px;margin-top:4px">${esc(end)}</div>
      <div class="acts" style="margin:10px 0;display:flex;gap:6px;flex-wrap:wrap">
        ${c.telefone ? `<a class="chip" href="tel:${esc(String(c.telefone).replace(/\D/g, ""))}">📞 Ligar</a>` : ""}
        ${maps ? `<a class="chip" href="${maps}" target="_blank" rel="noopener">🧭 Rota</a>` : ""}
        <a class="chip" href="#pg/index.html?cli=${codcli}">🧾 Mix do cliente</a>
        ${pv ? `<span class="chip" id="fPv">📸 Promotor ${fmtDate(pv.data).slice(0, 5)}</span>` : ""}
      </div>
      ${!g || g.origem === "aprendido" ? `<div class="aviso-gps">${g ? "Localização aprendida no app." : "<b>Loja sem localização.</b> Sem ela o app não registra a visita presencial."}<br><button class="btn sm" id="salvarGeo">📍 Estou na loja — salvar localização</button> <span class="muted" id="geoMsg" style="font-size:12px"></span></div>` : ""}
      <table class="mini"><tbody>
        <tr><th>Última compra</th><td>${fmtDate(c.ultima_compra)}${c.dias_sem_comprar != null ? ` (${c.dias_sem_comprar} dias)` : ""}</td></tr>
        <tr><th>Visitas presenciais</th><td>${pres.map((p) => `${fmtDate(p.data).slice(0, 5)} ${hm(p.inicio)} (${dur(p.duracao_seg)})`).join("<br>") || "—"}</td></tr>
        <tr><th>Pedidos no mês</th><td>${peds.map((p) => `${fmtDate(p.data).slice(0, 5)} · ${brl(p.valor)}${p.posicao ? " · " + esc(p.posicao) : ""}`).join("<br>") || "—"}</td></tr>
        <tr><th>Entregas</th><td>${ents.map((e) => `${(ENT[e.status] || ENT.pendente)[2]}${e.ocorrencia ? " — " + esc(e.ocorrencia) : ""}`).join("<br>") || "—"}</td></tr>
      </tbody></table>
      ${pv && (pv.contagem || []).length ? `<h3 style="margin-top:14px">Contagem do promotor (${fmtDate(pv.data)})</h3>${tabelaContagem(pv)}` : ""}`);
    el("fPv")?.addEventListener("click", () => abrirPromotor(pv.chave, "fotos"));
    el("salvarGeo")?.addEventListener("click", async () => {
      const m = el("geoMsg");
      const usar = async (pos) => {
        if (pos.coords.accuracy > 60) { m.textContent = `Sinal impreciso (±${Math.round(pos.coords.accuracy)} m). Vá para a frente da loja e tente de novo.`; return; }
        const { data, error } = await sb.rpc("app_salvar_local_loja", { p_codcli: codcli, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude });
        if (error) { m.textContent = error.message; return; }
        S.geo.set(codcli, { codcli, lat: pos.coords.latitude, lng: pos.coords.longitude, origem: "aprendido" });
        m.textContent = data || "Salvo."; iniciarGps();
      };
      if (G.pos && Date.now() - G.pos.em < 30000) return usar({ coords: { latitude: G.pos.lat, longitude: G.pos.lng, accuracy: G.pos.acc } });
      m.textContent = "Pegando sua localização…";
      navigator.geolocation.getCurrentPosition(usar, (e) => { m.textContent = e.code === 1 ? "Permita a localização para o app." : "Não consegui pegar a localização."; }, { enableHighAccuracy: true, timeout: 30000 });
    });
  }

  function folha(html) {
    fecharFolha();
    const bg = document.createElement("div"); bg.className = "sheet-bg"; bg.id = "folha";
    bg.innerHTML = `<div class="sheet"><button class="fechar" aria-label="Fechar">✕</button>${html}</div>`;
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.classList.contains("fechar")) fecharFolha(); });
    document.body.appendChild(bg);
  }
  function fecharFolha() { el("folha")?.remove(); }

  // ------------------------------------------------------------------ início
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  root.innerHTML = `<div class="vazio" style="padding-top:40vh"><span class="spinner dark"></span></div>`;
  await carregar();
  casco(); render();
  // histórico de compras em segundo plano (alertas de estoque e oportunidades na tela inicial)
  if (!SUP) carregarMix().then(() => { if (S.rota === "inicio") render(); }, () => {});
  sb.from("acessos").insert({ user_id: P.id, tipo: "app" }).then(() => {}, () => {});
  if (LS.get("mc.gps", false)) iniciarGps();
  reenviarPendentes();
  window.addEventListener("online", reenviarPendentes);
  // novidades: avisos a cada 1 min; dados a cada 5 min e ao voltar para o app
  let ultimoAviso = S.notifs[0]?.id || 0;
  setInterval(async () => {
    await carregarAvisos();
    const novo = S.notifs[0];
    if (novo && novo.id !== ultimoAviso) {
      ultimoAviso = novo.id; toast(novo.titulo);
      const LN = CAP && window.Capacitor.Plugins.LocalNotifications;
      if (LN) LN.schedule({ notifications: [{ id: novo.id % 2147483647, title: novo.titulo, body: (novo.corpo || "").split("\n")[0], extra: { link: novo.link } }] }).catch(() => {}); if (["entrega", "promotor"].includes(novo.tipo)) await carregar(); casco(); render(); }
  }, 60000);
  setInterval(async () => { if (document.visibilityState === "visible") { await carregar(); casco(); render(); } }, 5 * 60000);
  document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible" && S.carregadoEm && Date.now() - S.carregadoEm > 120000) { await carregar(); casco(); render(); } });
})();
