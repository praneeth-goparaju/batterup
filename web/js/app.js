import { auth, GoogleAuthProvider, signInWithPopup, fbSignOut, onAuthStateChanged, state } from './state.js';
import { showToast } from './helpers.js';
import { loadProducts, renderProducts } from './products.js';
import { loadCustomers, renderCustomers } from './customers.js';
import { loadOrders, loadFullOrders, renderOrdersList, setDefaultDate } from './orders.js';
import { renderReports } from './reports.js';
import { loadToolsTab, initToolsDateListener } from './tools.js';

// ========== AUTH ==========
onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("tab-bar").style.display = "flex";
    const firstName = (user.displayName || user.email).split(' ')[0];
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    document.getElementById("user-email").textContent = `${greeting}, ${firstName}`;
    loadAll();
  } else {
    document.getElementById("auth-section").style.display = "block";
    document.getElementById("app").style.display = "none";
    document.getElementById("tab-bar").style.display = "none";
  }
});

window.signIn = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { if (e.code !== "auth/popup-closed-by-user") showToast("Sign-in failed", "error"); }
};
window.signOut = async () => { await fbSignOut(auth); };

async function loadAll() { await Promise.all([loadProducts(), loadCustomers(), loadOrders()]); }

// ========== TABS ==========
window.switchTab = (tab, btn) => {
  document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  document.querySelectorAll(".tab-bar button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  if (tab === "orders") renderOrdersList();
  if (tab === "products") renderProducts();
  if (tab === "customers") { loadFullOrders().then(() => renderCustomers()); }
  if (tab === "reports") { loadFullOrders().then(() => renderReports()); }
  if (tab === "tools") loadToolsTab();
};

// ========== INIT ==========
setDefaultDate();
initToolsDateListener();

// ========== UNSAVED FORM WARNING ==========
window.addEventListener("beforeunload", (e) => {
  if (state.formDirty) { e.preventDefault(); e.returnValue = ""; }
});
