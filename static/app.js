/**
 * QuantFolio Wealth Analytics - Frontend Controller
 * ออกแบบให้ใช้งานง่าย ชัดเจน มาตรฐานเว็บการเงินมืออาชีพ
 */

const state = {
  tickers: ['NVDA', 'TSLA', 'AMZN', 'BTC-USD', 'AAPL'],
  tickerQuotes: {},
  activeGoal: 'max_sharpe',
  optData: null,
  growthLogScale: true,
  currency: 'USD',
  currencySymbol: '$',
  searchDebounceTimer: null
};

const PRESETS = {
  colab_original: {
    tickers: ['NVDA', 'TSLA', 'AMZN', 'BTC-USD', 'AAPL'],
    start: '2020-01-01',
    end: '2024-01-01',
    currency: 'USD'
  },
  tech_titans: {
    tickers: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA'],
    start: '2021-01-01',
    end: new Date().toISOString().split('T')[0],
    currency: 'USD'
  },
  all_weather: {
    tickers: ['SPY', 'QQQ', 'GLD', 'TLT', 'DBC'],
    start: '2020-01-01',
    end: new Date().toISOString().split('T')[0],
    currency: 'USD'
  },
  thai_set50: {
    tickers: ['PTT.BK', 'AOT.BK', 'CPALL.BK', 'DELTA.BK', 'BDMS.BK'],
    start: '2021-01-01',
    end: new Date().toISOString().split('T')[0],
    currency: 'THB'
  }
};

// Institutional financial color palette
const ASSET_COLORS = [
  '#1d4ed8', '#059669', '#d97706', '#7c3aed', '#db2777',
  '#0284c7', '#dc2626', '#0d9488', '#4f46e5', '#65a30d'
];

const STRATEGY_COLORS = {
  max_sharpe: '#1d4ed8',
  min_volatility: '#059669',
  hrp: '#7c3aed',
  equal_weight: '#64748b'
};

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  fetchLiveRfRate();
  renderTickersList();
  fetchLiveQuotesForTickers();

  // Run initial portfolio calculation automatically
  setTimeout(() => {
    runOptimization();
  }, 200);
});

async function fetchLiveRfRate() {
  try {
    const res = await fetch('/api/rf');
    if (res.ok) {
      const data = await res.json();
      const el = document.getElementById('top-rf-rate');
      if (el && data.percentage) {
        el.innerText = data.percentage;
      }
    }
  } catch (e) {
    console.warn('RF rate fetch notice:', e);
  }
}

// Preset Selection
function applyPreset(presetKey) {
  const p = PRESETS[presetKey];
  if (!p) return;

  state.tickers = [...p.tickers];
  if (p.start) document.getElementById('start-date-input').value = p.start;
  if (p.end) document.getElementById('end-date-input').value = p.end;

  if (p.currency) {
    const sel = document.getElementById('currency-select');
    sel.value = p.currency;
    if (p.currency === 'THB' && document.getElementById('budget-input').value === '10000') {
      document.getElementById('budget-input').value = '300000';
    } else if (p.currency === 'USD' && document.getElementById('budget-input').value === '300000') {
      document.getElementById('budget-input').value = '10000';
    }
    updateCurrencySymbol();
  }

  // Highlight active preset button
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.className = 'preset-btn px-3 py-1.5 text-xs rounded-md bg-white hover:bg-slate-50 text-slate-700 font-medium border border-slate-200 transition whitespace-nowrap';
  });
  const activeBtn = document.getElementById(`preset-btn-${presetKey}`);
  if (activeBtn) {
    activeBtn.className = 'preset-btn px-3 py-1.5 text-xs rounded-md bg-blue-50 text-blue-700 font-semibold border border-blue-200 transition whitespace-nowrap';
  }

  renderTickersList();
  fetchLiveQuotesForTickers();
  runOptimization();
}

// Timeframe buttons
function setTimeframe(tf, btnEl) {
  const end = new Date();
  const start = new Date();

  if (tf === '1Y') start.setFullYear(end.getFullYear() - 1);
  else if (tf === '3Y') start.setFullYear(end.getFullYear() - 3);
  else if (tf === '4Y') start.setFullYear(end.getFullYear() - 4);
  else if (tf === '5Y') start.setFullYear(end.getFullYear() - 5);

  document.getElementById('end-date-input').value = end.toISOString().split('T')[0];
  document.getElementById('start-date-input').value = start.toISOString().split('T')[0];

  document.querySelectorAll('.tf-btn').forEach(b => {
    b.className = 'tf-btn px-2 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium';
  });
  if (btnEl) {
    btnEl.className = 'tf-btn px-2 py-0.5 rounded bg-slate-900 text-white font-semibold';
  }
}

// Max Weight Controls
function updateMaxWeightLabel(val) {
  const num = parseInt(val, 10);
  const label = document.getElementById('max-weight-val');
  if (num >= 100) {
    label.innerText = 'ไม่จำกัด (100%)';
  } else {
    label.innerText = `ไม่เกิน ${num}% ต่อตัว`;
  }
}

function setMaxWeight(val) {
  const slider = document.getElementById('max-weight-slider');
  slider.value = val;
  updateMaxWeightLabel(val);
}

// Currency Selector
function updateCurrencySymbol() {
  const sel = document.getElementById('currency-select');
  state.currency = sel.value;
  if (sel.value === 'THB') state.currencySymbol = '฿';
  else if (sel.value === 'EUR') state.currencySymbol = '€';
  else state.currencySymbol = '$';

  document.getElementById('currency-symbol').innerText = state.currencySymbol;
  renderTickersList();
  if (state.optData) {
    renderActiveGoalView();
    renderStrategyCompareTable();
    renderPortfolioGrowthChart();
    renderAssetStatsTable();
  }
}

// Goal Selection (Instant reactive update if data already exists)
function selectGoal(goalKey) {
  state.activeGoal = goalKey;

  // Update Left Sidebar Goal Radio Cards
  ['max_sharpe', 'min_volatility', 'hrp', 'equal_weight'].forEach(k => {
    const card = document.getElementById(`goal-card-${k}`);
    if (card) {
      if (k === goalKey) card.classList.add('active');
      else card.classList.remove('active');
    }
    const pill = document.getElementById(`top-pill-${k}`);
    if (pill) {
      if (k === goalKey) {
        pill.className = 'top-goal-pill px-2.5 py-1 rounded text-[11px] font-semibold bg-blue-600 text-white transition';
      } else {
        pill.className = 'top-goal-pill px-2.5 py-1 rounded text-[11px] font-medium text-slate-300 hover:text-white transition';
      }
    }
  });

  if (state.optData) {
    renderActiveGoalView();
    renderStrategyCompareTable();
    renderAssetStatsTable();
  }
}

// Selected Tickers List
function renderTickersList() {
  const container = document.getElementById('selected-tickers-container');
  document.getElementById('asset-count').innerText = state.tickers.length;

  if (state.tickers.length === 0) {
    container.innerHTML = `
      <div class="p-4 text-center text-xs text-slate-400">
        ยังไม่มีสินทรัพย์ในพอร์ต กรุณาค้นหาและเพิ่มอย่างน้อย 2 รายการ
      </div>
    `;
    return;
  }

  container.innerHTML = state.tickers.map((ticker, idx) => {
    const q = state.tickerQuotes[ticker] || {};
    const name = q.name || ticker;
    const price = q.price !== undefined
      ? `${state.currencySymbol}${q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'กำลังดึงราคา...';

    const isUp = (q.change_pct || 0) >= 0;
    const chgColor = isUp ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200';
    const chgSign = isUp ? '+' : '';
    const chgBadge = q.change_pct !== undefined
      ? `<span class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${chgColor}">${chgSign}${q.change_pct.toFixed(2)}%</span>`
      : '';

    return `
      <div class="px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${ASSET_COLORS[idx % ASSET_COLORS.length]}"></span>
          <div class="truncate">
            <span class="font-bold text-xs font-mono text-slate-900">${ticker}</span>
            <span class="text-[11px] text-slate-500 ml-1.5 truncate">${name !== ticker ? name : ''}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="font-mono text-xs font-semibold text-slate-800">${price}</span>
          ${chgBadge}
          <button onclick="removeTicker('${ticker}')" title="ลบออก" class="text-slate-400 hover:text-rose-600 p-1 transition">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function fetchLiveQuotesForTickers() {
  if (state.tickers.length === 0) return;
  try {
    const res = await fetch(`/api/quote?tickers=${encodeURIComponent(state.tickers.join(','))}`);
    if (res.ok) {
      const data = await res.json();
      if (data.quotes) {
        state.tickerQuotes = { ...state.tickerQuotes, ...data.quotes };
        renderTickersList();
      }
    }
  } catch (e) {
    console.warn('Live quotes warning:', e);
  }
}

function addTicker(symbol) {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return;
  if (!state.tickers.includes(clean)) {
    state.tickers.push(clean);
    renderTickersList();
    fetchLiveQuotesForTickers();
  }
  document.getElementById('ticker-search-input').value = '';
  hideSearchDropdown();
}

function addTickerFromInput() {
  addTicker(document.getElementById('ticker-search-input').value);
}

function removeTicker(symbol) {
  state.tickers = state.tickers.filter(t => t !== symbol);
  renderTickersList();
}

function clearAllTickers() {
  state.tickers = [];
  renderTickersList();
}

// Search & Autocomplete
function handleSearchInput(e) {
  const query = e.target.value.trim();
  clearTimeout(state.searchDebounceTimer);

  if (!query) {
    hideSearchDropdown();
    return;
  }

  state.searchDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        renderSearchDropdown(data.results || []);
      }
    } catch (err) {
      console.warn('Search error:', err);
    }
  }, 220);
}

function handleSearchKeyDown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTickerFromInput();
  } else if (e.key === 'Escape') {
    hideSearchDropdown();
  }
}

function renderSearchDropdown(results) {
  const dd = document.getElementById('search-dropdown');
  if (!results || results.length === 0) {
    dd.innerHTML = `<div class="p-3 text-xs text-slate-400 text-center">ไม่พบชื่อย่อหุ้นที่ค้นหา</div>`;
    dd.classList.remove('hidden');
    return;
  }

  dd.innerHTML = results.map(r => `
    <div
      onclick="addTicker('${r.symbol}')"
      class="px-3 py-2 hover:bg-blue-50/60 cursor-pointer flex items-center justify-between transition"
    >
      <div class="min-w-0 pr-2">
        <div class="flex items-center gap-1.5">
          <span class="font-bold text-xs font-mono text-blue-700">${r.symbol}</span>
          <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-medium">${r.type}</span>
          <span class="text-[10px] text-slate-400">${r.exchange}</span>
        </div>
        <div class="text-[11px] text-slate-600 truncate">${r.name}</div>
      </div>
      <span class="text-xs text-blue-700 font-semibold shrink-0">+ เพิ่ม</span>
    </div>
  `).join('');

  dd.classList.remove('hidden');
}

function hideSearchDropdown() {
  document.getElementById('search-dropdown').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#ticker-search-input') && !e.target.closest('#search-dropdown')) {
    hideSearchDropdown();
  }
});

// Run Optimization
async function runOptimization() {
  if (state.tickers.length < 2) {
    showError('กรุณาเลือกหุ้นหรือสินทรัพย์อย่างน้อย 2 รายการขึ้นไปเพื่อคำนวณสัดส่วนพอร์ต');
    return;
  }

  hideError();
  showLoading(true);

  const startDate = document.getElementById('start-date-input').value;
  const endDate = document.getElementById('end-date-input').value;
  const budget = parseFloat(document.getElementById('budget-input').value) || 10000;
  const maxWeight = parseFloat(document.getElementById('max-weight-slider').value) / 100.0;

  try {
    const payload = {
      tickers: state.tickers,
      start_date: startDate,
      end_date: endDate,
      budget: budget,
      max_weight: maxWeight,
      min_weight: 0.0,
      risk_free_rate: null,
      num_simulations: 3500
    };

    const res = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'ไม่สามารถคำนวณข้อมูลพอร์ตได้ กรุณาตรวจสอบช่วงเวลาและชื่อหุ้น');
    }

    state.optData = data;
    renderAllViews();
  } catch (err) {
    showError(err.message);
  } finally {
    showLoading(false);
  }
}

function renderAllViews() {
  const data = state.optData;
  if (!data) return;

  document.getElementById('results-dashboard').classList.remove('hidden');
  document.getElementById('top-trading-days').innerText = data.metadata.trading_days.toLocaleString();
  document.getElementById('top-rf-rate').innerText = `${(data.metadata.risk_free_rate * 100).toFixed(2)}%`;
  document.getElementById('analysis-period-badge').innerText =
    `ข้อมูลจริง: ${data.metadata.start_date} ถึง ${data.metadata.end_date} (${data.metadata.trading_days} วันทำการ)`;

  renderActiveGoalView();
  renderPortfolioGrowthChart();
  renderStrategyCompareTable();
  renderEfficientFrontierPlot();
  renderAssetStatsTable();
  renderCorrelationAndGrowthPlots();

  if (window.lucide) {
    lucide.createIcons();
  }
}

// Render Top Executive KPI + Donut + Actionable Buy Order Table for the Selected Goal
function renderActiveGoalView() {
  const data = state.optData;
  if (!data) return;

  const strat = data.strategies[state.activeGoal];
  if (!strat) return;

  const budget = data.metadata.budget;
  const sym = state.currencySymbol;

  // Title & Tagline
  document.getElementById('active-goal-title').innerText = strat.name;
  document.getElementById('active-goal-desc').innerText = strat.tagline;

  // KPI 1: Expected Return
  const retPct = (strat.expected_return * 100).toFixed(2);
  const retSign = strat.expected_return >= 0 ? '+' : '';
  const kpiRetEl = document.getElementById('kpi-return');
  kpiRetEl.innerText = `${retSign}${retPct}%`;
  kpiRetEl.className = `text-2xl font-bold font-mono mt-1 ${strat.expected_return >= 0 ? 'text-emerald-700' : 'text-rose-700'}`;

  const estProfit = budget * strat.expected_return;
  const profitSign = estProfit >= 0 ? '+' : '';
  document.getElementById('kpi-profit-money').innerText =
    `ประมาณการ ${profitSign}${sym}${Math.abs(estProfit).toLocaleString(undefined, { maximumFractionDigits: 0 })} / ปี`;

  // KPI 2: Volatility & Risk Badge
  const volPct = (strat.volatility * 100).toFixed(2);
  document.getElementById('kpi-volatility').innerText = `${volPct}%`;
  const riskBadge = document.getElementById('kpi-risk-badge');
  if (strat.volatility < 0.16) {
    riskBadge.innerText = 'ระดับความเสี่ยงต่ำ';
    riskBadge.className = 'inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200';
  } else if (strat.volatility <= 0.28) {
    riskBadge.innerText = 'ระดับความเสี่ยงปานกลาง';
    riskBadge.className = 'inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200';
  } else {
    riskBadge.innerText = 'ระดับความเสี่ยงสูง';
    riskBadge.className = 'inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200';
  }

  // KPI 3: Max Drawdown
  document.getElementById('kpi-mdd').innerText = `${(strat.max_drawdown * 100).toFixed(2)}%`;

  // KPI 4: Sharpe Ratio
  document.getElementById('kpi-sharpe').innerText = strat.sharpe_ratio.toFixed(2);
  const srBadge = document.getElementById('kpi-sharpe-badge');
  if (strat.sharpe_ratio >= 1.5) {
    srBadge.innerText = 'คุ้มค่าความเสี่ยงดีเยี่ยม';
    srBadge.className = 'inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200';
  } else if (strat.sharpe_ratio >= 1.0) {
    srBadge.innerText = 'คุ้มค่าความเสี่ยงดี';
    srBadge.className = 'inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200';
  } else {
    srBadge.innerText = 'ความคุ้มค่าระดับปานกลาง';
    srBadge.className = 'inline-block text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200';
  }

  // Donut Chart of Portfolio Weights
  renderDonutAllocationChart(strat.weights, data.metadata.tickers);

  // Cash Deployment & Buy Order Table
  const da = strat.discrete_allocation;
  document.getElementById('order-kpi-budget').innerText = `${sym}${budget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('order-kpi-spent').innerText = `${sym}${da.cash_spent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('order-kpi-leftover').innerText = `${sym}${da.leftover.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const tbody = document.getElementById('orders-table-body');
  const activeAllocMap = {};
  (da.allocations || []).forEach(a => {
    activeAllocMap[a.ticker] = a;
  });

  // Sort tickers: active weights descending first, then zero-weight tickers
  const sortedTickers = [...data.metadata.tickers].sort((a, b) => {
    return (strat.weights[b] || 0) - (strat.weights[a] || 0);
  });

  tbody.innerHTML = sortedTickers.map(ticker => {
    const color = ASSET_COLORS[data.metadata.tickers.indexOf(ticker) % ASSET_COLORS.length];
    const statObj = data.asset_stats.find(s => s.ticker === ticker) || {};
    const alloc = activeAllocMap[ticker];
    const w = strat.weights[ticker] || 0;
    const wPct = (w * 100).toFixed(1);
    const price = alloc ? alloc.current_price : (statObj.latest_price || 0);
    const targetDollar = budget * w;

    if (w <= 0.0005 || !alloc) {
      // Zero weight row (shown subtly so user sees why it wasn't bought)
      return `
        <tr class="text-slate-400 bg-slate-50/50">
          <td class="py-2.5 px-3 font-sans">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-slate-300"></span>
              <span class="font-mono font-semibold text-slate-500">${ticker}</span>
            </div>
          </td>
          <td class="py-2.5 px-3 text-right">${sym}${price.toLocaleString()}</td>
          <td class="py-2.5 px-3 text-right">0.0%</td>
          <td class="py-2.5 px-3 text-right font-sans text-[11px]">ไม่แนะนำให้ลงทุนในกลยุทธ์นี้</td>
          <td class="py-2.5 px-3 text-right">${sym}0.00</td>
        </tr>
      `;
    }

    // Active Buy Order Row
    let qtyHtml = '';
    if (alloc.shares > 0) {
      qtyHtml = `
        <div class="font-sans font-bold text-emerald-700">ซื้อ ${alloc.shares.toLocaleString()} หุ้น</div>
        <div class="text-[10px] text-slate-400 font-mono">(${alloc.fractional_shares} หน่วยย่อย)</div>
      `;
    } else {
      qtyHtml = `
        <div class="font-sans font-bold text-blue-700">ซื้อ ${alloc.fractional_shares} หน่วยย่อย</div>
        <div class="text-[10px] text-slate-400 font-sans">(ซื้อแบบทศนิยม Fractional)</div>
      `;
    }

    return `
      <tr>
        <td class="py-3 px-3 font-sans">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${color}"></span>
            <div>
              <div class="font-mono font-bold text-slate-900">${ticker}</div>
              <div class="text-[10px] text-slate-500 truncate max-w-[130px]">${alloc.name || ''}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-3 text-right font-semibold text-slate-700">${sym}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="py-3 px-3 text-right">
          <div class="font-bold text-slate-900">${wPct}%</div>
          <div class="w-16 ml-auto h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
            <div class="h-full rounded-full" style="width: ${wPct}%; background-color: ${color}"></div>
          </div>
        </td>
        <td class="py-3 px-3 text-right">${qtyHtml}</td>
        <td class="py-3 px-3 text-right">
          <div class="font-bold text-slate-900">${sym}${targetDollar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          ${alloc.shares > 0 ? `<div class="text-[10px] text-slate-500">หุ้นเต็ม: ${sym}${alloc.allocated_value.toLocaleString()}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function renderDonutAllocationChart(weights, allTickers) {
  const container = document.getElementById('allocation-donut-chart');
  const entries = Object.entries(weights)
    .filter(([_, w]) => w > 0.001)
    .sort((a, b) => b[1] - a[1]);

  const labels = entries.map(([t]) => t);
  const values = entries.map(([_, w]) => Number((w * 100).toFixed(2)));
  const colors = labels.map(t => ASSET_COLORS[allTickers.indexOf(t) % ASSET_COLORS.length]);

  const trace = {
    labels: labels,
    values: values,
    type: 'pie',
    hole: 0.58,
    marker: {
      colors: colors,
      line: { color: '#ffffff', width: 2 }
    },
    textinfo: 'label+percent',
    textposition: 'outside',
    textfont: { family: 'Inter, IBM Plex Sans Thai', size: 11, color: '#1e293b' },
    hovertemplate: '<b>%{label}</b><br>สัดส่วน: %{value:.2f}%<extra></extra>'
  };

  const layout = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: { l: 20, r: 20, t: 20, b: 20 },
    showlegend: false,
    annotations: [
      {
        font: { size: 11, color: '#64748b', family: 'IBM Plex Sans Thai' },
        showarrow: false,
        text: 'สัดส่วนพอร์ต',
        x: 0.5,
        y: 0.5
      }
    ]
  };

  Plotly.newPlot(container, [trace], layout, { responsive: true, displayModeBar: false });
}

// Tab 1: Portfolio Growth Simulation & 4-Strategy Comparison Table
function renderPortfolioGrowthChart() {
  const data = state.optData;
  if (!data || !data.portfolio_growth) return;

  const container = document.getElementById('portfolio-growth-chart');
  const pg = data.portfolio_growth;
  const sym = state.currencySymbol;

  const namesMap = {
    max_sharpe: 'Max Sharpe (คุ้มความเสี่ยงสูงสุด)',
    min_volatility: 'Min Volatility (ผันผวนต่ำ)',
    hrp: 'Risk Parity (กระจายสมดุล)',
    equal_weight: 'Equal Weight (เท่ากัน 1/N)'
  };

  const traces = Object.keys(pg.series).map(key => {
    const isSelected = key === state.activeGoal;
    return {
      x: pg.dates,
      y: pg.series[key],
      mode: 'lines',
      name: namesMap[key] || key,
      line: {
        color: STRATEGY_COLORS[key],
        width: isSelected ? 3 : 1.75,
        dash: key === 'equal_weight' ? 'dot' : 'solid'
      },
      opacity: isSelected ? 1.0 : 0.7,
      hovertemplate: `<b>${namesMap[key]}</b>: ${sym}%{y:,.2f}<extra></extra>`
    };
  });

  const layout = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 65, r: 20, t: 25, b: 40 },
    xaxis: {
      gridcolor: '#f1f5f9',
      linecolor: '#e2e8f0',
      color: '#475569'
    },
    yaxis: {
      title: `มูลค่าพอร์ต (${sym})`,
      gridcolor: '#f1f5f9',
      linecolor: '#e2e8f0',
      color: '#475569',
      tickprefix: sym
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.12,
      font: { size: 11, color: '#334155' }
    },
    hovermode: 'x unified'
  };

  Plotly.newPlot(container, traces, layout, { responsive: true, displayModeBar: false });
}

function renderStrategyCompareTable() {
  const data = state.optData;
  if (!data) return;

  const tbody = document.getElementById('strategy-compare-table-body');
  const sym = state.currencySymbol;
  const order = ['max_sharpe', 'min_volatility', 'hrp', 'equal_weight'];

  tbody.innerHTML = order.map(key => {
    const s = data.strategies[key];
    const isSelected = key === state.activeGoal;
    const rowBg = isSelected ? 'bg-blue-50/70' : '';

    return `
      <tr class="${rowBg}">
        <td class="py-3 px-3 font-sans">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${STRATEGY_COLORS[key]}"></span>
            <span class="font-bold text-slate-900">${s.short_name}</span>
            ${isSelected ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-600 text-white">กำลังเลือก</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-3 text-right font-bold ${s.expected_return >= 0 ? 'text-emerald-700' : 'text-rose-700'}">
          ${(s.expected_return * 100).toFixed(2)}%
        </td>
        <td class="py-3 px-3 text-right text-slate-700 font-semibold">${(s.volatility * 100).toFixed(2)}%</td>
        <td class="py-3 px-3 text-right text-rose-700 font-semibold">${(s.max_drawdown * 100).toFixed(2)}%</td>
        <td class="py-3 px-3 text-right font-bold text-blue-700">${s.sharpe_ratio.toFixed(2)}</td>
        <td class="py-3 px-3 text-right font-bold text-slate-900">${sym}${s.final_historical_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="py-3 px-3 text-center font-sans">
          ${isSelected
            ? `<span class="text-xs font-bold text-blue-700">แสดงผลอยู่</span>`
            : `<button onclick="selectGoal('${key}')" class="px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded transition">เลือกดูพอร์ตนี้</button>`
          }
        </td>
      </tr>
    `;
  }).join('');
}

// Tab 2: Clean Efficient Frontier Plot
function renderEfficientFrontierPlot() {
  const data = state.optData;
  if (!data) return;

  const container = document.getElementById('frontier-plot-container');
  const ef = data.efficient_frontier;
  const strats = data.strategies;

  const traces = [
    // Simulated portfolios cloud (subtle background context)
    {
      x: ef.monte_carlo.map(p => p.vol),
      y: ef.monte_carlo.map(p => p.ret),
      mode: 'markers',
      name: 'พอร์ตสุ่มเปรียบเทียบ',
      marker: {
        size: 4,
        color: ef.monte_carlo.map(p => p.sharpe),
        colorscale: 'Blues',
        opacity: 0.35
      },
      hovertemplate: 'ความผันผวน: %{x:.2%}<br>ผลตอบแทน: %{y:.2%}<extra></extra>'
    }
  ];

  if (ef.curve && ef.curve.length > 0) {
    traces.push({
      x: ef.curve.map(p => p.vol),
      y: ef.curve.map(p => p.ret),
      mode: 'lines',
      name: 'เส้นพอร์ตที่มีประสิทธิภาพสูงสุด (Efficient Frontier)',
      line: { color: '#1d4ed8', width: 2.5 },
      hoverinfo: 'skip'
    });
  }

  // Individual Assets
  traces.push({
    x: data.asset_stats.map(a => a.volatility),
    y: data.asset_stats.map(a => a.expected_return),
    mode: 'markers+text',
    name: 'ถือหุ้นรายตัวเดี่ยวๆ',
    text: data.asset_stats.map(a => a.ticker),
    textposition: 'top center',
    textfont: { color: '#475569', size: 11, family: 'JetBrains Mono' },
    marker: { size: 9, color: '#94a3b8', line: { color: '#475569', width: 1.5 } },
    hovertemplate: '<b>หุ้น %{text}</b><br>ความผันผวน: %{x:.2%}<br>ผลตอบแทนคาดหวัง: %{y:.2%}<extra></extra>'
  });

  // 4 Strategy Markers
  const markerConfigs = [
    { key: 'max_sharpe', label: 'Max Sharpe', color: '#dc2626', symbol: 'star', size: 16 },
    { key: 'min_volatility', label: 'Min Volatility', color: '#059669', symbol: 'diamond', size: 13 },
    { key: 'hrp', label: 'Risk Parity (HRP)', color: '#7c3aed', symbol: 'circle', size: 13 },
    { key: 'equal_weight', label: 'Equal Weight (1/N)', color: '#334155', symbol: 'square', size: 11 }
  ];

  markerConfigs.forEach(cfg => {
    const s = strats[cfg.key];
    traces.push({
      x: [s.volatility],
      y: [s.expected_return],
      mode: 'markers+text',
      name: cfg.label,
      text: [cfg.label],
      textposition: 'bottom center',
      textfont: { color: cfg.color, size: 11, family: 'Inter' },
      marker: {
        symbol: cfg.symbol,
        size: cfg.size,
        color: cfg.color,
        line: { color: '#ffffff', width: 2 }
      },
      hovertemplate: `<b>${cfg.label}</b><br>ความผันผวน: %{x:.2%}<br>ผลตอบแทนคาดหวัง: %{y:.2%}<br>Sharpe Ratio: ${s.sharpe_ratio.toFixed(2)}<extra></extra>`
    });
  });

  const layout = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 60, r: 20, t: 25, b: 50 },
    xaxis: {
      title: 'ความผันผวนต่อปี (ความเสี่ยง — ยิ่งซ้ายยิ่งแกว่งน้อย)',
      tickformat: '.0%',
      gridcolor: '#f1f5f9',
      linecolor: '#e2e8f0',
      color: '#475569'
    },
    yaxis: {
      title: 'ผลตอบแทนคาดหวังเฉลี่ยต่อปี (CAGR)',
      tickformat: '.0%',
      gridcolor: '#f1f5f9',
      linecolor: '#e2e8f0',
      color: '#475569'
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.1,
      font: { size: 11, color: '#334155' }
    },
    hovermode: 'closest'
  };

  Plotly.newPlot(container, traces, layout, { responsive: true, displayModeBar: false });
}

// Tab 3: Individual Asset Stats Table & Correlation Matrix
function renderAssetStatsTable() {
  const data = state.optData;
  if (!data) return;

  const tbody = document.getElementById('asset-stats-table-body');
  const activeStrat = data.strategies[state.activeGoal];
  const sym = state.currencySymbol;

  tbody.innerHTML = data.asset_stats.map(stat => {
    const t = stat.ticker;
    const color = ASSET_COLORS[data.metadata.tickers.indexOf(t) % ASSET_COLORS.length];
    const w = ((activeStrat.weights[t] || 0) * 100).toFixed(1);

    return `
      <tr>
        <td class="py-2.5 px-3 font-sans">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${color}"></span>
            <span class="font-mono font-bold text-slate-900">${t}</span>
            <span class="text-xs text-slate-500 truncate">${stat.name !== t ? stat.name : ''}</span>
          </div>
        </td>
        <td class="py-2.5 px-3 text-right font-semibold text-slate-800">${sym}${stat.latest_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="py-2.5 px-3 text-right font-bold ${stat.expected_return >= 0 ? 'text-emerald-700' : 'text-rose-700'}">
          ${(stat.expected_return * 100).toFixed(2)}%
        </td>
        <td class="py-2.5 px-3 text-right text-slate-700">${(stat.volatility * 100).toFixed(2)}%</td>
        <td class="py-2.5 px-3 text-right text-rose-700">${(stat.max_drawdown * 100).toFixed(2)}%</td>
        <td class="py-2.5 px-3 text-right font-bold ${w > 0 ? 'text-blue-700' : 'text-slate-400'}">${w}%</td>
      </tr>
    `;
  }).join('');
}

function renderCorrelationAndGrowthPlots() {
  const data = state.optData;
  if (!data) return;

  // 1. Correlation Heatmap with annotated values
  const corrContainer = document.getElementById('correlation-plot-container');
  const corr = data.correlation;

  const corrTrace = {
    z: corr.matrix,
    x: corr.tickers,
    y: corr.tickers,
    text: corr.matrix.map(row => row.map(v => v.toFixed(2))),
    texttemplate: '%{text}',
    textfont: { family: 'JetBrains Mono', size: 11 },
    type: 'heatmap',
    colorscale: [
      [0.0, '#eff6ff'],
      [0.5, '#dbeafe'],
      [1.0, '#1e40af']
    ],
    zmin: -0.2,
    zmax: 1.0,
    showscale: false,
    hovertemplate: '<b>%{x} vs %{y}</b><br>ความสัมพันธ์: %{z:.2f}<extra></extra>'
  };

  const corrLayout = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 55, r: 15, t: 15, b: 40 },
    xaxis: { color: '#1e293b', tickfont: { family: 'JetBrains Mono', size: 11 } },
    yaxis: { color: '#1e293b', tickfont: { family: 'JetBrains Mono', size: 11 }, autorange: 'reversed' }
  };

  Plotly.newPlot(corrContainer, [corrTrace], corrLayout, { responsive: true, displayModeBar: false });

  // 2. Growth of 100 Plot
  renderGrowth100Plot();
}

function renderGrowth100Plot() {
  const data = state.optData;
  if (!data) return;

  const container = document.getElementById('growth-plot-container');
  const growth = data.growth_100;
  const tickers = data.metadata.tickers;

  const traces = tickers.map((t, idx) => ({
    x: growth.dates,
    y: growth.series[t],
    mode: 'lines',
    name: t,
    line: { color: ASSET_COLORS[idx % ASSET_COLORS.length], width: 2 },
    hovertemplate: `<b>${t}</b>: %{y:,.1f}<extra></extra>`
  }));

  const layout = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 50, r: 15, t: 20, b: 40 },
    xaxis: { gridcolor: '#f1f5f9', linecolor: '#e2e8f0', color: '#475569' },
    yaxis: {
      type: state.growthLogScale ? 'log' : 'linear',
      gridcolor: '#f1f5f9',
      linecolor: '#e2e8f0',
      color: '#475569'
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.14,
      font: { size: 10, color: '#334155' }
    },
    hovermode: 'x unified'
  };

  Plotly.newPlot(container, traces, layout, { responsive: true, displayModeBar: false });
}

function toggleGrowthScale(isLog) {
  state.growthLogScale = isLog;
  document.getElementById('btn-scale-log').className = isLog
    ? 'px-2 py-0.5 rounded bg-slate-900 text-white font-semibold'
    : 'px-2 py-0.5 rounded bg-slate-100 text-slate-600';
  document.getElementById('btn-scale-linear').className = !isLog
    ? 'px-2 py-0.5 rounded bg-slate-900 text-white font-semibold'
    : 'px-2 py-0.5 rounded bg-slate-100 text-slate-600';

  renderGrowth100Plot();
}

// Copy & Export Orders
function copyOrderSheet() {
  if (!state.optData) return;
  const strat = state.optData.strategies[state.activeGoal];
  const da = strat.discrete_allocation;
  const budget = state.optData.metadata.budget;
  const sym = state.currencySymbol;

  let text = `สรุปแผนการลงทุน — QuantFolio Wealth Analytics\n`;
  text += `เป้าหมาย: ${strat.name}\n`;
  text += `งบประมาณตั้งต้น: ${sym}${budget.toLocaleString()}\n`;
  text += `ผลตอบแทนคาดหวัง: ${(strat.expected_return * 100).toFixed(2)}% ต่อปี | ความผันผวน: ${(strat.volatility * 100).toFixed(2)}%\n`;
  text += `----------------------------------------\n`;
  da.allocations.forEach(a => {
    if (a.shares > 0) {
      text += `- ซื้อ ${a.ticker} (${a.name}): สัดส่วน ${(a.target_weight * 100).toFixed(1)}% -> ซื้อ ${a.shares} หุ้น (หรือ ${a.fractional_shares} หน่วย) @ ${sym}${a.current_price}\n`;
    } else {
      text += `- ซื้อ ${a.ticker} (${a.name}): สัดส่วน ${(a.target_weight * 100).toFixed(1)}% -> ซื้อแบบทศนิยม ${a.fractional_shares} หน่วย @ ${sym}${a.current_price}\n`;
    }
  });
  text += `----------------------------------------\n`;
  text += `ยอดใช้ซื้อหุ้นเต็มหน่วย: ${sym}${da.cash_spent.toLocaleString()} | เงินสดคงเหลือ: ${sym}${da.leftover.toLocaleString()}\n`;

  navigator.clipboard.writeText(text).then(() => {
    alert('คัดลอกใบสั่งซื้อเรียบร้อยแล้ว สามารถนำไปวางในบันทึกหรือใช้ส่งคำสั่งซื้อได้ทันที');
  });
}

function downloadOrderCSV() {
  if (!state.optData) return;
  const strat = state.optData.strategies[state.activeGoal];
  const da = strat.discrete_allocation;

  let csv = '\uFEFFSymbol,CompanyName,CurrentPrice,TargetWeightPct,TargetAmount,WholeSharesToBuy,FractionalShares,WholeShareCost\n';
  da.allocations.forEach(a => {
    csv += `"${a.ticker}","${a.name}",${a.current_price},${(a.target_weight * 100).toFixed(2)},${a.target_value},${a.shares},${a.fractional_shares},${a.allocated_value}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `QuantFolio_${state.activeGoal}_OrderPlan.csv`);
  link.click();
}

// Switch Bottom Analytics Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.className = 'tab-btn pb-3 text-xs font-semibold text-slate-500 hover:text-slate-800 border-b-2 border-transparent whitespace-nowrap transition';
  });

  const pane = document.getElementById(`tab-content-${tabId}`);
  const btn = document.getElementById(`tab-btn-${tabId}`);
  if (pane) pane.classList.remove('hidden');
  if (btn) {
    btn.className = 'tab-btn pb-3 text-xs font-bold text-blue-700 border-b-2 border-blue-700 whitespace-nowrap transition';
  }

  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 40);
}

// UI Helpers
function showLoading(show) {
  const card = document.getElementById('loading-card');
  const btn = document.getElementById('run-optimize-btn');
  if (show) {
    card.classList.remove('hidden');
    btn.disabled = true;
    btn.classList.add('opacity-60', 'cursor-not-allowed');
  } else {
    card.classList.add('hidden');
    btn.disabled = false;
    btn.classList.remove('opacity-60', 'cursor-not-allowed');
  }
}

function showError(msg) {
  document.getElementById('error-message').innerText = msg;
  document.getElementById('error-banner').classList.remove('hidden');
}

function hideError() {
  document.getElementById('error-banner').classList.add('hidden');
}
