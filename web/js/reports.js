import { state } from './state.js';
import { esc, orderTotal } from './helpers.js';

export function renderReports() {
  const container = document.getElementById("reports-content");
  if (state.allOrders.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#x1f4ca;</div><p>No orders to report on.<br>Visit Orders tab first.</p></div>';
    return;
  }
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);
  const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - now.getDay());
  const weekStr = thisWeekStart.toISOString().split("T")[0];

  const unpaidByCustomer = {};
  const topCustomers = {};
  let totalUnpaid = 0, totalPaidMonth = 0, totalPaidWeek = 0;
  let ordersThisMonth = 0, ordersLastMonth = 0;

  for (const o of state.allOrders) {
    if (o.is_home) continue;
    const t = orderTotal(o);
    if (!o.paid) { totalUnpaid += t; unpaidByCustomer[o.customer_name] = (unpaidByCustomer[o.customer_name] || 0) + t; }
    if (o.paid && o.delivery_date >= thisMonth + "-01") totalPaidMonth += t;
    if (o.paid && o.delivery_date >= weekStr) totalPaidWeek += t;
    if (o.delivery_date?.startsWith(thisMonth)) {
      ordersThisMonth++;
      topCustomers[o.customer_name] = (topCustomers[o.customer_name] || 0) + t;
    }
    if (o.delivery_date?.startsWith(lastMonth)) ordersLastMonth++;
  }

  const growthPct = ordersLastMonth > 0 ? Math.round(((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100) : 0;
  const growthStr = ordersLastMonth === 0
    ? `<span style="color:var(--gray);">No data last month</span>`
    : (growthPct >= 0
      ? `<span style="color:#2e7d32;">+${growthPct}%</span>`
      : `<span style="color:var(--red);">${growthPct}%</span>`);

  const productTotals = {};
  for (const o of state.allOrders) {
    if (o.is_home) continue;
    if (o.delivery_date < thisMonth + "-01") continue;
    for (const i of o.items) {
      if (!productTotals[i.name]) productTotals[i.name] = { qty: 0, revenue: 0 };
      productTotals[i.name].qty += i.quantity;
      productTotals[i.name].revenue += i.quantity * i.price;
    }
  }


  const unpaidRows = Object.entries(unpaidByCustomer).sort((a, b) => b[1] - a[1])
    .map(([n, a]) => `<div class="stat-row"><span class="label">${esc(n)}</span><span class="value danger">&euro;${a.toFixed(2)}</span></div>`)
    .join("") || '<div class="stat-row"><span class="label" style="color:#2e7d32;">All paid!</span></div>';

  const productRows = Object.entries(productTotals).sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([n, d]) => `<div class="stat-row"><span class="label">${esc(n)} (${d.qty})</span><span class="value">&euro;${d.revenue.toFixed(2)}</span></div>`)
    .join("") || '<div class="stat-row"><span class="label">No orders this month</span></div>';

  const topCustRows = Object.entries(topCustomers).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([n, a]) => `<div class="stat-row"><span class="label">${esc(n)}</span><span class="value">&euro;${a.toFixed(2)}</span></div>`)
    .join("") || '<div class="stat-row"><span class="label">No orders this month</span></div>';

  container.innerHTML = `
    <div class="report-row-2">
      <div class="report-card"><div class="stat-big danger">&euro;${totalUnpaid.toFixed(2)}</div><div class="stat-label">Unpaid</div></div>
      <div class="report-card"><div class="stat-big success">&euro;${totalPaidMonth.toFixed(2)}</div><div class="stat-label">Paid (Month)</div></div>
    </div>
    <div class="report-row-2">
      <div class="report-card"><div class="stat-big" style="color:#333;">${ordersThisMonth}</div><div class="stat-label">Orders This Month</div></div>
      <div class="report-card"><div class="stat-big" style="color:#333;">${ordersLastMonth}</div><div class="stat-label">Last Month ${growthStr}</div></div>
    </div>
    <div class="report-card"><h3>Outstanding by Customer</h3>${unpaidRows}</div>
    <div class="report-card"><h3>Top Customers This Month</h3>${topCustRows}</div>
    <div class="report-card"><h3>This Week (Paid)</h3><div class="stat-row"><span class="label">Revenue</span><span class="value success">&euro;${totalPaidWeek.toFixed(2)}</span></div></div>
    <div class="report-card"><h3>Products This Month</h3>${productRows}</div>`;
}
