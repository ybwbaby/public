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

function activeDay() {
  const d = state.data;
  if (!d || !d.days) return null;
  const dates = d.dates || Object.keys(d.days);
  if (!state.selectedDate || !d.days[state.selectedDate]) {
    state.selectedDate = dates[dates.length - 1] || null;
  }
  return state.selectedDate ? d.days[state.selectedDate] : null;
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
  activeDay(); // 确保 selectedDate 有效
  sel.innerHTML = dates
    .map((d, i) => {
      const latest = i === dates.length - 1 ? '（最新）' : '';
      const selected = d === state.selectedDate ? ' selected' : '';
      return `<option value="${d}"${selected}>${formatDateLabel(d)}${latest}</option>`;
    })
    .join('');
}

/* ------------------------------ 左右两列 ------------------------------ */

function renderCol(group) {
  const col = document.createElement('div');
  col.className = 'pk-col';

  const top = group.topToday;
  const topHtml = top
    ? `
      <div class="top-title" title="${escapeHtml(top.title)}">${escapeHtml(truncate(top.title, 16))}</div>
      <div class="top-owner">${top.owner ? 'UP主：' + escapeHtml(top.owner) : ''}</div>
      <div class="delta ${deltaClass(top.delta)}">播放 ${fmtDelta(top.delta)}</div>`
    : `<div class="muted">暂无数据</div>`;

  const rows = (group.videos || [])
    .map((v) => `
      <tr>
        <td class="title-cell">
          <div class="vid-title" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</div>
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
      <div class="col-badge">PK</div>
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

// 按统计维度（秒）对 10 分钟粒度趋势做降采样：半小时=1800s、1小时=3600s
function aggregateTrend(trend, granSec) {
  const times = (trend && trend.times) || [];
  const series = (trend && trend.series) || [];
  if (granSec <= 600 || !times.length) {
    return { times: times.slice(), series };
  }
  const bucketTimes = new Set();
  const newSeries = series.map((s) => {
    const lastInBucket = new Map();
    for (const p of s.trend || []) {
      lastInBucket.set(Math.floor(p.t / granSec), p);
    }
    const trend = Array.from(lastInBucket.values())
      .sort((a, b) => a.t - b.t);
    for (const p of trend) bucketTimes.add(p.t);
    return { name: s.name, group: s.group, trend };
  });
  return { times: Array.from(bucketTimes).sort((a, b) => a - b), series: newSeries };
}

function renderChart() {
  const day = activeDay();
  if (!day) return;
  chartEl = chartEl || $('chart');
  initChart();
  if (!chart) return;

  const trend = aggregateTrend(day.trend, state.gran);
  const times = (trend.times || []).map((t) => fmtTime(t));
  const series = (trend.series || []).map((s) => {
    const map = new Map((s.trend || []).map((p) => [p.t, p.cum]));
    const color = s.group === '王橹杰' ? '#2dd4bf' : '#f472b6';
    return {
      name: truncate(s.name, 20),
      type: 'line',
      symbol: 'circle',
      symbolSize: 3,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      emphasis: { focus: 'series' },
      data: (trend.times || []).map((t) => (map.has(t) ? map.get(t) : null)),
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
      data: times,
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

/* ------------------------------ 渲染入口 ------------------------------ */

function render() {
  updateStatus();
  updateDateSelect();
  renderCols();
  renderChart();
}

const refreshBtn = document.getElementById('btnRefresh');
if (refreshBtn) refreshBtn.onclick = fetchData;

const dateSelect = $('dateSelect');
if (dateSelect) dateSelect.onchange = () => {
  state.selectedDate = dateSelect.value;
  renderChart();
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
