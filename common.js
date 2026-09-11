/* Funções compartilhadas: cliente Supabase, sessão, formatação, UI helpers */
(function () {
  const cfg = window.MIX_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.startsWith("COLE_") && !cfg.SUPABASE_ANON_KEY.startsWith("COLE_");

  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const LOGIN_DOMAIN = "@mix.app";
  const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  const fmtInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

  function fmtDate(d) {
    if (!d) return "—";
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split("-");
    if (!y || !m || !day) return s;
    return `${day}/${m}/${y}`;
  }

  function statusClass(status, dias) {
    const s = (status || "").toUpperCase();
    if (s.includes("30 DIAS") || s.includes("31 A 60")) return "ok";
    if (s.includes("61 A 90") || s.includes("91 A 180")) return "warn";
    if (s.includes("181") || s.includes("ANO")) return "bad";
    if (dias != null) return dias <= 60 ? "ok" : dias <= 180 ? "warn" : "bad";
    return "gray";
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function el(id) { return document.getElementById(id); }

  function showMsg(container, text, type = "info") {
    container.innerHTML = text ? `<div class="msg ${type}">${esc(text)}</div>` : "";
  }

  const ROLE_LABEL = { admin: "Administrador", supervisor: "Supervisor", vendedor: "Vendedor" };

  async function getSessionProfile() {
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data: profile, error } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (error || !profile) return null;
    return { session, profile };
  }

  async function login(loginName, password) {
    const email = loginName.trim().toLowerCase().includes("@") ? loginName.trim().toLowerCase() : loginName.trim().toLowerCase() + LOGIN_DOMAIN;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === "Invalid login credentials" ? "Usuário ou senha inválidos" : error.message);
  }

  async function logout() {
    await sb.auth.signOut();
    location.href = "index.html";
  }

  /** Requer sessão; redireciona para login se não houver. Retorna {session, profile}. */
  async function requireAuth(opts = {}) {
    if (!sb) {
      document.body.innerHTML = `<div class="wrap"><div class="card card-pad"><h1>Configuração pendente</h1>
        <p class="sub">Edite o arquivo <span class="mono">config.js</span> e preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados do seu projeto Supabase.</p></div></div>`;
      throw new Error("not configured");
    }
    const ctx = await getSessionProfile();
    if (!ctx) { location.href = "index.html"; throw new Error("no session"); }
    if (opts.adminOnly && ctx.profile.role !== "admin") { location.href = "index.html"; throw new Error("forbidden"); }
    return ctx;
  }

  function renderTopbar(profile, active) {
    const nav = [
      `<a href="index.html" class="${active === "app" ? "active" : ""}">Consulta mix</a>`,
      `<a href="roteiro.html" class="${active === "roteiro" ? "active" : ""}">Roteiro promotor</a>`,
      `<a href="roteiro.html?tipo=vendedor" class="${active === "roteiro_vendedor" ? "active" : ""}">Roteiro vendedor</a>`,
      `<a href="clientes.html" class="${active === "clientes" ? "active" : ""}">Clientes</a>`,
      `<a href="metas.html" class="${active === "metas" ? "active" : ""}">Metas</a>`,
      profile.role === "admin" ? `<a href="admin.html" class="${active === "admin" ? "active" : ""}">Administração</a>` : "",
    ].join("");
    return `
      <header class="topbar">
        <div class="logo"><span class="mark">M</span>${esc(cfg.EMPRESA || "Mix Clientes")}</div>
        <nav>${nav}</nav>
        <div class="spacer"></div>
        <div class="user">
          <span>${esc(profile.nome)}</span>
          <span class="role">${esc(ROLE_LABEL[profile.role] || profile.role)}</span>
          <button id="btnSenha" title="Trocar minha senha">Senha</button>
          <button id="btnSair">Sair</button>
        </div>
      </header>`;
  }

  function bindTopbar() {
    el("btnSair")?.addEventListener("click", logout);
    el("btnSenha")?.addEventListener("click", () => {
      openModal(`
        <h3>Trocar minha senha</h3>
        <div class="field"><label>Nova senha</label><input type="password" id="np1" autocomplete="new-password"></div>
        <div class="field"><label>Confirmar</label><input type="password" id="np2" autocomplete="new-password"></div>
        <div id="npMsg"></div>
        <div class="actions"><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="npOk">Salvar</button></div>`);
      el("npOk").onclick = async () => {
        const a = el("np1").value, b = el("np2").value;
        if (a.length < 4) return showMsg(el("npMsg"), "Mínimo de 4 caracteres.", "err");
        if (a !== b) return showMsg(el("npMsg"), "As senhas não conferem.", "err");
        const { error } = await sb.rpc("trocar_minha_senha", { p_senha: a });
        if (error) return showMsg(el("npMsg"), error.message, "err");
        closeModal(); toast("Senha alterada com sucesso.");
      };
    });
  }

  function openModal(html) {
    closeModal();
    const bg = document.createElement("div");
    bg.className = "modal-bg"; bg.id = "modalBg";
    bg.innerHTML = `<div class="card modal">${html}</div>`;
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.hasAttribute("data-close")) closeModal(); });
    document.body.appendChild(bg);
    bg.querySelector("input")?.focus();
  }
  function closeModal() { el("modalBg")?.remove(); }

  function toast(text, type = "ok") {
    const t = document.createElement("div");
    t.className = `msg ${type}`;
    t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:60;box-shadow:var(--shadow)";
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  /**
   * Proteção contra cópia para o perfil vendedor: bloqueia seleção de texto, botão direito,
   * copiar/imprimir/salvar por teclado, impressão da página e aplica marca d'água com nome e data.
   * Não impede print/foto de tela — serve para dificultar cópia em massa e identificar a origem.
   * Retorna true se as restrições estão ativas (páginas usam isso para esconder botões de exportar).
   */
  function protegerDados(profile) {
    const restrito = !!profile && profile.role === "vendedor" && cfg.PROTEGER_VENDEDOR !== false;
    if (!restrito) return false;
    const marca = `${profile.nome} · ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    const st = document.createElement("style");
    st.textContent = `
      body.protegido .results, body.protegido table, body.protegido .kpis, body.protegido .client-head, body.protegido .rt-group { user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; }
      body.protegido input, body.protegido textarea { user-select:text; -webkit-user-select:text; }
      @media print { body.protegido > * { display:none !important; } body.protegido::before { content:"Impressão desativada para este perfil."; display:block; padding:40px; font:16px sans-serif; } }
      .marca-dagua { position:fixed; inset:0; pointer-events:none; z-index:50; overflow:hidden; opacity:.07; }
      .marca-dagua span { position:absolute; white-space:nowrap; font:700 15px/1 sans-serif; color:#000; transform:rotate(-24deg); }`;
    document.head.appendChild(st);
    document.body.classList.add("protegido");
    const wm = document.createElement("div"); wm.className = "marca-dagua"; wm.setAttribute("aria-hidden", "true");
    let html = "";
    for (let y = -40; y < 2400; y += 140) for (let x = -200; x < 2600; x += 420) html += `<span style="left:${x}px;top:${y}px">${esc(marca)}</span>`;
    wm.innerHTML = html;
    document.body.appendChild(wm);
    const bloquear = (e) => { e.preventDefault(); toast("Cópia desativada para este perfil.", "err"); };
    document.addEventListener("contextmenu", (e) => { if (!e.target.closest("input,textarea")) bloquear(e); });
    document.addEventListener("copy", (e) => { if (!e.target.closest("input,textarea")) bloquear(e); });
    document.addEventListener("cut", (e) => { if (!e.target.closest("input,textarea")) bloquear(e); });
    document.addEventListener("dragstart", (e) => { if (!e.target.closest("input,textarea")) e.preventDefault(); });
    document.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && ["p", "s", "u"].includes(k)) bloquear(e);
      if (mod && ["a", "c", "x"].includes(k) && !e.target.closest("input,textarea")) bloquear(e);
      if (e.key === "F12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k))) e.preventDefault();
    });
    window.addEventListener("beforeprint", () => toast("Impressão desativada para este perfil.", "err"));
    return true;
  }

  // ---------------- METAS (venda do ano passado + % de crescimento) ----------------
  // Percentuais em config.js (METAS: { valor, qtd, mix, clientes }); padrão 15 / 15 / 20 / 15.
  const METAS_PCT = Object.assign({ valor: 15, qtd: 15, mix: 20, clientes: 15 }, cfg.METAS || {});
  const fmtMes = (d) => { if (!d) return "—"; const [y, m] = String(d).slice(0, 10).split("-"); return `${m}/${y}`; };
  const NOME_MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const nomeMes = (d) => { if (!d) return "—"; const [y, m] = String(d).slice(0, 10).split("-"); return `${NOME_MES[+m - 1]}/${y}`; };
  const metaDe = (base, pct, inteiro) => { const v = (+base || 0) * (1 + pct / 100); return inteiro ? Math.ceil(v - 1e-9) : Math.round(v * 100) / 100; };
  /**
   * Calcula a meta de um cliente (linha de metas_clientes) e o que falta.
   * status: "sem_base" (sem venda no ano passado), "batida", "quase" (>= 80%), "falta".
   */
  function calcMeta(r) {
    const meta = { valor: metaDe(r.base_valor, METAS_PCT.valor), qtd: metaDe(r.base_qtd, METAS_PCT.qtd, true), mix: metaDe(r.base_mix, METAS_PCT.mix, true) };
    const real = { valor: +r.real_valor || 0, qtd: +r.real_qtd || 0, mix: +r.real_mix || 0 };
    const falta = { valor: Math.max(0, meta.valor - real.valor), qtd: Math.max(0, meta.qtd - real.qtd), mix: Math.max(0, meta.mix - real.mix) };
    const pct = meta.valor > 0 ? real.valor / meta.valor : (real.valor > 0 ? 1 : 0);
    const batida = meta.valor > 0 && falta.valor <= 0 && falta.qtd <= 0 && falta.mix <= 0;
    let status = meta.valor <= 0 ? "sem_base" : batida ? "batida" : pct >= 0.8 ? "quase" : "falta";
    const partes = [];
    if (falta.valor > 0) partes.push(fmtBRL.format(falta.valor));
    if (falta.qtd > 0) partes.push(`${fmtInt.format(falta.qtd)} unidades`);
    if (falta.mix > 0) partes.push(`${falta.mix} ${falta.mix === 1 ? "produto" : "produtos"} no mix`);
    const msg = status === "sem_base"
      ? (real.valor > 0 ? "Cliente sem venda no mesmo mês do ano passado — tudo que comprar é crescimento." : "Sem venda no mesmo mês do ano passado — sem meta calculada.")
      : status === "batida" ? "🎉 Meta deste cliente batida!"
      : status === "quase" ? `Você quase atingiu a meta deste cliente: ${partes.length ? "faltam " + partes.join(", ") : "falta pouco"}.`
      : `Para bater a meta deste cliente ${partes.length === 1 ? "falta" : "faltam"} ${partes.join(", ")}.`;
    return { meta, real, falta, pct, status, msg };
  }
  const metaBadge = (status) => status === "batida" ? "ok" : status === "quase" ? "warn" : status === "falta" ? "bad" : "gray";
  const metaLabel = { batida: "Meta batida", quase: "Quase lá", falta: "Falta", sem_base: "Sem base" };

  window.Mix = { sb, configured, cfg, fmtBRL, fmtNum, fmtInt, fmtDate, statusClass, esc, el, showMsg, ROLE_LABEL,
    getSessionProfile, login, logout, requireAuth, renderTopbar, bindTopbar, openModal, closeModal, toast, protegerDados,
    METAS_PCT, fmtMes, nomeMes, metaDe, calcMeta, metaBadge, metaLabel };
})();
