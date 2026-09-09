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
      `<a href="index.html" class="${active === "app" ? "active" : ""}">Consulta</a>`,
      `<a href="roteiro.html" class="${active === "roteiro" ? "active" : ""}">Roteiro</a>`,
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

  window.Mix = { sb, configured, cfg, fmtBRL, fmtNum, fmtInt, fmtDate, statusClass, esc, el, showMsg, ROLE_LABEL,
    getSessionProfile, login, logout, requireAuth, renderTopbar, bindTopbar, openModal, closeModal, toast };
})();
