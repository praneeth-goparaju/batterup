import { state, db, ICON_EDIT, ICON_DELETE, collection, doc, addDoc, getDocs, updateDoc, deleteDoc } from './state.js';
import { esc, showToast, formatDate, orderTotal, openModal, closeModal } from './helpers.js';

export async function loadCustomers() {
  try {
    const snap = await getDocs(collection(db, "customers"));
    state.customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.customers.sort((a, b) => a.name.localeCompare(b.name));
    renderCustomers();
  } catch (e) { console.error("Failed to load customers:", e); }
}

// Searchable customer dropdown
window.onCustomerInput = () => {
  const val = document.getElementById("customer").value.toLowerCase();
  const dd = document.getElementById("customer-dropdown");
  state.formDirty = true;
  if (!val) { dd.style.display = "none"; return; }
  const matches = state.customers.filter(c => c.name.toLowerCase().includes(val));
  if (matches.length === 0) { dd.style.display = "none"; return; }
  dd.style.display = "block";
  dd.innerHTML = matches.map(c => {
    const sub = [c.phone, c.address].filter(Boolean).join(" \u00b7 ");
    return `<div class="dropdown-item" onclick="pickCustomer('${esc(c.name)}')">
      ${esc(c.name)}${sub ? `<div class="sub">${esc(sub)}</div>` : ""}
    </div>`;
  }).join("");
};

window.pickCustomer = (name) => {
  document.getElementById("customer").value = name;
  document.getElementById("customer-dropdown").style.display = "none";
  state.formDirty = true;
};

// Close dropdown when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest("#customer") && !e.target.closest("#customer-dropdown")) {
    document.getElementById("customer-dropdown").style.display = "none";
  }
});

export function renderCustomers() {
  const list = document.getElementById("customers-list");
  const searchTerm = (document.getElementById("customer-search")?.value || "").toLowerCase();
  let filtered = state.customers;
  if (searchTerm) filtered = state.customers.filter(c => c.name.toLowerCase().includes(searchTerm) || (c.phone && c.phone.includes(searchTerm)));
  if (state.customers.length === 0) { list.innerHTML = '<div class="empty-state"><div class="icon">&#x1f465;</div><p>No customers yet.<br>Add your first customer below.</p></div>'; return; }
  if (filtered.length === 0) { list.innerHTML = '<div class="empty-state"><p>No customers matching your search.</p></div>'; return; }
  const ordersByCustomer = new Map();
  for (const o of state.allOrders) {
    if (!ordersByCustomer.has(o.customer_name)) ordersByCustomer.set(o.customer_name, []);
    ordersByCustomer.get(o.customer_name).push(o);
  }
  list.innerHTML = '<div class="grid-2">' + filtered.map(c => {
    const custOrders = ordersByCustomer.get(c.name) || [];
    const unpaid = custOrders.filter(o => !o.paid).reduce((s, o) => s + orderTotal(o), 0);
    const balClass = unpaid > 0 ? "has-debt" : "clear";
    const balText = unpaid > 0 ? `&euro;${unpaid.toFixed(2)} unpaid` : "All paid";
    const orderCount = custOrders.length;
    const lastOrder = custOrders.sort((a, b) => b.delivery_date.localeCompare(a.delivery_date))[0];
    const lastDateStr = lastOrder ? formatDate(lastOrder.delivery_date) : "";
    const phoneLine = c.phone ? `<a class="cust-phone" href="tel:${esc(c.phone)}" onclick="event.stopPropagation();">${esc(c.phone)}</a>` : "";
    const statsLine = `<span class="cust-balance ${balClass}">${balText}</span>` +
      (orderCount > 0 ? ` \u00b7 ${orderCount} order${orderCount !== 1 ? "s" : ""}` : "") +
      (lastDateStr ? ` \u00b7 Last: ${lastDateStr}` : "");
    return `<div class="card customer-card">
      <div class="cust-info" onclick="openCustDetail('${c.id}')" style="cursor:pointer;">
        <div class="name">${esc(c.name)}</div>
        ${phoneLine}
        <div class="cust-stats">${statsLine}</div>
      </div>
      <div class="card-btns">
        <a class="icon-btn" onclick="openEditCustModal('${c.id}')">${ICON_EDIT}</a>
        <a class="icon-btn del" onclick="deleteCustomer('${c.id}')">${ICON_DELETE}</a>
      </div>
    </div>`;
  }).join("") + '</div>';
}

window.addCustomer = async () => {
  const name = document.getElementById("new-cust-name").value.trim();
  const phone = document.getElementById("new-cust-phone").value.trim();
  const address = document.getElementById("new-cust-address").value.trim();
  const notes = document.getElementById("new-cust-notes").value.trim();
  if (!name) { showToast("Enter a customer name", "error"); return; }
  try {
    await addDoc(collection(db, "customers"), { name, phone, address, notes });
    document.getElementById("new-cust-name").value = "";
    document.getElementById("new-cust-phone").value = "";
    document.getElementById("new-cust-address").value = "";
    document.getElementById("new-cust-notes").value = "";
    closeModal("add-cust-modal");
    await loadCustomers();
    showToast("Customer added");
  } catch (e) { showToast("Failed to add customer", "error"); }
};

window.openEditCustModal = (id) => {
  state.editingCustomerId = id;
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  document.getElementById("edit-cust-name").value = c.name;
  document.getElementById("edit-cust-phone").value = c.phone || "";
  document.getElementById("edit-cust-address").value = c.address || "";
  document.getElementById("edit-cust-notes").value = c.notes || "";
  openModal("edit-cust-modal");
};

window.saveEditCustomer = async () => {
  const name = document.getElementById("edit-cust-name").value.trim();
  const phone = document.getElementById("edit-cust-phone").value.trim();
  const address = document.getElementById("edit-cust-address").value.trim();
  const notes = document.getElementById("edit-cust-notes").value.trim();
  if (!name) { showToast("Enter a customer name", "error"); return; }
  try { await updateDoc(doc(db, "customers", state.editingCustomerId), { name, phone, address, notes }); closeModal("edit-cust-modal"); await loadCustomers(); showToast("Customer updated"); }
  catch (e) { showToast("Failed to save", "error"); }
};

window.deleteCustomer = async (id) => {
  const c = state.customers.find(x => x.id === id);
  if (!confirm(`Delete "${c?.name}"?`)) return;
  try { await deleteDoc(doc(db, "customers", id)); await loadCustomers(); showToast("Customer deleted"); }
  catch (e) { showToast("Failed to delete", "error"); }
};

window.openCustDetail = (id) => {
  const c = state.customers.find(x => x.id === id);
  if (!c) return;
  document.getElementById("cust-detail-name").textContent = c.name;
  const info = [c.phone, c.address, c.notes].filter(Boolean);
  document.getElementById("cust-detail-info").innerHTML = info.map(i => esc(i)).join("<br>") || "No details";
  const custOrders = state.allOrders.filter(o => o.customer_name === c.name).sort((a, b) => b.delivery_date.localeCompare(a.delivery_date));
  const unpaid = custOrders.filter(o => !o.paid).reduce((s, o) => s + orderTotal(o), 0);
  const totalSpent = custOrders.reduce((s, o) => s + orderTotal(o), 0);
  document.getElementById("cust-detail-balance").innerHTML = `
    <div style="display:flex;gap:10px;">
      <div class="report-card" style="flex:1;margin:0;"><div class="stat-big danger" style="font-size:1.3rem;">&euro;${unpaid.toFixed(2)}</div><div class="stat-label">Unpaid</div></div>
      <div class="report-card" style="flex:1;margin:0;"><div class="stat-big" style="font-size:1.3rem;color:#333;">&euro;${totalSpent.toFixed(2)}</div><div class="stat-label">Total</div></div>
    </div>`;
  if (custOrders.length === 0) {
    document.getElementById("cust-detail-orders").innerHTML = '<div class="empty-state" style="padding:24px;"><p>No orders yet.</p></div>';
  } else {
    document.getElementById("cust-detail-orders").innerHTML = custOrders.slice(0, 20).map(o => {
      const badge = o.paid ? '<span class="paid-badge yes">PAID</span>' : '<span class="paid-badge no">UNPAID</span>';
      const items = o.items.map(i => `${i.quantity} ${i.unit} ${i.name}`).join(", ");
      return `<div class="card" style="padding:10px;"><div class="meta">${formatDate(o.delivery_date)} ${badge}</div><div style="font-size:0.85rem;">${items} — <b>&euro;${orderTotal(o).toFixed(2)}</b></div></div>`;
    }).join("");
  }
  openModal("cust-detail-modal");
};

window.filterCustomers = () => renderCustomers();
