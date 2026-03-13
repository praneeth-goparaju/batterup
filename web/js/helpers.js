import { state, DELIVERY_FEE } from './state.js';

let toastTimer;
export function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 2500);
}

export function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tmrStr = tomorrow.toISOString().split("T")[0];
  let prefix = "";
  if (dateStr === today) prefix = "Today \u00b7 ";
  else if (dateStr === tmrStr) prefix = "Tomorrow \u00b7 ";
  return prefix + d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function friendlyDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

export function orderTotal(order) {
  return order.items.reduce((s, i) => s + i.quantity * i.price, 0) + (order.needs_delivery ? DELIVERY_FEE : 0);
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ESC_MAP[c]);
}

export function parseNum(val) {
  return parseFloat(String(val).replace(",", "."));
}

export function fmtQty(q) {
  return q % 1 === 0 ? q : q.toFixed(2);
}

export function buildRawMaterialsByProduct(orders, products) {
  const today = new Date().toISOString().split("T")[0];
  const productByName = new Map(products.map(p => [p.name, p]));
  const rmByProduct = {};
  for (const o of orders) {
    if (o.delivery_date < today || o.delivered) continue;
    for (const item of o.items) {
      const product = productByName.get(item.name);
      if (!product?.raw_materials) continue;
      if (!rmByProduct[item.name]) rmByProduct[item.name] = { totalQty: 0, unit: item.unit, materials: {} };
      rmByProduct[item.name].totalQty += item.quantity;
      for (const rm of product.raw_materials) {
        const key = `${rm.name}||${rm.unit}`;
        if (!rmByProduct[item.name].materials[key]) rmByProduct[item.name].materials[key] = { name: rm.name, unit: rm.unit, qty: 0 };
        rmByProduct[item.name].materials[key].qty += rm.quantity * item.quantity;
      }
    }
  }
  return rmByProduct;
}

export function openModal(id) {
  const el = document.getElementById(id);
  el.style.display = "block";
  requestAnimationFrame(() => el.classList.add("visible"));
}

export function closeModal(id) {
  const el = document.getElementById(id);
  el.classList.remove("visible");
  setTimeout(() => el.style.display = "none", 200);
}

// Expose to window for onclick handlers in HTML
window.openModal = openModal;
window.closeModal = closeModal;
