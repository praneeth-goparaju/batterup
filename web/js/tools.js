import { state, db, auth, collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from './state.js';
import { esc, showToast, orderTotal, friendlyDate, fmtQty, shortName, buildRawMaterialsByProduct, aggregateMaterials, parseNum } from './helpers.js';
import { buildProductOptions } from './products.js';

function buildCustByName() {
  return new Map(state.customers.map(c => [c.name, c]));
}

// Tools tile navigation
window.openTool = (tool) => {
  document.getElementById("tools-hub").style.display = "none";
  document.querySelectorAll(".tool-detail").forEach(d => d.style.display = "none");
  document.getElementById(`tool-detail-${tool}`).style.display = "block";
  if (tool === "route") { loadSavedRoute(); updateNotifyButton(); }
  if (tool === "materials") renderToolsRawMaterials();
  if (tool === "reminders") renderToolsReminders();
  if (tool === "deliveryrun") renderDeliveryRun();
  if (tool === "homebatter") renderHomeBatter();
};

window.closeTool = () => {
  document.querySelectorAll(".tool-detail").forEach(d => d.style.display = "none");
  document.getElementById("tools-hub").style.display = "grid";
  updateTileSummaries();
};

function updateTileSummaries() {
  const today = new Date().toISOString().split("T")[0];
  const dateStr = document.getElementById("tools-date").value || today;
  const deliveries = state.allOrders.filter(o => o.delivery_date === dateStr && o.needs_delivery);

  // Route tile
  const routeTile = document.getElementById("tile-route-summary");
  if (deliveries.length > 0) {
    routeTile.textContent = `${deliveries.length} deliver${deliveries.length !== 1 ? "ies" : "y"} for this date`;
  } else {
    routeTile.textContent = "No deliveries";
  }

  // Delivery run tile
  const delivered = deliveries.filter(o => o.delivered).length;
  const drTile = document.getElementById("tile-deliveryrun-summary");
  if (deliveries.length > 0) {
    drTile.textContent = delivered === deliveries.length ? "All delivered!" : `${delivered}/${deliveries.length} delivered`;
  } else {
    drTile.textContent = "No deliveries";
  }

  // Materials tile — show as shopping list summary
  const rmByProduct = buildRawMaterialsByProduct(state.allOrders, state.products);
  const productCount = Object.keys(rmByProduct).length;
  const matTile = document.getElementById("tile-materials-summary");
  if (productCount > 0) {
    const allMats = aggregateMaterials(rmByProduct);
    matTile.textContent = `${allMats.size} material${allMats.size !== 1 ? 's' : ''} needed`;
  } else {
    matTile.textContent = "No materials needed";
  }

  // Home batter tile
  const homeOrders = state.allOrders.filter(o => o.delivery_date === dateStr && o.is_home);
  const homeTile = document.getElementById("tile-homebatter-summary");
  if (homeOrders.length > 0) {
    const homeItems = homeOrders.flatMap(o => o.items).length;
    homeTile.textContent = `${homeItems} item${homeItems !== 1 ? 's' : ''} added`;
  } else {
    homeTile.textContent = "Add for home use";
  }

  // Reminders tile
  const byCustomer = getUnpaidDeliveredByCustomer();
  const custCount = Object.keys(byCustomer).length;
  const unpaidTotal = Object.values(byCustomer).reduce((s, v) => s + v, 0);
  if (custCount > 0) {
    document.getElementById("tile-reminders-summary").innerHTML = `${custCount} customer${custCount !== 1 ? "s" : ""} &middot; &euro;${unpaidTotal.toFixed(2)}`;
  } else {
    document.getElementById("tile-reminders-summary").textContent = "All caught up!";
  }
}

function updateNotifyButton() {
  const dateStr = document.getElementById("tools-date").value;
  const btn = document.getElementById("btn-notify");
  if (!dateStr) { btn.style.display = "none"; return; }
  const ordersForDate = state.allOrders.filter(o => o.delivery_date === dateStr);
  const deliveries = ordersForDate.filter(o => o.needs_delivery);
  const pickups = ordersForDate.filter(o => !o.needs_delivery);
  const hasRoute = state.optimizedRoute != null;
  const custByName = buildCustByName();
  // Show if there are deliveries with a route OR pickups — as long as at least one has a phone
  const eligible = (hasRoute ? deliveries : []).concat(pickups);
  const withPhone = eligible.filter(o => custByName.get(o.customer_name)?.phone);
  btn.style.display = withPhone.length > 0 ? "block" : "none";
}

export function loadToolsTab() {
  const today = new Date().toISOString().split("T")[0];
  const upcoming = state.allOrders.filter(o => o.delivery_date >= today).sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
  const dateInput = document.getElementById("tools-date");
  if (!dateInput.value && upcoming.length > 0) {
    dateInput.value = upcoming[0].delivery_date;
  } else if (!dateInput.value) {
    dateInput.value = today;
  }
  document.querySelectorAll(".tool-detail").forEach(d => d.style.display = "none");
  document.getElementById("tools-hub").style.display = "grid";
  state.optimizedRoute = null;
  document.getElementById("route-info").style.display = "none";
  document.getElementById("btn-open-maps").style.display = "none";
  document.getElementById("btn-send-route").style.display = "none";
  document.getElementById("btn-notify").style.display = "none";
  updateTileSummaries();
}

// Tools date change listener
export function initToolsDateListener() {
  document.getElementById("tools-date")?.addEventListener("change", () => {
    state.optimizedRoute = null;
    document.getElementById("route-info").style.display = "none";
    document.getElementById("btn-open-maps").style.display = "none";
    document.getElementById("btn-send-route").style.display = "none";
    document.getElementById("btn-notify").style.display = "none";
    updateTileSummaries();
  });
}

// ========== GOOGLE MAPS ROUTE ==========
async function loadAppConfig() {
  if (state.cachedConfig !== null) return state.cachedConfig;
  const snap = await getDoc(doc(db, "config", "settings"));
  if (snap.exists()) state.cachedConfig = snap.data();
  return state.cachedConfig || {};
}

function renderRouteInfo(label, stops, stopETAs, totalDistanceM, totalDurationS, homeETA) {
  const distKm = (totalDistanceM / 1000).toFixed(1);
  const durMin = Math.round(totalDurationS / 60);
  const stopsHtml = stops.map((s, i) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--divider);"><span>${i + 1}. ${esc(s.name)}</span><span style="color:var(--gray);font-size:0.85rem;">${stopETAs[i] || ''}</span></div>`).join('');
  const homeHtml = homeETA ? `<div style="display:flex;justify-content:space-between;padding:4px 0;"><span>&#x1f3e0; Back Home</span><span style="color:var(--gray);font-size:0.85rem;">${homeETA}</span></div>` : '';
  document.getElementById("route-info").innerHTML = `
    <div class="route-info">
      <div class="route-label">${label} \u00b7 ${distKm} km \u00b7 ~${durMin} min</div>
      <div style="margin:8px 0;">${stopsHtml}${homeHtml}</div>
    </div>`;
  document.getElementById("route-info").style.display = "block";
  document.getElementById("btn-open-maps").style.display = "block";
  document.getElementById("btn-send-route").style.display = "block";
}

async function fetchRouteForDate(dateStr) {
  if (state.optimizedRoute) return state.optimizedRoute;
  if (!dateStr) return null;
  try {
    const q = query(collection(db, "routes"), where("date", "==", dateStr));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docs = snap.docs.map(d => d.data()).sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    const saved = docs[0];
    const stopETAs = saved.stops.map(s => s.eta || '');
    state.optimizedRoute = {
      stops: saved.stops,
      totalDistance: saved.total_distance_m,
      totalDuration: saved.total_duration_s,
      legDurations: [],
      stopETAs: stopETAs,
      mapsUrl: saved.maps_url,
      startTime: saved.start_time,
      homeETA: saved.home_eta
    };
    return state.optimizedRoute;
  } catch (e) {
    console.error("Failed to load route:", e);
    return null;
  }
}

async function loadSavedRoute() {
  const dateStr = document.getElementById("tools-date").value;
  const today = new Date().toISOString().split("T")[0];
  if (!dateStr || dateStr < today) return;
  const route = await fetchRouteForDate(dateStr);
  if (route) {
    renderRouteInfo("Saved Route", route.stops, route.stopETAs, route.totalDistance, route.totalDuration, route.homeETA);
    updateNotifyButton();
  }
}

window.planRoute = async () => {
  const dateStr = document.getElementById("tools-date").value;
  if (!dateStr) { showToast("Select a delivery date", "error"); return; }
  const deliveries = state.allOrders.filter(o => o.delivery_date === dateStr && o.needs_delivery);
  if (deliveries.length === 0) { showToast("No deliveries for this date", "error"); return; }

  const custByName = buildCustByName();
  const stops = [];
  for (const o of deliveries) {
    const cust = custByName.get(o.customer_name);
    if (cust?.address) {
      stops.push({ name: o.customer_name, address: cust.address, order: o });
    }
  }
  if (stops.length === 0) { showToast("No customers with addresses found", "error"); return; }

  const btn = document.getElementById("btn-plan-route");
  btn.disabled = true; btn.textContent = "Planning...";

  try {
    const config = await loadAppConfig();
    const origin = config.home_address || config.kitchen_address;
    if (!origin) { showToast("Set home_address in Firestore config/settings", "error"); return; }

    const startTime = document.getElementById("tools-start-time").value || "07:00";
    const departureTime = new Date(`${dateStr}T${startTime}:00`).toISOString();

    const apiKey = config.google_maps_api_key;
    const routesResponse = await fetch(
      `https://routes.googleapis.com/directions/v2:computeRoutes`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration,routes.distanceMeters,routes.duration,routes.optimizedIntermediateWaypointIndex'
        },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: origin },
          intermediates: stops.map(s => ({ address: s.address })),
          travelMode: 'DRIVE',
          optimizeWaypointOrder: true,
          routingPreference: 'TRAFFIC_AWARE',
          departureTime: departureTime
        })
      }
    );

    if (!routesResponse.ok) {
      const err = await routesResponse.json();
      throw new Error(err.error?.message || `Routes API failed: ${routesResponse.status}`);
    }

    const routesData = await routesResponse.json();
    const route = routesData.routes[0];
    const waypointOrder = route.optimizedIntermediateWaypointIndex;
    const orderedStops = waypointOrder.map(i => stops[i]);

    let totalDistance = 0, totalDuration = 0;
    const legDurations = [];
    for (const leg of route.legs) {
      totalDistance += leg.distanceMeters || 0;
      const durStr = leg.duration || '0s';
      const legDurSec = Math.round(parseInt(durStr.replace('s', '')));
      totalDuration += legDurSec;
      legDurations.push(legDurSec);
    }

    const waypointAddrs = orderedStops.map(s => encodeURIComponent(s.address)).join("/");
    const mapsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(origin)}/${waypointAddrs}/${encodeURIComponent(origin)}`;

    const STOP_BUFFER_SEC = 5 * 60;
    const startDate = new Date(`${dateStr}T${startTime}:00`);
    const stopETAs = [];
    let cumDur = 0;
    for (let i = 0; i < orderedStops.length; i++) {
      cumDur += legDurations[i] || 0;
      cumDur += i > 0 ? STOP_BUFFER_SEC : 0;
      const etaDate = new Date(startDate.getTime() + cumDur * 1000);
      const etaStr = etaDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      stopETAs.push(etaStr);
    }

    // Calculate home arrival time (after last leg back home + buffer for last stop)
    cumDur += STOP_BUFFER_SEC;
    cumDur += legDurations[orderedStops.length] || 0;
    const homeDate = new Date(startDate.getTime() + cumDur * 1000);
    const homeETA = homeDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    state.optimizedRoute = { stops: orderedStops, totalDistance, totalDuration, legDurations, stopETAs, mapsUrl, startTime, homeETA };

    const routeStr = orderedStops.map(s => s.name).join(" \u2192 ");
    renderRouteInfo("Optimized Route", orderedStops, stopETAs, totalDistance, totalDuration, homeETA);
    updateNotifyButton();

    try {
      await addDoc(collection(db, "routes"), {
        date: dateStr,
        start_time: startTime,
        stops: orderedStops.map((s, i) => ({ name: s.name, address: s.address, eta: stopETAs[i] })),
        total_distance_m: totalDistance,
        total_duration_s: totalDuration,
        maps_url: mapsUrl,
        home_eta: homeETA,
        route_summary: routeStr,
        created_by: auth.currentUser.email,
        timestamp: serverTimestamp()
      });

      showToast("Route saved");
    } catch (se) {
      console.error("Failed to save route:", se);
      showToast("Route planned (save failed)");
    }

  } catch (e) {
    console.error("Route planning error:", e);
    showToast(e.message || "Failed to plan route", "error");
  } finally {
    btn.disabled = false; btn.textContent = "\u{1f5fa} Plan Route";
  }
};

window.openInMaps = () => {
  if (state.optimizedRoute?.mapsUrl) window.open(state.optimizedRoute.mapsUrl, "_blank");
};

window.sendRouteToOwner = async () => {
  const route = state.optimizedRoute;
  if (!route?.stops) { showToast("No route planned", "error"); return; }

  const config = await loadAppConfig();
  const phone = config.route_share_number;
  if (!phone) { showToast("Set route_share_number in config/settings", "error"); return; }

  const dateStr = document.getElementById("tools-date").value;
  const dateLabel = friendlyDate(dateStr);
  const startTime = document.getElementById("tools-start-time")?.value || "08:00";
  const distKm = (route.totalDistance / 1000).toFixed(1);
  const durMin = Math.round(route.totalDuration / 60);

  // Also include pickup orders for this date
  const allOrdersForDate = state.allOrders.filter(o => o.delivery_date === dateStr);
  const custByName = buildCustByName();
  const deliveryOrdersByCustomer = new Map();
  for (const o of allOrdersForDate) {
    if (!o.needs_delivery) continue;
    if (!deliveryOrdersByCustomer.has(o.customer_name)) deliveryOrdersByCustomer.set(o.customer_name, []);
    deliveryOrdersByCustomer.get(o.customer_name).push(o);
  }

  let lines = [`Route for ${dateLabel}`, `${distKm} km \u2022 ~${durMin} min \u2022 Start: ${startTime}`, ''];

  // Delivery stops (in route order)
  lines.push('Deliveries');
  lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  route.stops.forEach((s, i) => {
    const eta = route.stopETAs?.[i] || '';
    const cust = custByName.get(s.name);
    const custOrders = deliveryOrdersByCustomer.get(s.name) || [];
    const items = custOrders.flatMap(o => o.items.map(it => `${it.quantity} ${it.unit} ${it.name}`)).join(', ');
    lines.push(`${i + 1}. ${s.name}${eta ? ` \u2013 ${eta}` : ''}`);
    lines.push(`   ${s.address}`);
    if (items) lines.push(`   ${items}`);
    if (cust?.phone) lines.push(`   ${cust.phone}`);
    lines.push('');
  });

  // Pickup orders
  const pickups = allOrdersForDate.filter(o => !o.needs_delivery);
  if (pickups.length > 0) {
    lines.push('Pickups');
    lines.push('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
    pickups.forEach(o => {
      const cust = custByName.get(o.customer_name);
      const items = o.items.map(it => `${it.quantity} ${it.unit} ${it.name}`).join(', ');
      lines.push(`\u2022 ${o.customer_name}`);
      if (items) lines.push(`   ${items}`);
      if (cust?.phone) lines.push(`   ${cust.phone}`);
      lines.push('');
    });
  }

  if (route.mapsUrl) lines.push(route.mapsUrl);

  const msg = lines.join('\n');
  const cleanPhone = phone.replace(/[^+\d]/g, '');
  const link = document.createElement('a');
  link.href = `sms:${cleanPhone}&body=${encodeURIComponent(msg)}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

function showPreviewOverlay(title, messages, bgColor) {
  // 1. Backdrop
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;';

  // 2. Bottom sheet panel
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--bg);border-radius:16px 16px 0 0;z-index:10000;';

  // 3. Header
  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 20px 8px;text-align:center;';
  const handle = document.createElement('div');
  handle.style.cssText = 'width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 10px;';
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight:700;font-size:1.05rem;';
  titleEl.textContent = title;
  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'color:var(--gray);font-size:0.82rem;margin-top:2px;';
  subtitle.textContent = `${messages.length} message${messages.length !== 1 ? 's' : ''}`;
  header.append(handle, titleEl, subtitle);

  // 4. Scrollable messages with per-message Send buttons
  const messagesDiv = document.createElement('div');
  messagesDiv.style.cssText = 'overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 20px;';
  for (const m of messages) {
    const bubble = document.createElement('div');
    bubble.style.cssText = `background:${bgColor};border-radius:12px 12px 12px 4px;padding:10px 14px;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,0.06);`;
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;font-size:0.82rem;color:var(--success);margin-bottom:4px;';
    nameEl.textContent = m.to;
    const textEl = document.createElement('div');
    textEl.style.cssText = 'font-size:0.85rem;white-space:pre-wrap;line-height:1.4;color:var(--text);';
    textEl.textContent = m.text;
    bubble.append(nameEl, textEl);

    if (m.phone) {
      const sendLink = document.createElement('a');
      const cleanPhone = m.phone.replace(/[^+\d]/g, '').replace(/^\+/, '');
      sendLink.href = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(m.text)}`;
      sendLink.target = '_blank';
      sendLink.rel = 'noopener';
      sendLink.textContent = 'Send \u27a4';
      sendLink.style.cssText = 'display:inline-block;margin-top:8px;padding:6px 16px;background:var(--green);color:white;border-radius:20px;font-size:0.82rem;font-weight:600;text-decoration:none;';
      bubble.appendChild(sendLink);
    }

    messagesDiv.appendChild(bubble);
  }

  // 5. Footer with Close button
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 20px 20px;border-top:1px solid var(--divider);background:var(--bg);';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:var(--red);color:white;font-weight:600;cursor:pointer;font-size:0.95rem;';
  footer.appendChild(closeBtn);

  // 6. Assemble & insert
  panel.append(header, messagesDiv, footer);
  document.body.append(backdrop, panel);

  // 7. Calculate scroll height AFTER DOM insertion
  const maxHeight = window.innerHeight * 0.85;
  const usedHeight = header.offsetHeight + footer.offsetHeight;
  messagesDiv.style.maxHeight = Math.max(maxHeight - usedHeight, 120) + 'px';
  panel.style.maxHeight = maxHeight + 'px';

  // 8. Close handlers
  history.pushState({ overlay: true }, '');
  const closeOverlay = () => {
    if (!backdrop.parentNode) return; // already closed
    backdrop.remove();
    panel.remove();
    window.removeEventListener('popstate', closeOverlay);
  };
  const closeAndBack = () => { if (!backdrop.parentNode) return; closeOverlay(); history.back(); };
  backdrop.addEventListener('click', closeAndBack);
  closeBtn.addEventListener('click', closeAndBack);
  window.addEventListener('popstate', closeOverlay);
}

// ========== WHATSAPP NOTIFICATIONS ==========
window.notifyCustomers = () => {
  const dateStr = document.getElementById("tools-date").value;
  if (!dateStr) { showToast("Select a date", "error"); return; }
  const ordersForDate = state.allOrders.filter(o => o.delivery_date === dateStr);
  if (ordersForDate.length === 0) { showToast("No orders for this date", "error"); return; }

  const custByName = buildCustByName();
  const stopEtaByName = new Map();
  if (state.optimizedRoute?.stops) {
    state.optimizedRoute.stops.forEach((s, i) => { if (state.optimizedRoute.stopETAs?.[i]) stopEtaByName.set(s.name, state.optimizedRoute.stopETAs[i]); });
  }
  const dateLabel = friendlyDate(dateStr);
  const messages = [];
  for (const o of ordersForDate) {
    const cust = custByName.get(o.customer_name);
    if (!cust?.phone) continue;

    const itemsSummary = o.items.map(i => `${i.quantity} ${i.unit} ${i.name}`).join(", ");
    const firstName = cust.name.split(' ')[0];
    let msg;

    if (o.needs_delivery) {
      const eta = stopEtaByName.get(o.customer_name);
      const etaLine = eta ? ` We should be at your doorstep by around *${eta}*.` : "";
      msg = `Hi ${firstName},\nYour batter order (${itemsSummary}) is prepared and will be delivered on *${dateLabel}*.${etaLine} Thank you for choosing Manasa's Batters!`;
    } else {
      const PICKUP_WINDOW_HOURS = 2;
      const startTime = document.getElementById("tools-start-time")?.value || "07:00";
      const [h, m] = startTime.split(':').map(Number);
      const endH = h + PICKUP_WINDOW_HOURS;
      const startStr = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
      const endStr = new Date(2000, 0, 1, endH, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
      msg = `Hi ${firstName},\nYour batter order (${itemsSummary}) is ready for pickup on *${dateLabel}* between *${startStr}* and *${endStr}*. Thank you for choosing Manasa's Batters!`;
    }

    messages.push({ to: `${cust.name} (${cust.phone})`, text: msg, phone: cust.phone });
  }

  if (messages.length === 0) { showToast("No customers with phone numbers", "error"); return; }
  showPreviewOverlay("Order Notifications", messages, "var(--green-light)");
};

// ========== RAW MATERIALS (TOOLS TAB) ==========
function renderToolsRawMaterials() {
  const container = document.getElementById("tools-raw-materials");
  const rmByProduct = buildRawMaterialsByProduct(state.allOrders, state.products);
  if (Object.keys(rmByProduct).length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray);"><div style="font-size:2rem;margin-bottom:8px;opacity:0.5;">&#x1f6d2;</div><p>No materials needed</p></div>';
    return;
  }

  // 1. Aggregated list across all products
  const allMats = aggregateMaterials(rmByProduct);
  const sortedMats = [...allMats.values()].sort((a, b) => a.name.localeCompare(b.name));
  const shoppingRows = sortedMats.map(rm =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--divider);">
      <span style="font-size:0.95rem;">${esc(rm.name)}</span>
      <span style="font-weight:700;font-size:0.95rem;white-space:nowrap;">${fmtQty(rm.qty)} ${esc(rm.unit)}</span>
    </div>`
  ).join("");

  // 2. Breakdown by product
  const breakdownRows = Object.entries(rmByProduct).map(([pName, pData]) => {
    const matRows = Object.values(pData.materials).sort((a, b) => b.qty - a.qty)
      .map(rm => `<div style="display:flex;justify-content:space-between;padding:3px 0 3px 12px;font-size:0.85rem;"><span style="color:var(--text-tertiary);">${esc(rm.name)}</span><span>${fmtQty(rm.qty)} ${esc(rm.unit)}</span></div>`)
      .join("");
    return `<div style="margin-bottom:10px;"><div style="font-weight:600;font-size:0.9rem;padding-bottom:4px;border-bottom:1px solid var(--divider);">${esc(pName)} <span style="font-weight:400;color:var(--gray);">(${fmtQty(pData.totalQty)} ${esc(pData.unit)})</span></div>${matRows}</div>`;
  }).join("");

  container.innerHTML = `
    <div style="font-weight:700;font-size:0.85rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Total Materials</div>
    ${shoppingRows}
    <div style="margin-top:20px;font-weight:700;font-size:0.85rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Breakdown by Product</div>
    ${breakdownRows}`;
}

// ========== DELIVERY RUN ==========
async function renderDeliveryRun() {
  const headerEl = document.getElementById("deliveryrun-header");
  const listEl = document.getElementById("deliveryrun-list");
  const dateStr = document.getElementById("tools-date").value;
  if (!dateStr) { listEl.innerHTML = '<div class="empty-state"><p>Select a delivery date</p></div>'; return; }

  const deliveries = state.allOrders.filter(o => o.delivery_date === dateStr && o.needs_delivery);
  if (deliveries.length === 0) {
    headerEl.innerHTML = '';
    listEl.innerHTML = '<div class="empty-state"><div class="icon">&#x1f69a;</div><p>No deliveries for this date</p></div>';
    return;
  }

  const route = await fetchRouteForDate(dateStr);
  const custByName = buildCustByName();

  // Group orders by customer
  const ordersByCustomer = new Map();
  for (const o of deliveries) {
    if (!ordersByCustomer.has(o.customer_name)) ordersByCustomer.set(o.customer_name, []);
    ordersByCustomer.get(o.customer_name).push(o);
  }

  // Build stops in route order if available, otherwise in order of deliveries
  let stops = [];
  if (route?.stops) {
    for (const rs of route.stops) {
      const orders = ordersByCustomer.get(rs.name);
      if (orders) {
        stops.push({ name: rs.name, address: rs.address, eta: null, orders });
        ordersByCustomer.delete(rs.name);
      }
    }
    // Set ETAs from route
    route.stops.forEach((rs, i) => {
      const stop = stops.find(s => s.name === rs.name);
      if (stop) stop.eta = route.stopETAs?.[i] || null;
    });
  }
  // Add remaining customers not in route
  for (const [name, orders] of ordersByCustomer) {
    const cust = custByName.get(name);
    stops.push({ name, address: cust?.address || '', eta: null, orders });
  }

  // Split into pending and done
  const indexedStops = stops.map((s, i) => ({ ...s, idx: i }));
  const pendingStops = indexedStops.filter(s => !s.orders.every(o => o.delivered));
  const doneStops = indexedStops.filter(s => s.orders.every(o => o.delivered));

  // Progress
  const totalStops = stops.length;
  const doneCount = doneStops.length;
  const pct = totalStops > 0 ? Math.round((doneCount / totalStops) * 100) : 0;

  const startTime = route?.startTime || '';
  const homeETA = route?.homeETA || '';
  const timeInfo = [startTime ? `Start: ${startTime}` : '', homeETA ? `Home: ${homeETA}` : ''].filter(Boolean).join(' · ');
  document.getElementById("dr-start-time").textContent = timeInfo;

  headerEl.innerHTML = `
    <div class="dr-progress">
      <div style="font-weight:700;font-size:1.1rem;">${doneCount === totalStops ? 'All Delivered! &#x1f389;' : `${doneCount} of ${totalStops} delivered`}</div>
      <div class="dr-progress-bar"><div class="dr-progress-fill" style="width:${pct}%"></div></div>
      <div class="dr-progress-text">${pct}% complete</div>
    </div>`;

  let html = '';

  // Pending cards
  const mapSvg = '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>';
  const callSvg = '<svg viewBox="0 0 24 24" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';

  pendingStops.forEach((stop) => {
    const idx = stop.idx;
    const cust = custByName.get(stop.name);
    const allItems = stop.orders.flatMap(o => o.items.map(it => `${fmtQty(it.quantity)} ${esc(it.unit)} ${esc(it.name)}`));
    const total = stop.orders.reduce((s, o) => s + orderTotal(o), 0);
    const allPaid = stop.orders.every(o => o.paid);
    const itemsHtml = allItems.map(item => `<div class="dr-item">${item}</div>`).join('');
    const notes = stop.orders.map(o => o.notes).filter(Boolean).map(n => esc(n)).join('; ');
    html += `<div class="dr-card" id="dr-stop-${idx}">
      <div class="dr-top">
        <div class="dr-step-num">${idx + 1}</div>
        <div class="dr-name">${esc(shortName(stop.name))}</div>
        <div class="dr-right">
          ${stop.eta ? `<span class="dr-eta">${esc(stop.eta)}</span>` : ''}
          ${allPaid
            ? `<span class="dr-badge paid">PAID</span>`
            : `<span class="dr-badge unpaid">&euro;${total.toFixed(2)}</span>`}
        </div>
        ${cust?.phone ? `<button class="dr-btn-call" data-phone="${esc(cust.phone)}" onclick="drCall(this)">${callSvg}</button>` : ''}
      </div>
      <div class="dr-items-list">${itemsHtml}</div>
      ${notes ? `<div class="dr-note">${notes}</div>` : ''}

      <div class="dr-actions">
        ${stop.address ? `<button class="dr-btn-map" data-address="${esc(stop.address)}" onclick="drNavigate(this)">${mapSvg} Navigate</button>` : ''}
        ${!allPaid ? `<button class="dr-btn-paid" onclick="drTogglePaid(${idx}, true)">Paid</button>` : ''}
        <button class="dr-btn-delivered" onclick="drToggleDelivered(${idx}, true)">&#x2713; Delivered</button>
      </div>
    </div>`;
  });

  // Done section
  if (doneStops.length > 0) {
    html += `<div class="dr-done-section">
      <div class="dr-done-toggle" onclick="document.getElementById('dr-done-list').style.display = document.getElementById('dr-done-list').style.display === 'none' ? 'block' : 'none'; this.querySelector('.dr-chevron').classList.toggle('open')">
        <span class="dr-chevron">&#x25B6;</span> ${doneStops.length} delivered
      </div>
      <div id="dr-done-list" style="display:none;">`;

    doneStops.forEach((stop) => {
      const idx = stop.idx;
      html += `<div class="dr-done-card">
        <div class="dr-top">
          <div class="dr-step-num">${idx + 1}</div>
          <div class="dr-name">${esc(shortName(stop.name))}</div>
          <span class="dr-undo-link" onclick="drToggleDelivered(${idx}, false)">Undo</span>
        </div>
      </div>`;
    });

    html += `</div></div>`;
  }

  if (route?.mapsUrl) {
    html += `<button class="dr-open-maps" onclick="openInMaps()">&#x1f4cd; Open Full Route in Maps</button>`;
  }

  listEl.innerHTML = html;
  state._drStops = stops;
}

window.drNavigate = (btn) => {
  window.location.href = `maps://?daddr=${encodeURIComponent(btn.dataset.address)}`;
};
window.drCall = (btn) => {
  window.location.href = `tel:${btn.dataset.phone}`;
};

window.drToggleDelivered = async (stopIdx, delivered) => {
  const stops = state._drStops;
  if (!stops || !stops[stopIdx]) return;
  const stop = stops[stopIdx];
  const card = document.getElementById(`dr-stop-${stopIdx}`);
  try {
    await Promise.all(stop.orders.map(o => updateDoc(doc(db, "orders", o.id), { delivered })));
    for (const o of stop.orders) {
      o.delivered = delivered;
      const stateOrder = state.allOrders.find(x => x.id === o.id);
      if (stateOrder) stateOrder.delivered = delivered;
    }

    if (delivered && card) {
      card.classList.add("collapsing");
      setTimeout(() => renderDeliveryRun(), 400);
    } else {
      renderDeliveryRun();
    }
    showToast(delivered ? `${stop.name} delivered` : `${stop.name} unmarked`);
  } catch (_e) {
    showToast("Failed to update", "error");
  }
};

window.drTogglePaid = async (stopIdx, paid) => {
  const stops = state._drStops;
  if (!stops || !stops[stopIdx]) return;
  const stop = stops[stopIdx];
  try {
    await Promise.all(stop.orders.map(o => updateDoc(doc(db, "orders", o.id), { paid })));
    for (const o of stop.orders) {
      o.paid = paid;
      const stateOrder = state.allOrders.find(x => x.id === o.id);
      if (stateOrder) stateOrder.paid = paid;
    }

    renderDeliveryRun();
    showToast(`${stop.name} marked paid`);
  } catch (_e) {
    showToast("Failed to update", "error");
  }
};

// ========== HOME BATTER ==========
let homeItemCounter = 0;

function renderHomeBatter() {
  const dateStr = document.getElementById("tools-date").value;
  const container = document.getElementById("home-items-container");
  homeItemCounter = 0;
  container.innerHTML = "";

  // Load existing home order for this date
  const existing = state.allOrders.find(o => o.delivery_date === dateStr && o.is_home);
  if (existing) {
    state._homeEditId = existing.id;
    for (const item of existing.items) addHomeItemRow(item);
    document.getElementById("home-delete-btn").style.display = "block";
  } else {
    state._homeEditId = null;
    addHomeItemRow();
    document.getElementById("home-delete-btn").style.display = "none";
  }
}

window.addHomeItemRow = (item) => {
  const id = homeItemCounter++;
  const container = document.getElementById("home-items-container");
  const div = document.createElement("div");
  div.className = "item-row"; div.id = `hitem-${id}`;
  div.innerHTML = `
    <button class="btn-remove" onclick="this.closest('.item-row').remove()">&times;</button>
    <select id="hsel-${id}" onchange="onHomeProductChange(${id}, this)" style="padding-right:36px;">${buildProductOptions()}</select>
    <div class="row" style="margin-top:8px;">
      <div><input type="text" id="hq-${id}" placeholder="Qty" inputmode="decimal" pattern="[0-9]*[.,]?[0-9]*"></div>
      <div class="small"><select id="hu-${id}"><option value="kg">kg</option><option value="grams">grams</option><option value="pieces">pieces</option><option value="liters">liters</option></select></div>
    </div>`;
  container.appendChild(div);

  if (item && typeof item === "object") {
    const sel = document.getElementById(`hsel-${id}`);
    for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].textContent === item.name) { sel.selectedIndex = i; break; } }
    document.getElementById(`hq-${id}`).value = item.quantity;
    document.getElementById(`hu-${id}`).value = item.unit;
  }
  if (!item) div.scrollIntoView({ behavior: "smooth", block: "center" });
};

window.onHomeProductChange = (id, sel) => {
  const opt = sel.options[sel.selectedIndex];
  if (opt.dataset.unit) document.getElementById(`hu-${id}`).value = opt.dataset.unit;
};

window.saveHomeBatter = async () => {
  const dateStr = document.getElementById("tools-date").value;
  if (!dateStr) { showToast("Select a date first", "error"); return; }

  const rows = document.querySelectorAll("#home-items-container .item-row");
  const items = [];
  for (const row of rows) {
    const sel = row.querySelector("select");
    if (!sel.value) continue;
    const name = sel.options[sel.selectedIndex].textContent;
    const id = row.id.split("-")[1];
    const qty = parseNum(document.getElementById(`hq-${id}`).value);
    const unit = document.getElementById(`hu-${id}`).value;
    if (!qty || qty <= 0) { showToast(`Enter quantity for ${name}`, "error"); return; }
    items.push({ name, quantity: qty, unit, price: 0 });
  }
  if (items.length === 0) { showToast("Add at least one item", "error"); return; }

  const btn = document.getElementById("home-save-btn");
  btn.disabled = true; btn.textContent = "Saving...";

  try {
    if (state._homeEditId) {
      await updateDoc(doc(db, "orders", state._homeEditId), { items });
      const existing = state.allOrders.find(o => o.id === state._homeEditId);
      if (existing) existing.items = items;
      showToast("Home batter updated");
    } else {
      const docRef = await addDoc(collection(db, "orders"), {
        items, customer_name: "Home", delivery_date: dateStr, notes: "",
        is_home: true, needs_delivery: false, delivery_fee: 0,
        delivered: false, paid: true,
        created_by: auth.currentUser.email, timestamp: serverTimestamp()
      });
      state.allOrders.push({
        id: docRef.id, items, customer_name: "Home", delivery_date: dateStr, notes: "",
        is_home: true, needs_delivery: false, delivery_fee: 0,
        delivered: false, paid: true, created_by: auth.currentUser.email
      });
      state._homeEditId = docRef.id;
      showToast("Home batter saved");
    }

  } catch (_e) {
    showToast("Failed to save", "error");
  } finally {
    btn.disabled = false; btn.textContent = "Save";
  }
};

window.deleteHomeBatter = async () => {
  if (!state._homeEditId) return;
  if (!confirm("Delete home batter for this date?")) return;
  try {
    await deleteDoc(doc(db, "orders", state._homeEditId));
    state.allOrders = state.allOrders.filter(o => o.id !== state._homeEditId);
    state._homeEditId = null;

    renderHomeBatter();
    showToast("Home batter deleted");
  } catch (_e) {
    showToast("Failed to delete", "error");
  }
};

// ========== PAYMENT REMINDERS ==========
function getUnpaidDeliveredByCustomer() {
  const byCustomer = {};
  for (const o of state.allOrders.filter(o => !o.paid && o.delivered)) {
    byCustomer[o.customer_name] = (byCustomer[o.customer_name] || 0) + orderTotal(o);
  }
  return byCustomer;
}

function renderToolsReminders() {
  const byCustomer = getUnpaidDeliveredByCustomer();
  const count = Object.keys(byCustomer).length;
  const total = Object.values(byCustomer).reduce((s, v) => s + v, 0);

  document.getElementById("reminder-count").textContent = count;
  document.getElementById("reminder-sub").textContent = `customer${count !== 1 ? "s" : ""} with unpaid delivered orders`;
  document.getElementById("reminder-total").innerHTML = `Total outstanding: &euro;${total.toFixed(2)}`;
}

window.sendReminders = () => {
  const entries = Object.entries(getUnpaidDeliveredByCustomer());
  if (entries.length === 0) { showToast("No unpaid reminders to send", "error"); return; }

  const custByName = buildCustByName();
  const messages = [];
  for (const [name, amount] of entries) {
    const cust = custByName.get(name);
    if (!cust?.phone) continue;

    const firstName = name.split(' ')[0];
    const msg = `Hi ${firstName},\nThis is a gentle reminder that you have a pending balance of *\u20ac${amount.toFixed(2)}* for your batter orders. We would really appreciate it if you could settle it at your earliest convenience.\nThank you for your support!\nManasa's Batters`;
    messages.push({ to: `${name} (${cust.phone})`, text: msg, phone: cust.phone });
  }

  if (messages.length === 0) { showToast("No customers with phone numbers", "error"); return; }
  showPreviewOverlay("Payment Reminders", messages, "var(--orange-light)");
};
