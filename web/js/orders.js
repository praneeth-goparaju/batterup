import { state, db, auth, ICON_EDIT, ICON_DELETE, collection, doc, addDoc, getDocs, updateDoc, deleteDoc, query, orderBy, where, serverTimestamp } from './state.js';
import { esc, showToast, formatDate, orderTotal, getDeliveryFee, shortName, parseNum, openModal, closeModal } from './helpers.js';
import { buildProductOptions } from './products.js';

let itemCounter = 0;
let editItemCounter = 0;

// Loads only recent orders (last 60 days) — fast for initial load, orders tab, tools tab
export async function loadOrders() {
  const list = document.getElementById("orders-list");
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    const q = query(collection(db, "orders"), where("delivery_date", ">=", cutoffStr), orderBy("delivery_date", "asc"));
    const snap = await getDocs(q);
    state.allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.fullOrdersLoaded = false;
    renderOrdersList();
  } catch (e) {
    list.innerHTML = '<div class="empty-state"><p style="color:var(--red);">Failed to load orders.</p></div>';
    console.error(e);
  }
}

// Loads all orders — used by reports & customers tabs that need full history
export async function loadFullOrders() {
  if (state.fullOrdersLoaded) return;
  try {
    const q = query(collection(db, "orders"), orderBy("delivery_date", "asc"));
    const snap = await getDocs(q);
    state.allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.fullOrdersLoaded = true;
  } catch (e) {
    console.error("Failed to load full orders:", e);
  }
}

export function renderOrdersList() {
  const list = document.getElementById("orders-list");
  const searchTerm = (document.getElementById("order-search")?.value || "").toLowerCase();
  const today = new Date().toISOString().split("T")[0];
  let upcoming = state.allOrders.filter(d => d.delivery_date >= today && !d.is_home);
  if (searchTerm) upcoming = upcoming.filter(d => d.customer_name.toLowerCase().includes(searchTerm));

  if (upcoming.length === 0) {
    list.innerHTML = searchTerm
      ? '<div class="empty-state"><p>No orders matching your search.</p></div>'
      : '<div class="empty-state"><div class="icon">&#x1f4cb;</div><p>No upcoming orders.<br>Create one from the New tab.</p></div>';
    return;
  }

  const grouped = {};
  for (const d of upcoming) {
    if (!grouped[d.delivery_date]) grouped[d.delivery_date] = [];
    grouped[d.delivery_date].push(d);
  }

  let html = "";
  for (const [date, orders] of Object.entries(grouped)) {
    const dateTotal = orders.reduce((s, o) => s + orderTotal(o), 0);
    html += `<div class="date-group"><div class="date-header">${formatDate(date)} <span class="order-count">${orders.length} order${orders.length > 1 ? "s" : ""} \u00b7 &euro;${dateTotal.toFixed(2)}</span></div>`;
    for (const d of orders) {
      const total = orderTotal(d);
      const itemsStr = d.items.map(i => `${i.quantity} ${i.unit} ${esc(i.name)}`).join(", ");
      const dFee = getDeliveryFee(d);
      const deliveryStr = dFee > 0 ? ` + &#x1f69a; &euro;${dFee.toFixed(2)}` : "";
      const paidClass = d.paid ? "paid" : "unpaid";
      const badgeClass = d.paid ? "yes" : "no";
      const badgeText = d.paid ? "PAID" : "UNPAID";
      const toggleBtn = d.paid
        ? `<button class="btn-unpaid" onclick="togglePaid('${d.id}', false)">Unpaid</button>`
        : `<button class="btn-paid" onclick="togglePaid('${d.id}', true)">Paid</button>`;
      const deliveredBtn = d.delivered
        ? `<button class="btn-undelivered" onclick="toggleDelivered('${d.id}', false)">Undo</button>`
        : `<button class="btn-delivered" onclick="toggleDelivered('${d.id}', true)">Delivered</button>`;
      const deliveredBadge = d.delivered ? ' <span class="paid-badge yes">DELIVERED</span>' : "";
      html += `<div class="card ${paidClass}" style="display:flex;align-items:stretch;">
        <div style="flex:1;">
          <div class="meta"><span>${esc(shortName(d.customer_name))}</span> <span class="paid-badge ${badgeClass}">${badgeText}</span>${deliveredBadge}</div>
          <div class="items-list">${itemsStr}${deliveryStr}</div>
          <div class="order-total">Total: &euro;${total.toFixed(2)}</div>
          ${d.notes ? `<div style="font-size:0.8rem;color:var(--gray);margin-top:4px;font-style:italic;">${esc(d.notes)}</div>` : ""}
          <div class="card-actions">
            ${toggleBtn}
            ${deliveredBtn}
          </div>
        </div>
        <div class="card-btns" style="justify-content:center;">
          <a class="icon-btn" onclick="openEditModal('${d.id}')">${ICON_EDIT}</a>
          <a class="icon-btn del" onclick="deleteOrder('${d.id}')">${ICON_DELETE}</a>
        </div>
      </div>`;
    }
    html += "</div>";
  }
  list.innerHTML = html;
}

window.filterOrders = () => renderOrdersList();

window.togglePaid = async (id, paid) => {
  try {
    await updateDoc(doc(db, "orders", id), { paid });
    const o = state.allOrders.find(x => x.id === id);
    if (o) o.paid = paid;
    renderOrdersList();
    showToast(paid ? "Marked as paid" : "Marked as unpaid");
  } catch (_e) { showToast("Failed to update", "error"); }
};

window.toggleDelivered = async (id, delivered) => {
  try {
    await updateDoc(doc(db, "orders", id), { delivered });
    const o = state.allOrders.find(x => x.id === id);
    if (o) o.delivered = delivered;
    renderOrdersList();
    showToast(delivered ? "Marked as delivered" : "Marked as undelivered");
  } catch (_e) { showToast("Failed to update", "error"); }
};

window.deleteOrder = async (id) => {
  if (!confirm("Delete this order?")) return;
  try {
    await deleteDoc(doc(db, "orders", id));
    state.allOrders = state.allOrders.filter(o => o.id !== id);
    renderOrdersList();
    showToast("Order deleted");
  } catch (_e) { showToast("Failed to delete", "error"); }
};

// ========== ITEM ROWS + RUNNING TOTAL ==========
function calcRunningTotal(containerId, qtyPrefix, pricePrefix, ltPrefix, feeId, totalId) {
  let total = 0;
  for (const row of document.querySelectorAll(`#${containerId} .item-row`)) {
    const id = row.id.split("-")[1];
    const qty = parseNum(document.getElementById(`${qtyPrefix}${id}`)?.value) || 0;
    const price = parseNum(document.getElementById(`${pricePrefix}${id}`)?.value) || 0;
    const line = qty * price;
    total += line;
    const ltEl = document.getElementById(`${ltPrefix}${id}`);
    if (ltEl) ltEl.textContent = line > 0 ? `\u20AC${line.toFixed(2)}` : "";
  }
  total += parseFloat(document.getElementById(feeId)?.value) || 0;
  const el = document.getElementById(totalId);
  if (total > 0) { el.style.display = "block"; el.textContent = `Total: \u20AC${total.toFixed(2)}`; }
  else { el.style.display = "none"; }
  return total;
}

function updateRunningTotal() {
  if (calcRunningTotal("items-container", "qty-", "price-", "lt-", "delivery-fee", "running-total") > 0) state.formDirty = true;
}

window.addItemRow = () => {
  const id = itemCounter++;
  const div = document.createElement("div");
  div.className = "item-row"; div.id = `item-${id}`;
  div.innerHTML = `
    <button class="btn-remove" onclick="removeItem(${id})">&times;</button>
    <select onchange="onProductChange(${id}, this)" style="padding-right:36px;">${buildProductOptions()}</select>
    <div class="row" style="margin-top:8px;">
      <div><input type="text" id="qty-${id}" placeholder="Qty" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" oninput="updateRunningTotal()"></div>
      <div class="small"><select id="unit-${id}"><option value="kg">kg</option><option value="grams">grams</option><option value="pieces">pieces</option><option value="liters">liters</option></select></div>
      <div><input type="text" id="price-${id}" placeholder="Price" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" oninput="updateRunningTotal()"></div>
    </div>
    <div class="line-total" id="lt-${id}"></div>`;
  document.getElementById("items-container").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "center" });
};
window.updateRunningTotal = updateRunningTotal;

function updateEditRunningTotal() {
  calcRunningTotal("edit-items-container", "eq-", "ep-", "elt-", "edit-delivery-fee", "edit-running-total");
}
window.updateEditRunningTotal = updateEditRunningTotal;

window.toggleDeliveryFee = (btn, form) => {
  const group = btn.parentElement;
  const hiddenId = form === "edit" ? "edit-delivery-fee" : "delivery-fee";
  const fee = btn.dataset.fee;
  const wasActive = btn.classList.contains("active");
  group.querySelectorAll(".delivery-toggle").forEach(b => b.classList.remove("active"));
  if (wasActive) {
    document.getElementById(hiddenId).value = "0";
  } else {
    btn.classList.add("active");
    document.getElementById(hiddenId).value = fee;
  }
  if (form === "new") updateRunningTotal();
  if (form === "edit") updateEditRunningTotal();
};

window.onProductChange = (id, sel) => {
  const opt = sel.options[sel.selectedIndex];
  if (opt.dataset.price) { document.getElementById(`price-${id}`).value = opt.dataset.price; updateRunningTotal(); }
  if (opt.dataset.unit) document.getElementById(`unit-${id}`).value = opt.dataset.unit;
  state.formDirty = true;
};

window.removeItem = (id) => { document.getElementById(`item-${id}`)?.remove(); updateRunningTotal(); };

// ========== SUBMIT NEW ORDER ==========
window.submitOrder = async () => {
  const customer = document.getElementById("customer").value.trim();
  const deliveryDate = document.getElementById("delivery-date").value;
  const notes = document.getElementById("notes").value.trim();
  if (!customer) { showToast("Enter a customer name", "error"); return; }
  if (!deliveryDate) { showToast("Select a delivery date", "error"); return; }

  const rows = document.querySelectorAll("#items-container .item-row");
  const items = [];
  for (const row of rows) {
    const sel = row.querySelector("select");
    if (!sel.value) continue;
    const name = sel.options[sel.selectedIndex].textContent;
    const id = row.id.split("-")[1];
    const qty = parseNum(document.getElementById(`qty-${id}`).value);
    const unit = document.getElementById(`unit-${id}`).value;
    const price = parseNum(document.getElementById(`price-${id}`).value);
    if (!qty || qty <= 0) { showToast(`Enter quantity for ${name}`, "error"); return; }
    if (isNaN(price) || price < 0) { showToast(`Enter price for ${name}`, "error"); return; }
    items.push({ name, quantity: qty, unit, price });
  }
  if (items.length === 0) { showToast("Add at least one item", "error"); return; }

  const btn = document.getElementById("submit-btn");
  btn.disabled = true; btn.textContent = "Saving...";
  const deliveryFee = parseFloat(document.getElementById("delivery-fee").value) || 0;
  try {
    const docRef = await addDoc(collection(db, "orders"), {
      items, customer_name: customer, delivery_date: deliveryDate, notes,
      delivery_fee: deliveryFee, needs_delivery: deliveryFee > 0, delivered: false,
      paid: false, created_by: auth.currentUser.email, timestamp: serverTimestamp()
    });
    state.allOrders.push({
      id: docRef.id, items, customer_name: customer, delivery_date: deliveryDate, notes,
      delivery_fee: deliveryFee, needs_delivery: deliveryFee > 0, delivered: false, paid: false, created_by: auth.currentUser.email
    });
    state.fullOrdersLoaded = false;
    document.getElementById("customer").value = "";
    document.getElementById("notes").value = "";
    document.getElementById("delivery-fee").value = "0";
    document.querySelectorAll("#tab-new .delivery-toggle").forEach(b => b.classList.remove("active"));
    document.getElementById("items-container").innerHTML = "";
    document.getElementById("running-total").style.display = "none";
    state.formDirty = false;
    itemCounter = 0; window.addItemRow(); setDefaultDate();
    showToast("Order submitted!");
  } catch (_e) { showToast("Failed to submit order", "error"); }
  finally { btn.disabled = false; btn.textContent = "Save"; }
};

// ========== EDIT ORDER MODAL ==========
window.openEditModal = (id) => {
  state.editingOrderId = id; editItemCounter = 0;
  const d = state.allOrders.find(x => x.id === id);
  if (!d) { showToast("Order not found", "error"); return; }
  document.getElementById("edit-customer").value = d.customer_name;
  document.getElementById("edit-delivery-date").value = d.delivery_date;
  const editFee = getDeliveryFee(d);
  document.getElementById("edit-delivery-fee").value = String(editFee);
  document.querySelectorAll("#edit-modal .delivery-toggle").forEach(b => {
    b.classList.toggle("active", parseInt(b.dataset.fee) === editFee);
  });
  document.getElementById("edit-notes").value = d.notes || "";
  document.getElementById("edit-items-container").innerHTML = "";
  for (const item of d.items) window.addEditItemRow(item);
  updateEditRunningTotal();
  openModal("edit-modal");
};

window.addEditItemRow = (item) => {
  const id = editItemCounter++;
  const div = document.createElement("div");
  div.className = "item-row"; div.id = `eitem-${id}`;
  div.innerHTML = `
    <button class="btn-remove" onclick="this.closest('.item-row').remove(); updateEditRunningTotal()">&times;</button>
    <select id="esel-${id}" onchange="onEditProductChange(${id}, this)" style="padding-right:36px;">${buildProductOptions()}</select>
    <div class="row" style="margin-top:8px;">
      <div><input type="text" id="eq-${id}" placeholder="Qty" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" oninput="updateEditRunningTotal()"></div>
      <div class="small"><select id="eu-${id}"><option value="kg">kg</option><option value="grams">grams</option><option value="pieces">pieces</option><option value="liters">liters</option></select></div>
      <div><input type="text" id="ep-${id}" placeholder="Price" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*" oninput="updateEditRunningTotal()"></div>
    </div>
    <div class="line-total" id="elt-${id}"></div>`;
  document.getElementById("edit-items-container").appendChild(div);
  if (item && typeof item === "object") {
    const sel = document.getElementById(`esel-${id}`);
    for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].textContent === item.name) { sel.selectedIndex = i; break; } }
    document.getElementById(`eq-${id}`).value = item.quantity;
    document.getElementById(`eu-${id}`).value = item.unit;
    document.getElementById(`ep-${id}`).value = item.price;
  }
  if (!item) div.scrollIntoView({ behavior: "smooth", block: "center" });
};

window.onEditProductChange = (id, sel) => {
  const opt = sel.options[sel.selectedIndex];
  if (opt.dataset.price) { document.getElementById(`ep-${id}`).value = opt.dataset.price; updateEditRunningTotal(); }
  if (opt.dataset.unit) document.getElementById(`eu-${id}`).value = opt.dataset.unit;
};

window.saveEditOrder = async () => {
  const customer = document.getElementById("edit-customer").value.trim();
  const deliveryDate = document.getElementById("edit-delivery-date").value;
  const notes = document.getElementById("edit-notes").value.trim();
  if (!customer) { showToast("Enter a customer name", "error"); return; }
  if (!deliveryDate) { showToast("Select a delivery date", "error"); return; }
  const rows = document.querySelectorAll("#edit-items-container .item-row");
  const items = [];
  for (const row of rows) {
    const sel = row.querySelector("select");
    if (!sel.value) continue;
    const name = sel.options[sel.selectedIndex].textContent;
    const id = row.id.split("-")[1];
    const qty = parseNum(document.getElementById(`eq-${id}`).value);
    const unit = document.getElementById(`eu-${id}`).value;
    const price = parseNum(document.getElementById(`ep-${id}`).value);
    if (!qty || qty <= 0) { showToast(`Enter quantity for ${name}`, "error"); return; }
    if (isNaN(price) || price < 0) { showToast(`Enter price for ${name}`, "error"); return; }
    items.push({ name, quantity: qty, unit, price });
  }
  if (items.length === 0) { showToast("Add at least one item", "error"); return; }
  const btn = document.getElementById("save-edit-btn");
  btn.disabled = true; btn.textContent = "Saving...";
  try {
    const editDeliveryFee = parseFloat(document.getElementById("edit-delivery-fee").value) || 0;
    await updateDoc(doc(db, "orders", state.editingOrderId), { items, customer_name: customer, delivery_date: deliveryDate, notes, delivery_fee: editDeliveryFee, needs_delivery: editDeliveryFee > 0 });
    const idx = state.allOrders.findIndex(x => x.id === state.editingOrderId);
    if (idx >= 0) Object.assign(state.allOrders[idx], { items, customer_name: customer, delivery_date: deliveryDate, notes, delivery_fee: editDeliveryFee, needs_delivery: editDeliveryFee > 0 });
    state.fullOrdersLoaded = false;
    closeModal("edit-modal"); renderOrdersList(); showToast("Order updated");
  } catch (_e) { showToast("Failed to save", "error"); }
  finally { btn.disabled = false; btn.textContent = "Save Changes"; }
};

// ========== DEFAULT DATE ==========
export function setDefaultDate() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  const nextSat = new Date(now); nextSat.setDate(now.getDate() + daysUntilSat);
  document.getElementById("delivery-date").value = nextSat.toISOString().split("T")[0];
}
