'use strict';

const state = { data: null, selectedDate: null, gran: 600 };
let chart = null;
let chartEl = null;

const $ = (id) => document.getElementById(id);

function isMobile() {
  return window.innerWidth < 640;
}

function fmt(n) {
  const v = Number(n) || 0;
  return isMobile() ? String(v) : v.toLocaleString('en-US');
}

function fmtDelta(n) {
  const v = Number(n) || 0;
  const s = isMobile() ? String(v) : v.toLocaleString('en-US');
  if (v > 0) return `+${s}`;
  if (v < 0) return s;
  return '0';
}

function deltaClass(n) {
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

function fmtTime(t) {
  if (!t) return '-';
  const d = new Date(t * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s, n) {
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

async function fetchData() {
  try {
    const res = await fetch('./latest.json', { cache: 'no-store' });
    state.data = await res.json();
    render();
  } catch (e) {
    const el = $('statusText');
    if (el) el.textContent = '连接失败：' + e.message;
  }
}

function updateStatus() {
  const d = state.data;
  if (!d) return;
  const el = $('statusText');
  if (el) el.textContent =
    `上次采集：${fmtTime(d.lastCollect)} · 每 10 分钟自动采集`;
}

function ensureSelectedDate() {
  const d = state.data;
  if (!d || !d.dates || !d.dates.length) return null;
  if (!state.selectedDate || !d.days || !d.days[state.selectedDate]) {
    state.selectedDate = d.dates[d.dates.length - 1];
  }
  return state.selectedDate;
}

function latestDay() {
  const d = state.data;
  if (!d || !d.days) return null;
  const dates = d.dates || Object.keys(d.days);
  const key = dates[dates.length - 1];
  return key ? d.days[key] : null;
}

function formatDateLabel(d) {
  const parts = String(d).split('-');
  return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : d;
}

function updateDateSelect() {
  const sel = $('dateSelect');
  if (!sel) return;
  const dates = (state.data && state.data.dates) || [];
  if (!dates.length) return;
  ensureSelectedDate(); // 确保 selectedDate 有效
  sel.innerHTML = dates
    .map((d, i) => {
      const latest = i === dates.length - 1 ? '（最新）' : '';
      const selected = d === state.selectedDate ? ' selected' : '';
      return `<option value="${d}"${selected}>${formatDateLabel(d)}${latest}</option>`;
    })
    .join('');
}

function buildSeries(h, granSec) {
  const pts = h.points || [];
  const buckets = [];
  if (!pts.length) return { name: h.title, group: h.group, buckets };

  // 每个时间桶取最后一个节点；跨相邻桶求「该粒度内的新增」
  const last = new Map();
  for (const p of pts) {
    const b = Math.floor(p.t / granSec);
    const cur = last.get(b);
    if (!cur || p.t > cur.t) last.set(b, p);
  }
  const keys = Array.from(last.keys()).sort((a, b) => a - b);
  let prevView = null;
  for (const b of keys) {
    const p = last.get(b);
    buckets.push({
      t: b * granSec, // 桶起始时间，作为统一 x 轴刻度
      d: p.d,
      delta: prevView === null ? null : p.view - prevView,
    });
    prevView = p.view;
  }
  return { name: h.title, group: h.group, buckets };
}

/* ------------------------------ 左右两列 ------------------------------ */

function renderCol(group) {
  const col = document.createElement('div');
  col.className = 'pk-col';

  const top = group.topToday;
  const topHtml = top
    ? `
      <div class="top-title" title="${escapeHtml(top.title)}">${escapeHtml(truncate(top.title, 20))}</div>
      <div class="top-owner">${top.owner ? 'UP主：' + escapeHtml(top.owner) : ''}</div>
      <div class="delta ${deltaClass(top.delta)}">播放 ${fmtDelta(top.delta)}</div>`
    : `<div class="muted">暂无数据</div>`;

  const rows = (group.videos || [])
    .map((v) => `
      <tr>
        <td class="title-cell">
          <div class="vid-title" title="${escapeHtml(v.title)}">${escapeHtml(truncate(v.title, 14))}</div>
          <div class="bv">${escapeHtml(v.bvid)}</div>
        </td>
        <td class="num">${fmt(v.viewCur)}</td>
        <td class="num"><span class="delta ${deltaClass(v.viewDelta)}">${fmtDelta(v.viewDelta)}</span></td>
        <td class="num"><span class="delta ${deltaClass(v.viewTodayDelta)}">${fmtDelta(v.viewTodayDelta)}</span></td>
      </tr>`)
    .join('');

  col.innerHTML = `
    <div class="col-head">
      <div class="col-name">${escapeHtml(group.name)}</div>
      <div class="col-badge">${group.name === '王橹杰' ? '🦌' : '🐰'}</div>
    </div>

    <div class="metric-block">
      <div class="metric-label">① 当日总涨幅</div>
      <div class="metric-value big ${deltaClass(group.totalTodayDelta)}">${fmtDelta(group.totalTodayDelta)}</div>
    </div>

    <div class="metric-block">
      <div class="metric-label">② 当日涨幅最高</div>
      ${topHtml}
    </div>

    <div class="video-list">
      <div class="list-head">各视频播放量 / 时段新增 / 当日新增</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="title-col">视频</th>
              <th>播放量</th>
              <th>时段新增</th>
              <th>当日新增</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
  return col;
}

function renderCols() {
  const day = latestDay();
  const wrap = $('pkCols');
  wrap.innerHTML = '';
  if (!day) return;
  for (const g of day.groups || []) wrap.appendChild(renderCol(g));
}

/* ------------------------------ 趋势图 ------------------------------ */

function initChart() {
  if (chart) return;
  chartEl = chartEl || $('chart');
  if (!window.echarts) {
    chartEl.innerHTML = '<p style="color:#b3859a">图表库加载失败，请检查网络（ECharts CDN）。</p>';
    return;
  }
  chart = window.echarts.init(chartEl);
  window.addEventListener('resize', () => chart && chart.resize());
}

function renderChart() {
  chartEl = chartEl || $('chart');
  initChart();
  if (!chart) return;

  const sel = ensureSelectedDate();
  const dateSet = new Set(sel ? [sel] : []);
  const gran = state.gran || 600;
  const history = (state.data && state.data.history) || [];

  // 每个视频一条「该粒度内新增」曲线，统一按时间桶对齐（任意时间范围 × 任意粒度正交组合）
  const rawSeries = history.map((h) => {
    const s = buildSeries(h, gran);
    return { name: h.title, group: h.group, buckets: s.buckets.filter((b) => dateSet.has(b.d)) };
  });

  const timeSet = new Set();
  for (const s of rawSeries) for (const b of s.buckets) timeSet.add(b.t);
  const times = Array.from(timeSet).sort((a, b) => a - b);

  const series = rawSeries.map((s) => {
    const map = new Map(s.buckets.map((b) => [b.t, b.delta]));
    const color = s.group === '王橹杰' ? '#2dd4bf' : '#f472b6';
    return {
      name: truncate(s.name, 20),
      type: 'line',
      smooth: 0.4,
      symbol: 'circle',
      symbolSize: 3,
      lineStyle: { width: 1.5, color },
      itemStyle: { color },
      emphasis: { focus: 'series' },
      data: times.map((t) => (map.has(t) ? map.get(t) : null)),
    };
  });

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: axisTooltip,
    },
    grid: { left: 0, right: 12, top: 24, bottom: 36, containLabel: true },
    xAxis: {
      type: 'category',
      data: times.map((t) => fmtTime(t)),
      axisLine: { lineStyle: { color: 'rgba(90,58,75,.15)' } },
      axisLabel: { color: '#b3859a' },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#b3859a' },
      splitLine: { lineStyle: { color: 'rgba(90,58,75,.08)' } },
    },
    series,
  };
  chart.setOption(option, true);
}

function axisTooltip(params) {
  const raw = Array.isArray(params) ? params : [params];
  const p = raw
    .filter((it) => it.value !== null && it.value !== undefined && it.value !== '')
    .slice()
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));
  if (!p.length) return '';
  let html = '<div style="margin-bottom:4px;font-weight:600">' + p[0].axisValue + '</div>';
  for (const item of p) {
    html +=
      '<div style="display:flex;justify-content:space-between;gap:16px;min-width:180px">' +
      '<span>' + item.marker + escapeHtml(item.seriesName) + '</span>' +
      '<span style="text-align:right;font-variant-numeric:tabular-nums">' + fmtDelta(item.value) + '</span>' +
      '</div>';
  }
  return html;
}

/* ------------------------------ Excel 明细对比 ------------------------------ */

const COMPARE_GROUPS = [
  { label: '杨博文', badge: 'PK', match: (h) => h.group === '杨博文' },
  { label: '王橹杰', badge: 'pk', match: (h) => h.group === '王橹杰' && (h.tag || '') !== '单刷' },
  { label: '王橹杰新', badge: '单刷', match: (h) => h.group === '王橹杰' && (h.tag || '') === '单刷' },
];

function fmtHour(t) {
  const d = new Date(t * 1000);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function videoBase(pts, dateKey) {
  let prev = null;
  for (const p of pts) {
    if (p.d < dateKey) {
      if (!prev || p.t > prev.t) prev = p;
    }
  }
  if (prev) return prev.view;
  for (const p of pts) {
    if (p.d === dateKey) return p.view;
  }
  return 0;
}

function buildViewMap(pts, dateKey, granSec) {
  const map = new Map();
  for (const p of pts) {
    if (p.d !== dateKey) continue;
    const b = Math.floor(p.t / granSec) * granSec;
    const cur = map.get(b);
    if (cur === undefined || p.t > cur) map.set(b, p.view);
  }
  return map;
}

function renderCompareTable() {
  const wrap = $('compareTable');
  if (!wrap) return;
  wrap.innerHTML = '';
  const sel = ensureSelectedDate();
  if (!sel) return;

  const granSec = 1800; // 固定每半小时
  const history = (state.data && state.data.history) || [];

  const timeSet = new Set();
  for (const h of history) {
    for (const p of h.points || []) {
      if (p.d === sel) timeSet.add(Math.floor(p.t / granSec) * granSec);
    }
  }
  const times = Array.from(timeSet).sort((a, b) => a - b);
  if (!times.length) {
    wrap.innerHTML = '<div class="muted">当日暂无数据</div>';
    return;
  }

  const groups = COMPARE_GROUPS.map((cfg) => ({
    label: cfg.label,
    badge: cfg.badge,
    vids: history
      .filter((h) => cfg.match(h))
      .map((h) => ({
        h,
        base: videoBase(h.points || [], sel),
        viewByBucket: buildViewMap(h.points || [], sel, granSec),
      })),
  })).filter((g) => g.vids.length > 0);

  const totalAt = (vids, t) => {
    let sum = 0;
    for (const v of vids) {
      const view = v.viewByBucket.get(t);
      if (view !== undefined) sum += view - v.base;
    }
    return sum;
  };

  const headRow1 = '<th rowspan="2" class="time-col">时间</th>' +
    groups.map((g) =>
      `<th colspan="${g.vids.length + 1}" class="group-head">${escapeHtml(g.label)} <span class="badge">${escapeHtml(g.badge)}</span></th>`
    ).join('');

  const headRow2 = groups.map((g) =>
    g.vids.map((v) =>
      `<th class="vid-head" title="${escapeHtml(v.h.title)}">` +
      `<span class="vid-bv">${escapeHtml(v.h.bvid)}</span>` +
      `<span class="vid-name">${escapeHtml(truncate(v.h.title, 12))}</span></th>`
    ).join('') +
    '<th class="total-col">总涨幅</th>'
  ).join('');

  const rows = times.map((t) => {
    const cells = [];
    for (const g of groups) {
      for (const v of g.vids) {
        const view = v.viewByBucket.get(t);
        cells.push(`<td class="num">${view === undefined ? '<span class="flat">-</span>' : fmt(view)}</td>`);
      }
      cells.push(`<td class="num"><span class="delta ${deltaClass(totalAt(g.vids, t))}">${fmtDelta(totalAt(g.vids, t))}</span></td>`);
    }
    return `<tr><td class="time-cell">${fmtHour(t)}</td>${cells.join('')}</tr>`;
  });

  wrap.innerHTML = `
    <div class="table-wrap compare-wrap">
      <table>
        <thead>
          <tr>${headRow1}</tr>
          <tr>${headRow2}</tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

/* ------------------------------ 渲染入口 ------------------------------ */

function render() {
  updateStatus();
  updateDateSelect();
  renderCols();
  renderChart();
  renderCompareTable();
}

const refreshBtn = document.getElementById('btnRefresh');
if (refreshBtn) refreshBtn.onclick = fetchData;

const dateSelect = $('dateSelect');
if (dateSelect) dateSelect.onchange = () => {
  state.selectedDate = dateSelect.value;
  renderChart();
  renderCompareTable();
};

const granGroup = $('granGroup');
if (granGroup) granGroup.onclick = (e) => {
  const btn = e.target.closest('[data-gran]');
  if (!btn) return;
  state.gran = Number(btn.dataset.gran);
  granGroup.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderChart();
};

fetchData();
setInterval(fetchData, 60000); // 数据 10 分钟采集一次，60 秒轮询即可
