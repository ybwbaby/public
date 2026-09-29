'use strict';

const state = { data: null };
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

/* ------------------------------ 左右两列 ------------------------------ */

function renderCol(group) {
  const col = document.createElement('div');
  col.className = 'pk-col';

  const top = group.topToday;
  const titleLen = isMobile() ? 12 : 16;
  const topHtml = top
    ? `
      <div class="top-title" title="${escapeHtml(top.title)}">${escapeHtml(truncate(top.title, isMobile() ? 10 : 18))}</div>
      <div class="top-owner">${top.owner ? 'UP主：' + escapeHtml(top.owner) : ''}</div>
      <div class="delta ${deltaClass(top.delta)}">播放 ${fmtDelta(top.delta)}</div>`
    : `<div class="muted">暂无数据</div>`;

  const rows = (group.videos || [])
    .map((v) => `
      <tr>
        <td class="title-cell">
          <div class="vid-title" title="${escapeHtml(v.title)}">${escapeHtml(truncate(v.title, titleLen))}</div>
          <div class="bv">${escapeHtml(v.bvid)}</div>
        </td>
        <td class="num">${fmt(v.viewCur)}</td>
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
      <div class="list-head">各视频播放量 / 当日新增</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="title-col">视频</th>
              <th>播放量</th>
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
  const d = state.data;
  const wrap = $('pkCols');
  wrap.innerHTML = '';
  for (const g of d.groups || []) wrap.appendChild(renderCol(g));
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
  const d = state.data;
  if (!d) return;
  chartEl = chartEl || $('chart');
  initChart();
  if (!chart) return;

  const trend = d.trend || {};
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
    legend: {
      type: 'plain',
      bottom: 0,
      textStyle: { color: '#b3859a', fontSize: 12 },
    },
    grid: { left: 80, right: 30, top: 30, bottom: 92 },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: 'rgba(90,58,75,.15)' } },
      axisLabel: { color: '#b3859a' },
    },
    yAxis: {
      type: 'value',
      name: '累计涨幅',
      nameTextStyle: { color: '#b3859a' },
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
  renderCols();
  renderChart();
}

const refreshBtn = document.getElementById('btnRefresh');
if (refreshBtn) refreshBtn.onclick = fetchData;

fetchData();
setInterval(fetchData, 60000); // 数据 10 分钟采集一次，60 秒轮询即可
