import { state } from './state.js';
import { esc, orderTotal } from './helpers.js';

function barChart(entries, { color = 'var(--green)', prefix = '\u20AC' } = {}) {
  if (entries.length === 0) return '<div class="stat-row"><span class="label" style="color:var(--gray);">No data</span></div>';
  const max = Math.max(...entries.map(e => e.value));
  return entries.map(e => {
    const pct = max > 0 ? (e.value / max) * 100 : 0;
    const valStr = prefix + e.value.toFixed(2);
    return `<div class="chart-bar-row">
      <div class="chart-bar-top">
        <span class="chart-label">${esc(e.label)}</span>
        <span class="chart-bar-val">${valStr}</span>
      </div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:${pct}%;background:${color};"></div>
      </div>
    </div>`;
  }).join('');
}

function monthlyBarChart(revenueByMonth) {
  const entries = Object.entries(revenueByMonth).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) return '<div class="stat-row"><span class="label" style="color:var(--gray);">No data</span></div>';
  const max = Math.max(...entries.map(([, v]) => v));
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const avg = entries.length > 0 ? total / entries.length : 0;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return `<div class="month-chart">${entries.map(([m, v], i) => {
    const pct = max > 0 ? (v / max) * 100 : 0;
    const parts = m.split('-');
    const mo = parseInt(parts[1]) - 1;
    const isJan = mo === 0;
    const label = isJan || i === 0 ? monthNames[mo] + " '" + parts[0].slice(2) : monthNames[mo];
    return `<div class="month-col" onclick="this.querySelector('.month-val').style.opacity=this.querySelector('.month-val').style.opacity==='1'?'0':'1'">
      <div class="month-val">\u20AC${Math.round(v)}</div>
      <div class="month-bar-wrap"><div class="month-bar-fill" style="height:${pct}%;"></div></div>
      <div class="month-label">${label}</div>
    </div>`;
  }).join('')}</div>
  <div class="month-total">Avg: \u20AC${Math.round(avg)}/mo</div>`;
}

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
  let lifetimeRevenue = 0, lifetimeOrders = 0;
  const lifetimeByCustomer = {};
  const revenueByMonth = {};

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
    lifetimeRevenue += t;
    lifetimeOrders++;
    lifetimeByCustomer[o.customer_name] = (lifetimeByCustomer[o.customer_name] || 0) + t;
    const month = o.delivery_date?.slice(0, 7);
    if (month) revenueByMonth[month] = (revenueByMonth[month] || 0) + t;
  }

  const growthPct = ordersLastMonth > 0 ? Math.round(((ordersThisMonth - ordersLastMonth) / ordersLastMonth) * 100) : 0;
  const growthStr = ordersLastMonth === 0
    ? `<span style="color:var(--gray);">No data last month</span>`
    : (growthPct >= 0
      ? `<span style="color:var(--success);">+${growthPct}%</span>`
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
    .join("") || '<div class="stat-row"><span class="label" style="color:var(--success);">All paid!</span></div>';

  const topCustThisMonth = Object.entries(topCustomers).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([n, v]) => ({ label: n, value: v }));

  const topCustAllTime = Object.entries(lifetimeByCustomer).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([n, v]) => ({ label: n, value: v }));

  const productEntries = Object.entries(productTotals).sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([n, d]) => ({ label: `${n} (${d.qty})`, value: d.revenue }));

  container.innerHTML = `
    <div class="report-card" style="text-align:center;">
      <div class="stat-big" style="color:var(--green);font-size:2.2rem;">&euro;${lifetimeRevenue.toFixed(2)}</div>
      <div class="stat-label">Lifetime Sales &middot; ${lifetimeOrders} orders</div>
    </div>
    <div class="report-row-2">
      <div class="report-card"><div class="stat-big danger">&euro;${totalUnpaid.toFixed(2)}</div><div class="stat-label">Unpaid</div></div>
      <div class="report-card"><div class="stat-big success">&euro;${totalPaidMonth.toFixed(2)}</div><div class="stat-label">Paid (Month)</div></div>
    </div>
    <div class="report-row-2">
      <div class="report-card"><div class="stat-big" style="color:var(--text);">${ordersThisMonth}</div><div class="stat-label">Orders This Month</div></div>
      <div class="report-card"><div class="stat-big" style="color:var(--text);">${ordersLastMonth}</div><div class="stat-label">Last Month ${growthStr}</div></div>
    </div>
    <div class="report-card"><h3>Monthly Revenue</h3>${monthlyBarChart(revenueByMonth)}</div>
    <div class="report-card"><h3>Top Customers This Month</h3>${barChart(topCustThisMonth, { color: 'var(--green)' })}</div>
    <div class="report-card"><h3>Top Customers (All Time)</h3>${barChart(topCustAllTime, { color: 'var(--blue)' })}</div>
    <div class="report-card"><h3>Products This Month</h3>${barChart(productEntries, { color: 'var(--orange)' })}</div>
    <div class="report-card"><h3>Outstanding by Customer</h3>${unpaidRows}</div>`;
}
