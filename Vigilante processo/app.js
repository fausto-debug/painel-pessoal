// =============================================================
// app.js
// Local: raiz do projeto (mesma pasta do index.html)
//
// Ponto de entrada da aplicação. Cuida de:
//  - alternância entre telas de autenticação e o Dashboard (proteção de rotas)
//  - toda a lógica de UI que já existia (antes em <script> inline)
//  - agora lendo/gravando no Firestore em vez do LocalStorage
// =============================================================

import { auth } from "./firebase.js";
import {
  registerUser,
  loginUser,
  logoutUser,
  resetPassword,
  watchAuthState,
  traduzErroFirebase
} from "./auth.js";
import {
  watchUserProfile,
  updateUserProfile,
  watchCollection,
  addItem,
  updateItem,
  deleteItem
} from "./database.js";
import { uploadProfilePhoto, PhotoValidationError } from "./storage.js";

/* =====================================================================
   CACHE LOCAL — espelha o Firestore em memória (populado pelos listeners
   em tempo real). Nenhuma escrita acontece aqui: toda alteração vai
   direto para o Firestore, e os listeners atualizam este cache sozinhos.
   ===================================================================== */
let currentUid = null;
let profile = { name: "Usuário", photo: "", accent: "gold", animations: true };
let transactions = [];
let reserves = [];
let bills = [];
let habits = [];
let notes = [];
let workoutLogs = [];
let unsubscribers = [];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayISO() { const d = new Date(); return d.toISOString().slice(0, 10); }
function fmtMoney(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtDate(iso) { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function daysBetween(iso) { const t = new Date(todayISO()); const d = new Date(iso); return Math.ceil((d - t) / 86400000); }
function esc(str) {
  return (str ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const ACCENTS = { gold: "#F5C518", blue: "#3B82F6", red: "#EF4444", green: "#10B981", purple: "#8B5CF6" };
const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MUSCLE_GROUPS = ["Peito", "Costas", "Ombro", "Bíceps", "Tríceps", "Pernas", "Cardio"];
const FIN_CATEGORIES = { receita: ["Salário", "Freelance", "Investimentos", "Outros"], despesa: ["Moradia", "Alimentação", "Transporte", "Lazer", "Saúde", "Educação", "Outros"] };

/* =====================================================================
   TOAST
   ===================================================================== */
function toast(msg, type = "default") {
  const wrap = document.getElementById("toast-wrap");
  const el = document.createElement("div");
  el.className = "toast " + (type === "success" ? "success" : type === "danger" ? "danger" : "");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 2600);
}

/* =====================================================================
   AUTENTICAÇÃO — troca de telas e proteção de rotas
   ===================================================================== */
function showScreen(id) {
  document.querySelectorAll(".auth-screen, #appRoot").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

document.getElementById("goSignup").addEventListener("click", () => showScreen("screenSignup"));
document.getElementById("goLoginFromSignup").addEventListener("click", () => showScreen("screenLogin"));
document.getElementById("goForgot").addEventListener("click", () => showScreen("screenForgot"));
document.getElementById("goLoginFromForgot").addEventListener("click", () => showScreen("screenLogin"));

// Ativa/desativa o estado visual de carregamento em um botão de formulário
// (evita duplo-clique e dá feedback imediato ao usuário).
async function withButtonLoading(button, task) {
  button.classList.add("is-loading");
  button.disabled = true;
  try {
    await task();
  } finally {
    button.classList.remove("is-loading");
    button.disabled = false;
  }
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("loginError");
  errEl.classList.remove("show");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const btn = e.target.querySelector("button[type=submit]");
  await withButtonLoading(btn, async () => {
    try {
      await loginUser(email, password);
      // o onAuthStateChanged cuida de mostrar o dashboard
    } catch (err) {
      errEl.textContent = traduzErroFirebase(err);
      errEl.classList.add("show");
    }
  });
});

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("signupError");
  errEl.classList.remove("show");
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirm = document.getElementById("signupConfirm").value;
  if (password !== confirm) {
    errEl.textContent = "As senhas não coincidem.";
    errEl.classList.add("show");
    return;
  }
  const btn = e.target.querySelector("button[type=submit]");
  await withButtonLoading(btn, async () => {
    try {
      await registerUser(name, email, password);
    } catch (err) {
      errEl.textContent = traduzErroFirebase(err);
      errEl.classList.add("show");
    }
  });
});

document.getElementById("forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("forgotError");
  const okEl = document.getElementById("forgotSuccess");
  errEl.classList.remove("show"); okEl.classList.remove("show");
  const email = document.getElementById("forgotEmail").value.trim();
  const btn = e.target.querySelector("button[type=submit]");
  await withButtonLoading(btn, async () => {
    try {
      await resetPassword(email);
      okEl.textContent = "Enviamos um link de redefinição de senha para o seu e-mail.";
      okEl.classList.add("show");
    } catch (err) {
      errEl.textContent = traduzErroFirebase(err);
      errEl.classList.add("show");
    }
  });
});

// Reseta a UI da sidebar para o estado padrão — corrige o bug em que o menu
// lateral podia continuar aberto (mobile) ou numa view antiga após o logout.
function resetShellUI() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("sidebarBackdrop").classList.remove("show");
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  const dashBtn = document.querySelector('.nav-item[data-view="dashboard"]');
  if (dashBtn) { dashBtn.classList.add("active"); dashBtn.setAttribute("aria-current", "page"); }
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const dashView = document.getElementById("view-dashboard");
  if (dashView) dashView.classList.add("active");
  closeModal();
}

function logout() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  logoutUser();
}

function showRouteTransition(on) {
  document.getElementById("routeTransition").classList.toggle("show", on);
}

// Observador global de sessão: decide se mostra o Dashboard ou o Login.
// Isso é a "proteção de rotas" — sem usuário autenticado, o #appRoot nunca é exibido.
let firstAuthCheck = true;
watchAuthState((user) => {
  if (!firstAuthCheck) showRouteTransition(true);
  if (user) {
    currentUid = user.uid;
    showScreen("appRoot");
    subscribeToAllData(user.uid);
  } else {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    currentUid = null;
    transactions = []; reserves = []; bills = []; habits = []; notes = []; workoutLogs = [];
    profile = { name: "Usuário", photo: "", accent: "gold", animations: true };
    resetShellUI();
    showScreen("screenLogin");
  }
  document.getElementById("loadingScreen").classList.add("hidden");
  firstAuthCheck = false;
  setTimeout(() => showRouteTransition(false), 220);
});

function subscribeToAllData(u) {
  unsubscribers.push(watchUserProfile(u, (p) => {
    if (p) {
      profile = p;
      applyAccent();
      document.body.dataset.anim = profile.animations ? "on" : "off";
      renderAll();
    }
  }));
  unsubscribers.push(watchCollection(u, "transactions", (items) => { transactions = items; renderAll(); }));
  unsubscribers.push(watchCollection(u, "reserves", (items) => { reserves = items; renderAll(); }));
  unsubscribers.push(watchCollection(u, "bills", (items) => { bills = items; renderAll(); }));
  unsubscribers.push(watchCollection(u, "habits", (items) => { habits = items; renderAll(); }));
  unsubscribers.push(watchCollection(u, "notes", (items) => { notes = items; renderAll(); }));
  unsubscribers.push(watchCollection(u, "workouts", (items) => { workoutLogs = items; renderAll(); }));
}

/* =====================================================================
   NAVEGAÇÃO (sidebar)
   ===================================================================== */
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => { b.classList.remove("active"); b.removeAttribute("aria-current"); });
    btn.classList.add("active");
    btn.setAttribute("aria-current", "page");
    const view = btn.dataset.view;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById("view-" + view).classList.add("active");
    closeMobileSidebar();
    renderAll();
  });
});
document.getElementById("collapseBtn").addEventListener("click", () => {
  const sb = document.getElementById("sidebar");
  const btn = document.getElementById("collapseBtn");
  sb.classList.toggle("collapsed");
  const collapsed = sb.classList.contains("collapsed");
  btn.textContent = collapsed ? "▸" : "◂";
  btn.setAttribute("aria-expanded", String(!collapsed));
});
function openMobileSidebar() {
  document.getElementById("sidebar").classList.add("mobile-open");
  document.getElementById("sidebarBackdrop").classList.add("show");
}
function closeMobileSidebar() {
  document.getElementById("sidebar").classList.remove("mobile-open");
  document.getElementById("sidebarBackdrop").classList.remove("show");
}
document.getElementById("mobileMenuBtn").addEventListener("click", () => {
  const sb = document.getElementById("sidebar");
  sb.classList.contains("mobile-open") ? closeMobileSidebar() : openMobileSidebar();
});
document.getElementById("sidebarBackdrop").addEventListener("click", closeMobileSidebar);
document.getElementById("exportQuickBtn").addEventListener("click", exportData);
document.getElementById("logoutBtn").addEventListener("click", logout);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMobileSidebar();
    if (document.getElementById("modalBackdrop").classList.contains("open")) closeModal();
  }
});

/* =====================================================================
   RELÓGIO / SAUDAÇÃO
   ===================================================================== */
function updateClock() {
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  document.getElementById("greetingText").innerHTML = `<span class="wave" aria-hidden="true">👋</span> ${greet}, ${esc((profile.name || "Usuário").split(" ")[0])}`;
  const opts = { weekday: "long", day: "2-digit", month: "long" };
  const dateStr = now.toLocaleDateString("pt-BR", opts);
  const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("datetimeText").textContent = `${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)} · ${timeStr}`;
}
setInterval(updateClock, 30000);

/* =====================================================================
   MODAL GENÉRICO
   ===================================================================== */
let lastFocusedBeforeModal = null;
function openModal(html) {
  lastFocusedBeforeModal = document.activeElement;
  document.getElementById("modalBox").innerHTML = html;
  document.getElementById("modalBackdrop").classList.add("open");
  const firstField = document.querySelector("#modalBox input, #modalBox select, #modalBox textarea");
  if (firstField) setTimeout(() => firstField.focus(), 50);
}
function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
  if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") lastFocusedBeforeModal.focus();
}
document.getElementById("modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
window.closeModal = closeModal; // usado pelos botões "Cancelar" gerados via innerHTML

/* =====================================================================
   FINANCEIRO — transações
   ===================================================================== */
function openTxModal(type, editId) {
  const editing = editId ? transactions.find((t) => t.id === editId) : null;
  const t = editing ? editing.type : type;
  const cats = FIN_CATEGORIES[t];
  openModal(`
    <div class="modal-head"><h3>${editing ? "Editar" : "Adicionar"} ${t === "receita" ? "receita" : "despesa"}</h3><button class="btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Valor (R$)</label><input type="number" step="0.01" id="txValor" value="${editing ? editing.amount : ""}" placeholder="0,00"></div>
    <div class="field"><label>Categoria</label><select id="txCategoria">${cats.map((c) => `<option ${editing && editing.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
    <div class="field"><label>Data</label><input type="date" id="txData" value="${editing ? editing.date : todayISO()}"></div>
    <div class="field"><label>Observações</label><textarea id="txObs" placeholder="Opcional">${editing ? esc(editing.note || "") : ""}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="window.saveTx('${t}','${editId || ""}')">Salvar</button>
    </div>
  `);
}
async function saveTx(type, editId) {
  const amount = parseFloat(document.getElementById("txValor").value);
  if (!amount || amount <= 0) { toast("Informe um valor válido", "danger"); return; }
  const category = document.getElementById("txCategoria").value;
  const date = document.getElementById("txData").value || todayISO();
  const note = document.getElementById("txObs").value;
  const data = { type, amount, category, date, note };
  if (editId) await updateItem(currentUid, "transactions", editId, data);
  else await addItem(currentUid, "transactions", data);
  closeModal(); toast("Lançamento salvo com sucesso", "success");
}
async function deleteTx(id) { await deleteItem(currentUid, "transactions", id); toast("Lançamento removido"); }

function renderFinance() {
  const totalIn = transactions.filter((t) => t.type === "receita").reduce((s, t) => s + t.amount, 0);
  const totalOut = transactions.filter((t) => t.type === "despesa").reduce((s, t) => s + t.amount, 0);
  document.getElementById("finTotalIn").textContent = fmtMoney(totalIn);
  document.getElementById("finTotalOut").textContent = fmtMoney(totalOut);
  document.getElementById("finBalance").textContent = fmtMoney(totalIn - totalOut);
  document.getElementById("txCount").textContent = `${transactions.length} lançamento(s)`;

  const list = document.getElementById("txList");
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  list.innerHTML = sorted.length ? sorted.map((t) => `
    <div class="row-item">
      <div class="ic" style="background:${t.type === "receita" ? "var(--success-dim)" : "var(--danger-dim)"}; color:${t.type === "receita" ? "var(--success)" : "var(--danger)"}">${t.type === "receita" ? "↑" : "↓"}</div>
      <div class="info"><div class="t1">${esc(t.category)}</div><div class="t2">${fmtDate(t.date)}${t.note ? " · " + esc(t.note) : ""}</div></div>
      <div class="amount ${t.type === "receita" ? "in" : "out"}">${t.type === "receita" ? "+" : "-"} ${fmtMoney(t.amount)}</div>
      <div class="row-actions">
        <button class="btn-ghost" title="Editar" onclick="window.openTxModal('${t.type}','${t.id}')">✎</button>
        <button class="btn-danger-ghost" title="Excluir" onclick="window.deleteTx('${t.id}')">🗑</button>
      </div>
    </div>`).join("") : `<div class="empty"><span class="ic">📭</span>Nenhum lançamento ainda</div>`;

  drawFinanceMonthlyChart();
}

/* =====================================================================
   RESERVA FINANCEIRA — metas
   ===================================================================== */
function openGoalModal(editId) {
  const editing = editId ? reserves.find((g) => g.id === editId) : null;
  openModal(`
    <div class="modal-head"><h3>${editing ? "Editar" : "Nova"} meta</h3><button class="btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Nome da meta</label><input type="text" id="goalNome" value="${editing ? esc(editing.name) : ""}" placeholder="Ex: Reserva de emergência"></div>
    <div class="field-row">
      <div class="field"><label>Valor desejado (R$)</label><input type="number" step="0.01" id="goalValor" value="${editing ? editing.target : ""}"></div>
      <div class="field"><label>Já guardado (R$)</label><input type="number" step="0.01" id="goalGuardado" value="${editing ? editing.saved : ""}"></div>
    </div>
    <div class="field"><label>Prazo</label><input type="date" id="goalPrazo" value="${editing ? editing.deadline : ""}"></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="window.saveGoal('${editId || ""}')">Salvar</button>
    </div>
  `);
}
async function saveGoal(editId) {
  const name = document.getElementById("goalNome").value.trim();
  const target = parseFloat(document.getElementById("goalValor").value);
  const saved = parseFloat(document.getElementById("goalGuardado").value) || 0;
  const deadline = document.getElementById("goalPrazo").value;
  if (!name || !target) { toast("Preencha nome e valor da meta", "danger"); return; }
  const data = { name, target, saved, deadline };
  if (editId) await updateItem(currentUid, "reserves", editId, data);
  else await addItem(currentUid, "reserves", data);
  closeModal(); toast("Meta salva com sucesso", "success");
}
async function deleteGoal(id) { await deleteItem(currentUid, "reserves", id); }

function dialSVG(pct, size = 76) {
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - Math.min(pct, 1));
  return `<div class="dial" style="width:${size}px;height:${size}px;">
    <svg width="${size}" height="${size}" viewBox="0 0 76 76">
      <circle class="bg" cx="38" cy="38" r="${r}"></circle>
      <circle class="fg" cx="38" cy="38" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"></circle>
    </svg>
    <div class="pct">${Math.round(pct * 100)}%</div>
  </div>`;
}
function renderReserve() {
  const grid = document.getElementById("goalsGrid");
  grid.innerHTML = reserves.length ? reserves.map((g) => {
    const pct = g.target > 0 ? g.saved / g.target : 0;
    const dleft = g.deadline ? daysBetween(g.deadline) : null;
    return `<div class="card">
      <div style="display:flex; gap:14px; align-items:center;">
        ${dialSVG(pct)}
        <div style="flex:1;">
          <div style="font-weight:700; font-size:14px;">${esc(g.name)}</div>
          <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">${fmtMoney(g.saved)} de ${fmtMoney(g.target)}</div>
          ${g.deadline ? `<div style="font-size:11px; color:var(--text-dim); margin-top:4px;">${dleft >= 0 ? `⏳ ${dleft} dia(s) restante(s)` : `Prazo encerrado`}</div>` : ""}
        </div>
      </div>
      <div class="progress-bar" style="margin-top:14px;"><div style="width:${Math.min(pct * 100, 100)}%"></div></div>
      <div class="row-actions" style="justify-content:flex-end; margin-top:10px;">
        <button class="btn-ghost" onclick="window.openGoalModal('${g.id}')">✎ Editar</button>
        <button class="btn-danger-ghost" onclick="window.deleteGoal('${g.id}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join("") : `<div class="card empty"><span class="ic">🏦</span>Crie sua primeira meta financeira</div>`;
}

/* =====================================================================
   CONTAS FIXAS
   ===================================================================== */
function openBillModal(editId) {
  const editing = editId ? bills.find((b) => b.id === editId) : null;
  openModal(`
    <div class="modal-head"><h3>${editing ? "Editar" : "Nova"} conta</h3><button class="btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Nome</label><input type="text" id="billNome" value="${editing ? esc(editing.name) : ""}" placeholder="Ex: Internet"></div>
    <div class="field-row">
      <div class="field"><label>Valor (R$)</label><input type="number" step="0.01" id="billValor" value="${editing ? editing.amount : ""}"></div>
      <div class="field"><label>Vencimento</label><input type="date" id="billData" value="${editing ? editing.dueDate : ""}"></div>
    </div>
    <div class="field"><label>Status</label><select id="billStatus">
      <option value="pendente" ${editing && editing.status === "pendente" ? "selected" : ""}>Pendente</option>
      <option value="pago" ${editing && editing.status === "pago" ? "selected" : ""}>Pago</option>
      <option value="atrasado" ${editing && editing.status === "atrasado" ? "selected" : ""}>Atrasado</option>
    </select></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="window.saveBill('${editId || ""}')">Salvar</button>
    </div>
  `);
}
async function saveBill(editId) {
  const name = document.getElementById("billNome").value.trim();
  const amount = parseFloat(document.getElementById("billValor").value);
  const dueDate = document.getElementById("billData").value;
  const status = document.getElementById("billStatus").value;
  if (!name || !amount || !dueDate) { toast("Preencha todos os campos", "danger"); return; }
  const data = { name, amount, dueDate, status };
  if (editId) await updateItem(currentUid, "bills", editId, data);
  else await addItem(currentUid, "bills", data);
  closeModal(); toast("Conta salva", "success");
}
async function deleteBill(id) { await deleteItem(currentUid, "bills", id); }
async function cycleBillStatus(id) {
  const b = bills.find((x) => x.id === id);
  const next = b.status === "pendente" ? "pago" : b.status === "pago" ? "atrasado" : "pendente";
  await updateItem(currentUid, "bills", id, { status: next });
}
function renderBills() {
  const list = document.getElementById("billsList");
  const sorted = [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  list.innerHTML = sorted.length ? sorted.map((b) => {
    const dleft = daysBetween(b.dueDate);
    const urgent = b.status !== "pago" && dleft <= 3;
    return `<div class="row-item" style="${urgent ? "border-color:var(--danger); box-shadow:0 0 0 1px var(--danger-dim);" : ""}">
      <div class="ic" style="background:var(--accent-dimmer); color:var(--accent);">🧾</div>
      <div class="info"><div class="t1">${esc(b.name)} ${urgent ? "⚠️" : ""}</div><div class="t2">Vence em ${fmtDate(b.dueDate)} ${dleft >= 0 && b.status !== "pago" ? `(${dleft}d)` : ""}</div></div>
      <div class="amount">${fmtMoney(b.amount)}</div>
      <span class="badge ${b.status === "pago" ? "paid" : b.status === "atrasado" ? "late" : "pending"}" style="cursor:pointer" onclick="window.cycleBillStatus('${b.id}')">${b.status}</span>
      <div class="row-actions">
        <button class="btn-ghost" onclick="window.openBillModal('${b.id}')">✎</button>
        <button class="btn-danger-ghost" onclick="window.deleteBill('${b.id}')">🗑</button>
      </div>
    </div>`;
  }).join("") : `<div class="card empty"><span class="ic">📅</span>Nenhuma conta cadastrada</div>`;
}

/* =====================================================================
   HÁBITOS
   ===================================================================== */
function openHabitModal(editId) {
  const editing = editId ? habits.find((h) => h.id === editId) : null;
  const selDays = editing ? editing.days : [1, 2, 3, 4, 5];
  openModal(`
    <div class="modal-head"><h3>${editing ? "Editar" : "Novo"} hábito</h3><button class="btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Nome</label><input type="text" id="habitNome" value="${editing ? esc(editing.name) : ""}" placeholder="Ex: Beber 2L de água"></div>
    <div class="field"><label>Descrição</label><textarea id="habitDesc" placeholder="Opcional">${editing ? esc(editing.description || "") : ""}</textarea></div>
    <div class="field-row">
      <div class="field"><label>Frequência</label><select id="habitFreq" onchange="document.getElementById('habitDaysField').style.display = this.value==='semanal' ? 'block' : 'none';">
        <option value="diario" ${editing && editing.frequency === "diario" ? "selected" : ""}>Diário</option>
        <option value="semanal" ${editing && editing.frequency === "semanal" ? "selected" : ""}>Dias específicos</option>
      </select></div>
      <div class="field"><label>Meta diária</label><input type="number" min="1" id="habitMeta" value="${editing ? editing.dailyGoal : 1}"></div>
    </div>
    <div class="field" id="habitDaysField" style="display:${editing && editing.frequency === "diario" ? "none" : "block"};"><label>Dias da semana</label>
      <div class="chip-select" id="habitDays">${WEEK_DAYS.map((d, i) => `<div class="chip ${selDays.includes(i) ? "active" : ""}" data-day="${i}" onclick="this.classList.toggle('active')" role="button" tabindex="0">${d}</div>`).join("")}</div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="window.saveHabit('${editId || ""}')">Salvar</button>
    </div>
  `);
}
async function saveHabit(editId) {
  const name = document.getElementById("habitNome").value.trim();
  if (!name) { toast("Informe o nome do hábito", "danger"); return; }
  const description = document.getElementById("habitDesc").value;
  const frequency = document.getElementById("habitFreq").value;
  const dailyGoal = parseInt(document.getElementById("habitMeta").value) || 1;
  const days = [...document.querySelectorAll("#habitDays .chip.active")].map((c) => parseInt(c.dataset.day));
  if (editId) {
    await updateItem(currentUid, "habits", editId, { name, description, frequency, dailyGoal, days });
  } else {
    await addItem(currentUid, "habits", { name, description, frequency, dailyGoal, days, completions: {} });
  }
  closeModal(); toast("Hábito salvo", "success");
}
async function deleteHabit(id) { await deleteItem(currentUid, "habits", id); }

function habitStreak(h) {
  let best = 0;
  const dates = Object.keys(h.completions || {}).filter((d) => h.completions[d]).sort();
  let running = 0, prevDate = null;
  dates.forEach((d) => {
    if (prevDate) {
      const diff = (new Date(d) - new Date(prevDate)) / 86400000;
      running = diff === 1 ? running + 1 : 1;
    } else running = 1;
    best = Math.max(best, running);
    prevDate = d;
  });
  let streak = 0, d = new Date();
  while (true) {
    const iso = d.toISOString().slice(0, 10);
    if (h.completions && h.completions[iso]) { streak++; d.setDate(d.getDate() - 1); } else break;
  }
  return { streak, best };
}
async function toggleHabit(id, ev) {
  const h = habits.find((x) => x.id === id);
  const iso = todayISO();
  const willComplete = !(h.completions && h.completions[iso]);
  await updateItem(currentUid, "habits", id, { [`completions.${iso}`]: willComplete });
  if (willComplete && profile.animations && ev) {
    const b = document.createElement("div");
    b.className = "burst"; b.textContent = "✅";
    b.style.left = ev.clientX - 10 + "px"; b.style.top = ev.clientY - 10 + "px";
    document.body.appendChild(b); setTimeout(() => b.remove(), 900);
  }
}
function renderHabits() {
  const grid = document.getElementById("habitsGrid");
  const iso = todayISO();
  grid.innerHTML = habits.length ? habits.map((h) => {
    const { streak, best } = habitStreak(h);
    const done = !!(h.completions && h.completions[iso]);
    const last14 = [...Array(14)].map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i));
      const iso2 = d.toISOString().slice(0, 10);
      return h.completions && h.completions[iso2] ? 1 : 0;
    });
    const totalDays = Object.keys(h.completions || {}).length || 1;
    const doneDays = Object.values(h.completions || {}).filter(Boolean).length;
    return `<div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div><div style="font-weight:700; font-size:14px;">${esc(h.name)}</div><div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">${esc(h.description || "")}</div></div>
        <button class="btn ${done ? "btn-accent" : ""}" onclick="window.toggleHabit('${h.id}', event)" style="padding:7px 12px;">${done ? "✓ Feito" : "Marcar"}</button>
      </div>
      <div style="display:flex; gap:14px; margin-top:14px;">
        <div><div class="label" style="font-size:10.5px; color:var(--text-dim);">STREAK</div><div style="font-weight:700; color:var(--accent);">🔥 ${streak}</div></div>
        <div><div class="label" style="font-size:10.5px; color:var(--text-dim);">MELHOR</div><div style="font-weight:700;">${best}</div></div>
        <div><div class="label" style="font-size:10.5px; color:var(--text-dim);">CONCLUSÃO</div><div style="font-weight:700;">${Math.round((doneDays / totalDays) * 100)}%</div></div>
      </div>
      <div style="display:flex; gap:3px; margin-top:14px;">
        ${last14.map((v) => `<div style="flex:1; height:20px; border-radius:4px; background:${v ? "var(--accent)" : "var(--graphite)"};"></div>`).join("")}
      </div>
      <div class="row-actions" style="justify-content:flex-end; margin-top:10px;">
        <button class="btn-ghost" onclick="window.openHabitModal('${h.id}')">✎</button>
        <button class="btn-danger-ghost" onclick="window.deleteHabit('${h.id}')">🗑</button>
      </div>
    </div>`;
  }).join("") : `<div class="card empty"><span class="ic">✅</span>Crie seu primeiro hábito</div>`;
}

/* =====================================================================
   NOTAS
   ===================================================================== */
function openNoteModal(editId) {
  const editing = editId ? notes.find((n) => n.id === editId) : null;
  openModal(`
    <div class="modal-head"><h3>${editing ? "Editar" : "Nova"} nota</h3><button class="btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Título</label><input type="text" id="noteTitulo" value="${editing ? esc(editing.title) : ""}"></div>
    <div class="field"><label>Conteúdo</label><textarea id="noteConteudo" style="min-height:120px;">${editing ? esc(editing.content) : ""}</textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="window.saveNote('${editId || ""}')">Salvar</button>
    </div>
  `);
}
async function saveNote(editId) {
  const title = document.getElementById("noteTitulo").value.trim() || "Sem título";
  const content = document.getElementById("noteConteudo").value;
  if (editId) {
    await updateItem(currentUid, "notes", editId, { title, content });
  } else {
    await addItem(currentUid, "notes", { title, content, date: todayISO(), pinned: false });
  }
  closeModal(); toast("Nota salva", "success");
}
async function deleteNote(id) { await deleteItem(currentUid, "notes", id); }
async function togglePin(id) {
  const n = notes.find((x) => x.id === id);
  await updateItem(currentUid, "notes", id, { pinned: !n.pinned });
}
function renderNotes() {
  const q = (document.getElementById("noteSearch").value || "").toLowerCase();
  const grid = document.getElementById("notesGrid");
  let filtered = notes.filter((n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  filtered.sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
  grid.innerHTML = filtered.length ? filtered.map((n) => `
    <div class="note-card ${n.pinned ? "pinned" : ""}">
      <span class="pin" onclick="window.togglePin('${n.id}')" style="cursor:pointer;">📌</span>
      <h4>${esc(n.title)}</h4>
      <p>${esc(n.content)}</p>
      <div class="meta"><span>${fmtDate(n.date)}</span>
        <span class="row-actions"><button class="btn-ghost" onclick="window.openNoteModal('${n.id}')">✎</button><button class="btn-danger-ghost" onclick="window.deleteNote('${n.id}')">🗑</button></span>
      </div>
    </div>`).join("") : `<div class="card empty" style="grid-column:1/-1;"><span class="ic">📝</span>Nenhuma nota encontrada</div>`;
}
document.getElementById("noteSearch").addEventListener("input", renderNotes);

/* =====================================================================
   TREINOS
   ===================================================================== */
let activeGroupFilter = "Todos";
function openWorkoutModal() {
  openModal(`
    <div class="modal-head"><h3>Registrar exercício</h3><button class="btn-ghost" onclick="closeModal()">✕</button></div>
    <div class="field"><label>Grupo muscular</label><select id="wkGrupo">${MUSCLE_GROUPS.map((g) => `<option>${g}</option>`).join("")}</select></div>
    <div class="field"><label>Exercício</label><input type="text" id="wkExercicio" placeholder="Ex: Supino reto"></div>
    <div class="field-row">
      <div class="field"><label>Séries</label><input type="number" id="wkSeries" value="3"></div>
      <div class="field"><label>Repetições</label><input type="number" id="wkReps" value="10"></div>
      <div class="field"><label>Peso (kg)</label><input type="number" step="0.5" id="wkPeso" value="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Data</label><input type="date" id="wkData" value="${todayISO()}"></div>
      <div class="field"><label>Duração (min)</label><input type="number" id="wkDuracao" value="45"></div>
    </div>
    <div class="field"><label>Observações</label><textarea id="wkObs" placeholder="Opcional"></textarea></div>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-accent" onclick="window.saveWorkout()">Salvar</button>
    </div>
  `);
}
async function saveWorkout() {
  const group = document.getElementById("wkGrupo").value;
  const exercise = document.getElementById("wkExercicio").value.trim();
  if (!exercise) { toast("Informe o nome do exercício", "danger"); return; }
  const sets = parseInt(document.getElementById("wkSeries").value) || 0;
  const reps = parseInt(document.getElementById("wkReps").value) || 0;
  const weight = parseFloat(document.getElementById("wkPeso").value) || 0;
  const date = document.getElementById("wkData").value || todayISO();
  const duration = parseInt(document.getElementById("wkDuracao").value) || 0;
  const notesTxt = document.getElementById("wkObs").value;
  await addItem(currentUid, "workouts", { group, exercise, sets, reps, weight, date, duration, notes: notesTxt });
  closeModal(); toast("Treino registrado", "success");
}
async function deleteWorkout(id) { await deleteItem(currentUid, "workouts", id); }
function setGroupFilter(g) { activeGroupFilter = g; renderWorkouts(); }
function renderWorkouts() {
  document.getElementById("wkTotal").textContent = workoutLogs.length;
  const avgTime = workoutLogs.length ? Math.round(workoutLogs.reduce((s, l) => s + l.duration, 0) / workoutLogs.length) : 0;
  document.getElementById("wkAvgTime").textContent = avgTime + " min";
  const counts = {};
  workoutLogs.forEach((l) => counts[l.group] = (counts[l.group] || 0) + 1);
  const topGroup = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "—";
  document.getElementById("wkTopGroup").textContent = topGroup;

  const tabsEl = document.getElementById("workoutTabs");
  tabsEl.innerHTML = ["Todos", ...MUSCLE_GROUPS].map((g) => `<div class="tab ${activeGroupFilter === g ? "active" : ""}" onclick="window.setGroupFilter('${g}')">${g}</div>`).join("");

  const filtered = activeGroupFilter === "Todos" ? workoutLogs : workoutLogs.filter((l) => l.group === activeGroupFilter);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  document.getElementById("workoutHistory").innerHTML = sorted.length ? sorted.map((l) => `
    <div class="row-item">
      <div class="ic" style="background:var(--accent-dimmer); color:var(--accent);">🏋️</div>
      <div class="info"><div class="t1">${esc(l.exercise)} <span style="color:var(--text-faint); font-weight:400;">· ${esc(l.group)}</span></div>
      <div class="t2">${fmtDate(l.date)} · ${l.sets}x${l.reps} · ${l.weight}kg</div></div>
      <div class="row-actions"><button class="btn-danger-ghost" onclick="window.deleteWorkout('${l.id}')">🗑</button></div>
    </div>`).join("") : `<div class="empty"><span class="ic">🏋️</span>Nenhum treino registrado</div>`;

  drawLoadChart(filtered);
}

/* =====================================================================
   DASHBOARD PRINCIPAL
   ===================================================================== */
function renderDashboard() {
  const totalIn = transactions.filter((t) => t.type === "receita").reduce((s, t) => s + t.amount, 0);
  const totalOut = transactions.filter((t) => t.type === "despesa").reduce((s, t) => s + t.amount, 0);
  const balance = totalIn - totalOut;
  const mainGoal = reserves[0];
  const iso = todayISO();
  const habitsToday = habits.filter((h) => !h.frequency || h.frequency === "diario" || (h.days || []).includes(new Date().getDay()));
  const habitsDoneToday = habitsToday.filter((h) => h.completions && h.completions[iso]).length;
  const workoutToday = workoutLogs.find((w) => w.date === iso);

  document.getElementById("dashCards").innerHTML = `
    <div class="card stat-card"><div class="top-row"><span class="label">Saldo atual</span><div class="ic-badge">💰</div></div><div class="value">${fmtMoney(balance)}</div></div>
    <div class="card stat-card"><div class="top-row"><span class="label">Meta financeira</span><div class="ic-badge">🏦</div></div><div class="value">${mainGoal ? Math.round((mainGoal.saved / mainGoal.target) * 100) + "%" : "—"}</div><div class="delta">${mainGoal ? mainGoal.name : "nenhuma meta criada"}</div></div>
    <div class="card stat-card"><div class="top-row"><span class="label">Hábitos hoje</span><div class="ic-badge">✅</div></div><div class="value">${habitsDoneToday}/${habitsToday.length}</div></div>
    <div class="card stat-card"><div class="top-row"><span class="label">Treino do dia</span><div class="ic-badge">🏋️</div></div><div class="value" style="font-size:15px;">${workoutToday ? workoutToday.exercise : "Sem registro"}</div></div>
    <div class="card stat-card"><div class="top-row"><span class="label">Notas</span><div class="ic-badge">📝</div></div><div class="value">${notes.length}</div></div>
  `;

  const summary = [];
  summary.push({ ic: "💰", label: "Saldo disponível", val: fmtMoney(balance) });
  summary.push({ ic: "✅", label: "Hábitos concluídos", val: `${habitsDoneToday} de ${habitsToday.length}` });
  const billsToday = bills.filter((b) => b.status !== "pago" && daysBetween(b.dueDate) <= 3 && daysBetween(b.dueDate) >= 0);
  summary.push({ ic: "📅", label: "Contas vencendo em breve", val: `${billsToday.length}` });
  summary.push({ ic: "📝", label: "Notas fixadas", val: `${notes.filter((n) => n.pinned).length}` });
  document.getElementById("todaySummary").innerHTML = summary.map((s) => `
    <div class="row-item"><div class="ic" style="background:var(--accent-dimmer); color:var(--accent);">${s.ic}</div>
    <div class="info"><div class="t1">${s.label}</div></div><div class="amount">${s.val}</div></div>`).join("");

  const upcoming = [...bills].filter((b) => b.status !== "pago").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 4);
  document.getElementById("upcomingBills").innerHTML = upcoming.length ? upcoming.map((b) => {
    const dleft = daysBetween(b.dueDate); const urgent = dleft <= 3;
    return `<div class="row-item" style="${urgent ? "border-color:var(--danger);" : ""}">
      <div class="ic" style="background:${urgent ? "var(--danger-dim)" : "var(--accent-dimmer)"}; color:${urgent ? "var(--danger)" : "var(--accent)"};">🧾</div>
      <div class="info"><div class="t1">${esc(b.name)}</div><div class="t2">Vence em ${fmtDate(b.dueDate)}</div></div>
      <div class="amount">${fmtMoney(b.amount)}</div>
    </div>`;
  }).join("") : `<div class="empty"><span class="ic">📅</span>Nenhuma conta pendente</div>`;

  drawFinanceEvolutionChart();
  drawHabitsEvolutionChart();
}

/* =====================================================================
   GRÁFICOS — canvas nativo, sem dependências externas
   ===================================================================== */
function setupCanvas(id) {
  const canvas = document.getElementById(id);
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = parent.clientWidth * dpr;
  canvas.height = parent.clientHeight * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w: parent.clientWidth, h: parent.clientHeight };
}
function drawBars(id, labels, values, colorPos = "--accent", colorNeg = "--danger") {
  const { ctx, w, h } = setupCanvas(id);
  ctx.clearRect(0, 0, w, h);
  const styles = getComputedStyle(document.body);
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const padB = 22, padT = 10;
  const barW = w / values.length;
  values.forEach((v, i) => {
    const barH = (Math.abs(v) / max) * (h - padB - padT);
    const x = i * barW + barW * 0.22;
    const bw = barW * 0.56;
    const y = h - padB - barH;
    ctx.fillStyle = v >= 0 ? styles.getPropertyValue(colorPos).trim() : styles.getPropertyValue(colorNeg).trim();
    ctx.beginPath();
    const r = 4;
    ctx.moveTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.lineTo(x + bw - r, y); ctx.arcTo(x + bw, y, x + bw, y + r, r);
    ctx.lineTo(x + bw, y + barH); ctx.lineTo(x, y + barH); ctx.closePath(); ctx.fill();
    ctx.fillStyle = styles.getPropertyValue("--text-faint").trim();
    ctx.font = "10.5px Inter"; ctx.textAlign = "center";
    ctx.fillText(labels[i], x + bw / 2, h - 6);
  });
}
function drawLine(id, labels, values) {
  const { ctx, w, h } = setupCanvas(id);
  ctx.clearRect(0, 0, w, h);
  const styles = getComputedStyle(document.body);
  const accent = styles.getPropertyValue("--accent").trim();
  const max = Math.max(1, ...values);
  const padB = 22, padT = 14, padL = 6, padR = 6;
  const stepX = (w - padL - padR) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => ({ x: padL + i * stepX, y: padT + (1 - v / max) * (h - padB - padT) }));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, h - padB);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, h - padB);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(245,197,24,0.25)"); grad.addColorStop(1, "rgba(245,197,24,0)");
  ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = accent; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.stroke();
  pts.forEach((p) => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fillStyle = accent; ctx.fill(); });
  ctx.fillStyle = styles.getPropertyValue("--text-faint").trim();
  ctx.font = "10.5px Inter"; ctx.textAlign = "center";
  labels.forEach((l, i) => ctx.fillText(l, pts[i].x, h - 6));
}
function lastNMonths(n) {
  const arr = []; const d = new Date();
  for (let i = n - 1; i >= 0; i--) { arr.push(new Date(d.getFullYear(), d.getMonth() - i, 1)); }
  return arr;
}
function drawFinanceEvolutionChart() {
  const months = lastNMonths(6);
  const labels = months.map((m) => m.toLocaleDateString("pt-BR", { month: "short" }));
  const values = months.map((m) => {
    const ym = m.toISOString().slice(0, 7);
    const txs = transactions.filter((t) => t.date.startsWith(ym));
    return txs.filter((t) => t.type === "receita").reduce((s, t) => s + t.amount, 0) - txs.filter((t) => t.type === "despesa").reduce((s, t) => s + t.amount, 0);
  });
  drawBars("chartFinance", labels, values);
}
function drawFinanceMonthlyChart() {
  const months = lastNMonths(6);
  const labels = months.map((m) => m.toLocaleDateString("pt-BR", { month: "short" }));
  const values = months.map((m) => {
    const ym = m.toISOString().slice(0, 7);
    return transactions.filter((t) => t.date.startsWith(ym) && t.type === "despesa").reduce((s, t) => s + t.amount, 0);
  });
  drawBars("chartFinanceMonthly", labels, values, "--accent", "--accent");
}
function drawHabitsEvolutionChart() {
  const labels = []; const values = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    labels.push(WEEK_DAYS[d.getDay()]);
    const total = habits.length || 1;
    const done = habits.filter((h) => h.completions && h.completions[iso]).length;
    values.push(Math.round((done / total) * 100));
  }
  drawLine("chartHabits", labels, values);
}
function drawLoadChart(logs) {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date)).slice(-8);
  if (!sorted.length) { const { ctx, w, h } = setupCanvas("chartLoad"); ctx.clearRect(0, 0, w, h); return; }
  const labels = sorted.map((l) => fmtDate(l.date).slice(0, 5));
  const values = sorted.map((l) => l.weight);
  drawLine("chartLoad", labels, values);
}

/* =====================================================================
   CONFIGURAÇÕES
   ===================================================================== */
function avatarMarkup(photo, fallbackLetter) {
  return photo
    ? `<img src="${esc(photo)}" alt="">`
    : esc((fallbackLetter || "U").toUpperCase());
}
function renderSettings() {
  document.getElementById("cfgName").value = profile.name || "";
  document.getElementById("avatarBigInner").innerHTML = avatarMarkup(profile.photo, (profile.name || "U")[0]);
  const dotsEl = document.getElementById("colorDots");
  dotsEl.innerHTML = Object.entries(ACCENTS).map(([key, hex]) =>
    `<div class="color-dot ${profile.accent === key ? "active" : ""}" style="background:${hex};" onclick="window.setAccent('${key}')" role="button" tabindex="0" aria-label="Cor ${key}"></div>`
  ).join("");
  const at = document.getElementById("animToggle");
  at.classList.toggle("on", !!profile.animations);
}
async function saveProfile() {
  const name = document.getElementById("cfgName").value.trim() || "Usuário";
  await updateUserProfile(currentUid, { name });
  toast("Perfil atualizado", "success");
}
async function setAccent(key) { await updateUserProfile(currentUid, { accent: key }); }

/* ---------- Upload da foto de perfil (Firebase Storage) ---------- */
document.getElementById("avatarBig").addEventListener("click", () => {
  document.getElementById("avatarFileInput").click();
});
document.getElementById("avatarFileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // permite selecionar o mesmo arquivo novamente depois
  if (!file) return;
  const avatarBig = document.getElementById("avatarBig");
  const inner = document.getElementById("avatarBigInner");
  const previousHTML = inner.innerHTML;

  // Pré-visualização imediata (otimista), antes mesmo do upload terminar
  const previewUrl = URL.createObjectURL(file);
  inner.innerHTML = `<img src="${previewUrl}" alt="">`;
  avatarBig.classList.add("uploading");

  try {
    const finalUrl = await uploadProfilePhoto(currentUid, file);
    await updateUserProfile(currentUid, { photo: finalUrl });
    toast("Foto de perfil atualizada", "success");
    // renderAll() (disparado pelo listener do Firestore) já vai trocar a
    // pré-visualização pela URL definitiva em todo o sistema (sidebar e configurações).
  } catch (err) {
    inner.innerHTML = previousHTML;
    toast(err instanceof PhotoValidationError ? err.message : "Não foi possível enviar a imagem", "danger");
  } finally {
    avatarBig.classList.remove("uploading");
    URL.revokeObjectURL(previewUrl);
  }
});
function applyAccent() {
  const hex = ACCENTS[profile.accent] || ACCENTS.gold;
  document.documentElement.style.setProperty("--accent", hex);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty("--accent-rgb", `${r},${g},${b}`);
}
async function toggleAnim() { await updateUserProfile(currentUid, { animations: !profile.animations }); }

function exportData() {
  const backup = { profile, transactions, reserves, bills, habits, notes, workouts: workoutLogs };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `vigilante-backup-${todayISO()}.json`; a.click();
  URL.revokeObjectURL(url);
  toast("Dados exportados", "success");
}

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      const jobs = [];
      if (imported.profile) jobs.push(updateUserProfile(currentUid, imported.profile));
      ["transactions", "reserves", "bills", "habits", "notes"].forEach((key) => {
        (imported[key] || []).forEach((item) => {
          const { id, ...rest } = item;
          jobs.push(addItem(currentUid, key, rest));
        });
      });
      (imported.workouts || []).forEach((item) => {
        const { id, ...rest } = item;
        jobs.push(addItem(currentUid, "workouts", rest));
      });
      await Promise.all(jobs);
      toast("Dados importados com sucesso", "success");
    } catch (err) {
      toast("Arquivo inválido", "danger");
    }
  };
  reader.readAsText(file);
});

async function clearData() {
  if (!confirm("Isso apagará todos os seus dados permanentemente. Deseja continuar?")) return;
  const jobs = [];
  ["transactions", "reserves", "bills", "habits", "notes", "workouts"].forEach((key) => {
    const arr = { transactions, reserves, bills, habits, notes, workouts: workoutLogs }[key];
    arr.forEach((item) => jobs.push(deleteItem(currentUid, key, item.id)));
  });
  jobs.push(updateUserProfile(currentUid, { name: profile.name, photo: "", accent: "gold", animations: true }));
  await Promise.all(jobs);
  toast("Dados limpos");
}

/* =====================================================================
   RENDER GERAL
   ===================================================================== */
function renderAll() {
  document.getElementById("sideName").textContent = profile.name || "Usuário";
  document.getElementById("sideAvatar").innerHTML = profile.photo
    ? `<img src="${esc(profile.photo)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="">`
    : esc(((profile.name || "U")[0] || "U").toUpperCase());

  const activeView = document.querySelector(".view.active");
  if (!activeView) return;
  const active = activeView.id;
  if (active === "view-dashboard") renderDashboard();
  if (active === "view-financeiro") renderFinance();
  if (active === "view-reserva") renderReserve();
  if (active === "view-contas") renderBills();
  if (active === "view-habitos") renderHabits();
  if (active === "view-notas") renderNotes();
  if (active === "view-treinos") renderWorkouts();
  if (active === "view-config") renderSettings();
}

window.addEventListener("resize", () => { clearTimeout(window._rz); window._rz = setTimeout(renderAll, 150); });

// Expõe as funções chamadas via onclick="" inline no HTML gerado dinamicamente.
Object.assign(window, {
  openTxModal, saveTx, deleteTx,
  openGoalModal, saveGoal, deleteGoal,
  openBillModal, saveBill, deleteBill, cycleBillStatus,
  openHabitModal, saveHabit, deleteHabit, toggleHabit,
  openNoteModal, saveNote, deleteNote, togglePin,
  openWorkoutModal, saveWorkout, deleteWorkout, setGroupFilter,
  saveProfile, setAccent, toggleAnim, exportData, clearData,
  closeModal
});

updateClock();
