import { state, db, ICON_EDIT, ICON_DELETE, rmUnitOpts, collection, doc, addDoc, getDocs, updateDoc, deleteDoc } from './state.js';
import { esc, showToast, openModal, closeModal } from './helpers.js';

let newProdRMCounter = 0;
let editProdRMCounter = 0;

export async function loadProducts() {
  try {
    const snap = await getDocs(collection(db, "products"));
    state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.products.sort((a, b) => a.name.localeCompare(b.name));
    if (document.querySelectorAll("#items-container .item-row").length === 0) window.addItemRow();
    renderProducts();
  } catch (e) { console.error("Failed to load products:", e); }
}

export function renderProducts() {
  const list = document.getElementById("products-list");
  const searchTerm = (document.getElementById("product-search")?.value || "").toLowerCase();
  let filtered = state.products;
  if (searchTerm) filtered = state.products.filter(p => p.name.toLowerCase().includes(searchTerm));
  if (state.products.length === 0) { list.innerHTML = '<div class="empty-state"><div class="icon">&#x1f4e6;</div><p>No products yet.<br>Add your first product below.</p></div>'; return; }
  if (filtered.length === 0) { list.innerHTML = '<div class="empty-state"><p>No products matching your search.</p></div>'; return; }
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthOrdersByProduct = new Map();
  for (const o of state.allOrders) {
    if (!o.delivery_date?.startsWith(thisMonth)) continue;
    for (const i of o.items ?? []) monthOrdersByProduct.set(i.name, (monthOrdersByProduct.get(i.name) ?? 0) + 1);
  }
  list.innerHTML = '<div class="grid-2">' + filtered.map(p => {
    const minStr = p.min_quantity ? ` \u00b7 min ${p.min_quantity} ${p.min_unit || ""}` : "";
    const rmCount = p.raw_materials?.length || 0;
    const monthOrders = monthOrdersByProduct.get(p.name) || 0;
    const statsArr = [];
    if (rmCount > 0) statsArr.push(`${rmCount} raw material${rmCount !== 1 ? "s" : ""}`);
    if (monthOrders > 0) statsArr.push(`${monthOrders} order${monthOrders !== 1 ? "s" : ""} this month`);
    const statsLine = statsArr.length > 0 ? `<div style="font-size:0.78rem;color:#aaa;margin-top:3px;">${statsArr.join(" \u00b7 ")}</div>` : "";
    return `<div class="card product-card">
      <div class="product-info">
        <div class="name">${esc(p.name)}</div>
        <div class="detail">&euro;${p.default_price} / ${p.unit}${minStr}</div>
        ${statsLine}
      </div>
      <div class="card-btns">
        <a class="icon-btn" onclick="openEditProductModal('${p.id}')">${ICON_EDIT}</a>
        <a class="icon-btn del" onclick="deleteProduct('${p.id}')">${ICON_DELETE}</a>
      </div>
    </div>`;
  }).join("") + '</div>';
}

export function buildProductOptions() {
  return '<option value="">Select product</option>' +
    state.products.map(p => `<option value="${p.id}" data-price="${p.default_price}" data-unit="${p.unit}">${esc(p.name)}</option>`).join("");
}

function addRMRow(containerId, prefix, counter) {
  const id = counter;
  const div = document.createElement("div");
  div.className = "rm-row"; div.id = `${prefix}-${id}`;
  div.innerHTML = `
    <input class="rm-name" type="text" placeholder="Material name" id="${prefix}-name-${id}">
    <input class="rm-qty" type="text" placeholder="Qty" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" id="${prefix}-qty-${id}">
    <select class="rm-unit" id="${prefix}-unit-${id}">${rmUnitOpts}</select>
    <button class="rm-del" onclick="this.closest('.rm-row').remove()">&times;</button>`;
  document.getElementById(containerId).appendChild(div);
  return id;
}

function collectRMs(containerId, prefix) {
  const rows = document.querySelectorAll(`#${containerId} .rm-row`);
  const rms = [];
  for (const row of rows) {
    const id = row.id.split("-").pop();
    const name = document.getElementById(`${prefix}-name-${id}`)?.value.trim();
    const qty = parseFloat(document.getElementById(`${prefix}-qty-${id}`)?.value);
    const unit = document.getElementById(`${prefix}-unit-${id}`)?.value;
    if (!name || !qty || qty <= 0) continue;
    rms.push({ name, quantity: qty, unit });
  }
  return rms;
}

window.addNewProductRM = () => { newProdRMCounter = addRMRow("new-product-rm-container", "nrm", newProdRMCounter) + 1; };
window.addEditProductRM = () => { editProdRMCounter = addRMRow("edit-product-rm-container", "erm", editProdRMCounter) + 1; };

window.addProduct = async () => {
  const name = document.getElementById("new-product-name").value.trim();
  const price = parseFloat(document.getElementById("new-product-price").value);
  const unit = document.getElementById("new-product-unit").value;
  const minQty = parseFloat(document.getElementById("new-product-min-qty").value) || 0;
  const minUnit = document.getElementById("new-product-min-unit").value;
  if (!name) { showToast("Enter a product name", "error"); return; }
  if (isNaN(price) || price <= 0) { showToast("Enter a valid price", "error"); return; }
  const data = { name, default_price: price, unit, currency: "EUR" };
  if (minQty > 0) { data.min_quantity = minQty; data.min_unit = minUnit; }
  data.raw_materials = collectRMs("new-product-rm-container", "nrm");
  try {
    await addDoc(collection(db, "products"), data);
    document.getElementById("new-product-name").value = "";
    document.getElementById("new-product-price").value = "";
    document.getElementById("new-product-min-qty").value = "";
    document.getElementById("new-product-rm-container").innerHTML = "";
    newProdRMCounter = 0;
    closeModal("add-product-modal");
    await loadProducts();
    showToast("Product added");
  } catch (e) { showToast("Failed to add product", "error"); }
};

window.openEditProductModal = (id) => {
  state.editingProductId = id;
  editProdRMCounter = 0;
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  document.getElementById("edit-product-name").value = p.name;
  document.getElementById("edit-product-price").value = p.default_price;
  document.getElementById("edit-product-unit").value = p.unit;
  document.getElementById("edit-product-min-qty").value = p.min_quantity || "";
  document.getElementById("edit-product-min-unit").value = p.min_unit || "grams";
  document.getElementById("edit-product-rm-container").innerHTML = "";
  if (p.raw_materials) {
    for (const rm of p.raw_materials) {
      const rid = editProdRMCounter;
      addRMRow("edit-product-rm-container", "erm", editProdRMCounter);
      editProdRMCounter++;
      document.getElementById(`erm-name-${rid}`).value = rm.name;
      document.getElementById(`erm-qty-${rid}`).value = rm.quantity;
      document.getElementById(`erm-unit-${rid}`).value = rm.unit;
    }
  }
  openModal("edit-product-modal");
};

window.saveEditProduct = async () => {
  const name = document.getElementById("edit-product-name").value.trim();
  const price = parseFloat(document.getElementById("edit-product-price").value);
  const unit = document.getElementById("edit-product-unit").value;
  const minQty = parseFloat(document.getElementById("edit-product-min-qty").value) || 0;
  const minUnit = document.getElementById("edit-product-min-unit").value;
  if (!name) { showToast("Enter a product name", "error"); return; }
  if (isNaN(price) || price <= 0) { showToast("Enter a valid price", "error"); return; }
  const data = { name, default_price: price, unit, min_quantity: minQty > 0 ? minQty : 0, min_unit: minQty > 0 ? minUnit : "" };
  data.raw_materials = collectRMs("edit-product-rm-container", "erm");
  try { await updateDoc(doc(db, "products", state.editingProductId), data); closeModal("edit-product-modal"); await loadProducts(); showToast("Product updated"); }
  catch (e) { showToast("Failed to save", "error"); }
};

window.deleteProduct = async (id) => {
  const p = state.products.find(x => x.id === id);
  if (!confirm(`Delete "${p?.name}"?`)) return;
  try { await deleteDoc(doc(db, "products", id)); await loadProducts(); showToast("Product deleted"); }
  catch (e) { showToast("Failed to delete", "error"); }
};

window.filterProducts = () => renderProducts();
