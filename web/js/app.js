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
const TAB_ORDER = ["new", "orders", "customers", "products", "reports", "tools"];

function activateTab(tab) {
  if (!TAB_ORDER.includes(tab)) tab = "new";
  document.querySelectorAll(".tab-page").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.add("active");
  const buttons = document.querySelectorAll(".tab-bar button");
  buttons.forEach(b => b.classList.remove("active"));
  const idx = TAB_ORDER.indexOf(tab);
  if (buttons[idx]) buttons[idx].classList.add("active");
  if (tab === "orders") renderOrdersList();
  if (tab === "products") renderProducts();
  if (tab === "customers") { loadFullOrders().then(() => renderCustomers()); }
  if (tab === "reports") { loadFullOrders().then(() => renderReports()); }
  if (tab === "tools") loadToolsTab();
}

window.switchTab = (tab, btn) => {
  if (location.hash === `#${tab}`) {
    if (tab === "tools") loadToolsTab();
    return;
  }
  history.pushState(null, "", `#${tab}`);
  activateTab(tab);
};

window.addEventListener("popstate", () => {
  const tab = location.hash.replace("#", "") || "new";
  activateTab(tab);
});

// Restore tab from URL hash on load
function restoreTabFromHash() {
  const tab = location.hash.replace("#", "");
  if (tab && TAB_ORDER.includes(tab)) activateTab(tab);
}

// ========== INIT ==========
setDefaultDate();
initToolsDateListener();
restoreTabFromHash();

// ========== AUTO-REFRESH ON FOREGROUND ==========
let lastRefresh = Date.now();
const REFRESH_INTERVAL = 30_000; // 30 seconds minimum between refreshes

async function refreshIfStale() {
  if (!auth.currentUser) return;
  if (Date.now() - lastRefresh < REFRESH_INTERVAL) return;
  lastRefresh = Date.now();
  state.fullOrdersLoaded = false;
  await loadAll();
}

// Check for new deploys and reload if needed
let appVersion = null;
async function checkForUpdate() {
  try {
    const res = await fetch('/version.json?t=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    if (appVersion === null) { appVersion = data.v; return; }
    if (data.v !== appVersion) { location.reload(); }
  } catch (_) {}
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { refreshIfStale(); checkForUpdate(); }
});
checkForUpdate();

// ========== PULL TO REFRESH ==========
let pullStartY = 0;
let pulling = false;
const PULL_THRESHOLD = 80;
const indicator = document.createElement("div");
indicator.id = "pull-indicator";
indicator.textContent = "Refreshing...";
document.body.prepend(indicator);

document.addEventListener("touchstart", (e) => {
  if (window.scrollY === 0 && !document.querySelector(".modal-overlay.visible")) {
    pullStartY = e.touches[0].clientY;
    pulling = true;
  }
}, { passive: true });

document.addEventListener("touchmove", (e) => {
  if (!pulling) return;
  const dy = e.touches[0].clientY - pullStartY;
  if (dy > 0 && dy < 150) {
    indicator.style.transform = `translateY(${Math.min(dy - 20, PULL_THRESHOLD)}px)`;
    indicator.style.opacity = Math.min(dy / PULL_THRESHOLD, 1);
  }
}, { passive: true });

document.addEventListener("touchend", async () => {
  if (!pulling) return;
  pulling = false;
  const opacity = parseFloat(indicator.style.opacity) || 0;
  if (opacity >= 1 && auth.currentUser) {
    indicator.classList.add("active");
    state.fullOrdersLoaded = false;
    lastRefresh = Date.now();
    await loadAll();
    showToast("Refreshed");
  }
  indicator.classList.remove("active");
  indicator.style.transform = "";
  indicator.style.opacity = "0";
});

// ========== UNSAVED FORM WARNING ==========
window.addEventListener("beforeunload", (e) => {
  if (state.formDirty) { e.preventDefault(); e.returnValue = ""; }
});
