"""
QuantFolio Pro - High Performance Portfolio Optimization Engine
Production-hardened with Thread-Safety & Multi-User TTL Caching
"""

import os
import time
import tempfile
import threading
import numpy as np
import pandas as pd

# Ensure matplotlib and yfinance caches have a writable directory inside cloud containers
os.environ.setdefault("MPLCONFIGDIR", os.path.join(tempfile.gettempdir(), "mpl_cache"))

import yfinance as yf
from typing import List, Dict, Any, Optional, Tuple

# SciPy monkeypatch for PyPortfolioOpt HRPOpt compatibility with newer scipy
import scipy.cluster.hierarchy as sch
if not hasattr(sch, '_LINKAGE_METHODS'):
    sch._LINKAGE_METHODS = {
        'single': 0, 'complete': 1, 'average': 2, 'centroid': 3,
        'median': 4, 'ward': 5, 'weighted': 6
    }

from pypfopt import expected_returns, risk_models, EfficientFrontier, HRPOpt
from pypfopt import DiscreteAllocation, get_latest_prices

# Set dedicated cache directory for yfinance in temp dir to prevent SQLite locking & permission issues
CACHE_DIR = os.path.join(tempfile.gettempdir(), 'quantfolio_yf_cache')
try:
    os.makedirs(CACHE_DIR, exist_ok=True)
    yf.set_tz_cache_location(CACHE_DIR)
except Exception:
    pass

TRADING_DAYS = 252

# Thread lock & in-memory TTL caches for multi-user concurrency
_yf_lock = threading.Lock()
_price_cache: Dict[Tuple, Tuple[float, pd.DataFrame, List[str], List[str]]] = {}
_rf_cache: Dict[str, Tuple[float, float]] = {}

PRICE_CACHE_TTL = 900   # 15 minutes
RF_CACHE_TTL = 3600     # 1 hour

# Well-known asset display names for institutional look
KNOWN_NAMES = {
    'NVDA': 'NVIDIA Corp.',
    'AAPL': 'Apple Inc.',
    'MSFT': 'Microsoft Corp.',
    'AMZN': 'Amazon.com Inc.',
    'TSLA': 'Tesla Inc.',
    'GOOGL': 'Alphabet Inc.',
    'GOOG': 'Alphabet Inc.',
    'META': 'Meta Platforms Inc.',
    'BRK-B': 'Berkshire Hathaway',
    'JPM': 'JPMorgan Chase & Co.',
    'V': 'Visa Inc.',
    'JNJ': 'Johnson & Johnson',
    'WMT': 'Walmart Inc.',
    'PG': 'Procter & Gamble',
    'MA': 'Mastercard Inc.',
    'KO': 'Coca-Cola Co.',
    'PEP': 'PepsiCo Inc.',
    'COST': 'Costco Wholesale',
    'AVGO': 'Broadcom Inc.',
    'AMD': 'Advanced Micro Devices',
    'NFLX': 'Netflix Inc.',
    'DIS': 'Walt Disney Co.',
    'SPY': 'SPDR S&P 500 ETF',
    'QQQ': 'Invesco QQQ Trust',
    'VOO': 'Vanguard S&P 500 ETF',
    'VTI': 'Vanguard Total Stock ETF',
    'GLD': 'SPDR Gold Shares ETF',
    'SLV': 'iShares Silver Trust',
    'TLT': 'iShares 20+ Yr Treasury ETF',
    'BND': 'Vanguard Total Bond ETF',
    'VNQ': 'Vanguard Real Estate ETF',
    'DBC': 'Invesco DB Commodity ETF',
    'BTC-USD': 'Bitcoin (USD)',
    'ETH-USD': 'Ethereum (USD)',
    'SOL-USD': 'Solana (USD)',
    'BNB-USD': 'BNB (USD)',
    'PTT.BK': 'บมจ. ปตท. (PTT)',
    'AOT.BK': 'บมจ. ท่าอากาศยานไทย (AOT)',
    'CPALL.BK': 'บมจ. ซีพี ออลล์ (CPALL)',
    'DELTA.BK': 'บมจ. เดลต้า อีเลคโทรนิคส์ (DELTA)',
    'BDMS.BK': 'บมจ. กรุงเทพดุสิตเวชการ (BDMS)',
    'ADVANC.BK': 'บมจ. แอดวานซ์ อินโฟร์ เซอร์วิส (AIS)',
    'SCB.BK': 'บมจ. เอสซีบี เอกซ์ (SCBX)',
    'KBANK.BK': 'บมจ. ธนาคารกสิกรไทย (KBANK)',
    'BBL.BK': 'บมจ. ธนาคารกรุงเทพ (BBL)',
    'PTTEP.BK': 'บมจ. ปตท.สผ. (PTTEP)',
    'SCC.BK': 'บมจ. ปูนซิเมนต์ไทย (SCG)',
    'GULF.BK': 'บมจ. กัลฟ์ เอ็นเนอร์จี (GULF)',
    'CPN.BK': 'บมจ. เซ็นทรัลพัฒนา (CPN)',
    'BH.BK': 'บมจ. โรงพยาบาลบำรุงราษฎร์ (BH)',
    'MINT.BK': 'บมจ. ไมเนอร์ อินเตอร์เนชั่นแนล (MINT)'
}


def get_asset_name(ticker: str) -> str:
    return KNOWN_NAMES.get(ticker.upper(), ticker.upper())


def get_risk_free_rate(default_rate: float = 0.04) -> float:
    """Fetch current 13-week US Treasury Bill yield (^IRX) with 1-hour cache."""
    now = time.time()
    if 'rf' in _rf_cache:
        ts, cached_val = _rf_cache['rf']
        if now - ts < RF_CACHE_TTL:
            return cached_val

    try:
        with _yf_lock:
            irx = yf.download('^IRX', period='1mo', auto_adjust=True, progress=False)['Close']
        if not irx.empty:
            clean = irx.dropna()
            if not clean.empty:
                val = clean.iloc[-1]
                latest = float(val.values[0]) if hasattr(val, 'values') else float(val)
                rate = round(latest / 100.0, 4)
                _rf_cache['rf'] = (now, rate)
                return rate
    except Exception as e:
        print(f"Notice: Failed to fetch ^IRX ({e}), using default {default_rate:.2%}")

    _rf_cache['rf'] = (now, default_rate)
    return default_rate


def fetch_historical_prices(
    tickers: List[str],
    start_date: str,
    end_date: str
) -> Tuple[pd.DataFrame, List[str], List[str]]:
    """
    Download adjusted close prices for tickers between start_date and end_date.
    Thread-safe and cached for multi-user performance.
    """
    clean_tickers = []
    for t in tickers:
        s = t.strip().upper()
        if s and s not in clean_tickers:
            clean_tickers.append(s)

    if not clean_tickers:
        raise ValueError("กรุณาเลือกสินทรัพย์อย่างน้อย 2 รายการ")

    cache_key = (tuple(clean_tickers), start_date, end_date)
    now = time.time()
    if cache_key in _price_cache:
        ts, cached_df, cached_valid, cached_missing = _price_cache[cache_key]
        if now - ts < PRICE_CACHE_TTL:
            return cached_df.copy(), list(cached_valid), list(cached_missing)

    try:
        with _yf_lock:
            raw = yf.download(
                clean_tickers,
                start=start_date,
                end=end_date,
                auto_adjust=True,
                progress=False
            )
    except Exception as e:
        raise ValueError(f"ไม่สามารถดึงข้อมูลจาก Yahoo Finance ได้: {str(e)}")

    if raw.empty:
        raise ValueError(f"ไม่พบข้อมูลราคาของ {clean_tickers} ในช่วงเวลา {start_date} ถึง {end_date}")

    if 'Close' in raw.columns:
        close_df = raw['Close']
    else:
        close_df = raw

    if isinstance(close_df, pd.Series):
        close_df = close_df.to_frame(name=clean_tickers[0])

    valid_tickers = []
    missing_tickers = []

    for t in clean_tickers:
        if t in close_df.columns and not close_df[t].dropna().empty:
            valid_tickers.append(t)
        else:
            missing_tickers.append(t)

    if len(valid_tickers) < 2:
        raise ValueError(
            f"ต้องมีสินทรัพย์ที่มีข้อมูลราคาสมบูรณ์อย่างน้อย 2 รายการขึ้นไป "
            f"(พบข้อมูล: {valid_tickers}, ไม่พบข้อมูล: {missing_tickers})"
        )

    prices = close_df[valid_tickers].dropna()

    if len(prices) < 20:
        raise ValueError(f"จำนวนวันทำการที่ข้อมูลทับซ้อนกันน้อยเกินไป ({len(prices)} วัน) กรุณาขยายช่วงเวลาให้กว้างขึ้น")

    # Save to cache (limit cache size to 100 entries)
    if len(_price_cache) > 100:
        _price_cache.clear()
    _price_cache[cache_key] = (now, prices.copy(), list(valid_tickers), list(missing_tickers))

    return prices, valid_tickers, missing_tickers


def compute_max_drawdown(wealth_series: pd.Series) -> float:
    """Compute maximum percentage drawdown from peak."""
    running_max = wealth_series.cummax()
    drawdown = (wealth_series - running_max) / running_max
    return float(drawdown.min())


def compute_discrete_allocation(
    weights: Dict[str, float],
    latest_prices: pd.Series,
    budget: float
) -> Dict[str, Any]:
    """Calculate integer share quantities, fractional shares, and leftover cash."""
    try:
        active_weights = {k: v for k, v in weights.items() if v > 0.0001}
        if not active_weights:
            return {"shares": {}, "leftover": budget, "cash_spent": 0, "allocated_percent": 0, "allocations": []}

        sub_prices = latest_prices[list(active_weights.keys())]
        da = DiscreteAllocation(active_weights, sub_prices, total_portfolio_value=budget)
        shares, leftover = da.greedy_portfolio()

        allocations = []
        total_spent = 0.0
        sorted_keys = sorted(active_weights.keys(), key=lambda x: active_weights[x], reverse=True)

        for ticker in sorted_keys:
            n_shares = int(shares.get(ticker, 0))
            price = float(sub_prices[ticker])
            target_dollar = budget * float(active_weights[ticker])
            fractional = round(target_dollar / price, 4) if price > 0 else 0.0
            val = n_shares * price
            total_spent += val
            allocations.append({
                "ticker": ticker,
                "name": get_asset_name(ticker),
                "target_weight": round(float(active_weights[ticker]), 4),
                "target_value": round(target_dollar, 2),
                "current_price": round(price, 2),
                "shares": n_shares,
                "fractional_shares": fractional,
                "allocated_value": round(val, 2),
                "actual_weight": round(val / budget, 4) if budget > 0 else 0
            })

        return {
            "shares": {k: int(v) for k, v in shares.items()},
            "leftover": round(float(leftover), 2),
            "cash_spent": round(total_spent, 2),
            "allocated_percent": round((total_spent / budget) * 100, 2) if budget > 0 else 0,
            "allocations": allocations
        }
    except Exception as e:
        print(f"Error in discrete allocation: {e}")
        return {"shares": {}, "leftover": budget, "cash_spent": 0, "allocated_percent": 0, "allocations": []}


def run_portfolio_optimization(
    tickers: List[str],
    start_date: str,
    end_date: str,
    budget: float = 10000.0,
    max_weight: float = 1.0,
    min_weight: float = 0.0,
    risk_free_rate: Optional[float] = None,
    num_simulations: int = 3500,
    backtest_split: Optional[str] = None
) -> Dict[str, Any]:
    """
    Execute full Markowitz, HRP, Monte Carlo, and Portfolio Growth calculations.
    """
    prices, valid_tickers, missing_tickers = fetch_historical_prices(tickers, start_date, end_date)

    if risk_free_rate is None or risk_free_rate <= 0:
        rf_rate = get_risk_free_rate()
    else:
        rf_rate = float(risk_free_rate)

    # 1. Expected Returns (CAGR) & Covariance Shrinkage (Ledoit-Wolf)
    mu = expected_returns.mean_historical_return(prices, frequency=TRADING_DAYS)
    S = risk_models.CovarianceShrinkage(prices, frequency=TRADING_DAYS).ledoit_wolf()
    returns_df = prices.pct_change().dropna()

    vols = np.sqrt(np.diag(S))
    asset_stats = []
    latest_prices = get_latest_prices(prices)

    for i, t in enumerate(valid_tickers):
        ret_val = float(mu[t])
        vol_val = float(vols[i])
        sr_val = (ret_val - rf_rate) / vol_val if vol_val > 0 else 0
        asset_wealth = (1 + returns_df[t]).cumprod()
        asset_mdd = compute_max_drawdown(asset_wealth)
        total_cum_return = float((prices[t].iloc[-1] / prices[t].iloc[0]) - 1.0)

        asset_stats.append({
            "ticker": t,
            "name": get_asset_name(t),
            "expected_return": round(ret_val, 4),
            "total_return": round(total_cum_return, 4),
            "volatility": round(vol_val, 4),
            "max_drawdown": round(asset_mdd, 4),
            "sharpe_ratio": round(sr_val, 3),
            "latest_price": round(float(latest_prices[t]), 2)
        })

    corr_df = risk_models.cov_to_corr(S)
    correlation_data = {
        "tickers": valid_tickers,
        "names": [get_asset_name(t) for t in valid_tickers],
        "matrix": [[round(float(corr_df.loc[r, c]), 3) for c in valid_tickers] for r in valid_tickers]
    }

    # 2. Optimization Models
    min_feasible_max_weight = round(1.0 / len(valid_tickers) + 0.01, 2)
    effective_max_weight = max(max_weight, min_feasible_max_weight)
    weight_bounds = (min_weight, min(1.0, effective_max_weight))

    # Model A: Minimum Volatility
    ef_min = EfficientFrontier(mu, S, weight_bounds=weight_bounds)
    ef_min.min_volatility()
    w_min = ef_min.clean_weights()
    ret_min, vol_min, sr_min = ef_min.portfolio_performance(risk_free_rate=rf_rate)
    da_min = compute_discrete_allocation(w_min, latest_prices, budget)

    # Model B: Maximum Sharpe Ratio
    max_sharpe_error = None
    try:
        ef_max = EfficientFrontier(mu, S, weight_bounds=weight_bounds)
        ef_max.max_sharpe(risk_free_rate=rf_rate)
        w_max = ef_max.clean_weights()
        ret_max, vol_max, sr_max = ef_max.portfolio_performance(risk_free_rate=rf_rate)
    except Exception as e:
        max_sharpe_error = str(e)
        ef_max = EfficientFrontier(mu, S, weight_bounds=weight_bounds)
        ef_max.min_volatility()
        w_max = ef_max.clean_weights()
        ret_max, vol_max, sr_max = ef_max.portfolio_performance(risk_free_rate=rf_rate)

    da_max = compute_discrete_allocation(w_max, latest_prices, budget)

    # Model C: Equal Weight (1/N)
    w_eq = {t: 1.0 / len(valid_tickers) for t in valid_tickers}
    w_eq_series = pd.Series(w_eq)
    ret_eq = float(w_eq_series @ mu)
    vol_eq = float(np.sqrt(w_eq_series @ S @ w_eq_series))
    sr_eq = (ret_eq - rf_rate) / vol_eq if vol_eq > 0 else 0
    da_eq = compute_discrete_allocation(w_eq, latest_prices, budget)

    # Model D: Hierarchical Risk Parity (HRP)
    hrp = HRPOpt(returns_df)
    w_hrp_raw = hrp.optimize()
    w_hrp = {t: float(w_hrp_raw.get(t, 0.0)) for t in valid_tickers}
    w_hrp_series = pd.Series(w_hrp)
    ret_hrp = float(w_hrp_series @ mu)
    vol_hrp = float(np.sqrt(w_hrp_series @ S @ w_hrp_series))
    sr_hrp = (ret_hrp - rf_rate) / vol_hrp if vol_hrp > 0 else 0
    da_hrp = compute_discrete_allocation(w_hrp, latest_prices, budget)

    # 3. Historical Portfolio Wealth Simulation (Starting with `budget` capital)
    strat_weights_map = {
        "max_sharpe": pd.Series(w_max),
        "min_volatility": pd.Series(w_min),
        "hrp": pd.Series(w_hrp),
        "equal_weight": pd.Series(w_eq)
    }

    strat_wealth_df = pd.DataFrame(index=returns_df.index)
    strat_drawdowns = {}
    strat_final_values = {}

    for key, w_s in strat_weights_map.items():
        w_aligned = w_s.reindex(valid_tickers).fillna(0.0)
        port_daily_ret = returns_df[valid_tickers] @ w_aligned
        cum_growth = (1.0 + port_daily_ret).cumprod()
        strat_wealth_df[key] = (cum_growth * budget).round(2)
        strat_drawdowns[key] = round(compute_max_drawdown(cum_growth), 4)
        strat_final_values[key] = round(float(strat_wealth_df[key].iloc[-1]), 2)

    step = max(1, len(strat_wealth_df) // 160)
    sampled_wealth = strat_wealth_df.iloc[::step]
    if strat_wealth_df.index[-1] not in sampled_wealth.index:
        sampled_wealth = pd.concat([sampled_wealth, strat_wealth_df.iloc[[-1]]])

    portfolio_growth_chart = {
        "dates": [d.strftime('%Y-%m-%d') for d in sampled_wealth.index],
        "series": {
            k: sampled_wealth[k].tolist() for k in strat_weights_map.keys()
        }
    }

    # 4. Monte Carlo Random Portfolios for Efficient Frontier
    rng = np.random.default_rng(42)
    W_rand = rng.dirichlet(np.ones(len(valid_tickers)), num_simulations)
    valid_mask = (W_rand <= (effective_max_weight + 1e-6)).all(axis=1)
    if valid_mask.sum() > 200:
        W_rand = W_rand[valid_mask]

    rand_rets = (W_rand * mu.values).sum(axis=1)
    rand_vols = np.sqrt(np.einsum('ij,jk,ik->i', W_rand, S.values, W_rand))
    rand_sr = np.where(rand_vols > 0, (rand_rets - rf_rate) / rand_vols, 0)

    sample_size = min(len(rand_rets), 1800)
    indices = np.linspace(0, len(rand_rets) - 1, sample_size, dtype=int)

    monte_carlo_points = [
        {
            "vol": round(float(rand_vols[idx]), 4),
            "ret": round(float(rand_rets[idx]), 4),
            "sharpe": round(float(rand_sr[idx]), 3)
        }
        for idx in indices
    ]

    frontier_curve = []
    try:
        min_target = float(ret_min)
        max_target = float(ret_min + 0.95 * (mu.max() - ret_min))
        if max_target > min_target:
            target_returns = np.linspace(min_target, max_target, 35)
            for tr in target_returns:
                try:
                    ef_curve = EfficientFrontier(mu, S, weight_bounds=weight_bounds)
                    ef_curve.efficient_return(tr)
                    r_perf, v_perf, s_perf = ef_curve.portfolio_performance(risk_free_rate=rf_rate)
                    frontier_curve.append({
                        "vol": round(float(v_perf), 4),
                        "ret": round(float(r_perf), 4),
                        "sharpe": round(float(s_perf), 3)
                    })
                except Exception:
                    continue
    except Exception:
        pass

    growth_100 = (prices / prices.iloc[0] * 100).round(2)
    growth_sampled = growth_100.iloc[::step]
    if growth_100.index[-1] not in growth_sampled.index:
        growth_sampled = pd.concat([growth_sampled, growth_100.iloc[[-1]]])

    growth_chart_data = {
        "dates": [d.strftime('%Y-%m-%d') for d in growth_sampled.index],
        "series": {t: growth_sampled[t].tolist() for t in valid_tickers}
    }

    return {
        "status": "success",
        "metadata": {
            "tickers": valid_tickers,
            "missing_tickers": missing_tickers,
            "start_date": prices.index[0].strftime('%Y-%m-%d'),
            "end_date": prices.index[-1].strftime('%Y-%m-%d'),
            "trading_days": len(prices),
            "risk_free_rate": round(rf_rate, 4),
            "budget": budget,
            "max_weight": effective_max_weight
        },
        "asset_stats": asset_stats,
        "correlation": correlation_data,
        "growth_100": growth_chart_data,
        "portfolio_growth": portfolio_growth_chart,
        "strategies": {
            "max_sharpe": {
                "key": "max_sharpe",
                "name": "พอร์ตผลตอบแทนคุ้มความเสี่ยงสูงสุด (Max Sharpe)",
                "short_name": "Max Sharpe Ratio",
                "tagline": "เหมาะสำหรับผู้ที่ต้องการผลตอบแทนเติบโตสูงสุดเมื่อเทียบกับความเสี่ยงที่รับได้",
                "weights": {k: round(float(v), 4) for k, v in w_max.items()},
                "expected_return": round(float(ret_max), 4),
                "expected_annual_profit": round(float(ret_max * budget), 2),
                "volatility": round(float(vol_max), 4),
                "max_drawdown": strat_drawdowns["max_sharpe"],
                "final_historical_value": strat_final_values["max_sharpe"],
                "sharpe_ratio": round(float(sr_max), 2),
                "discrete_allocation": da_max,
                "error_notice": max_sharpe_error
            },
            "min_volatility": {
                "key": "min_volatility",
                "name": "พอร์ตความเสี่ยงต่ำ ผันผวนน้อย (Min Volatility)",
                "short_name": "Min Volatility",
                "tagline": "เหมาะสำหรับผู้ที่เน้นรักษาเงินต้น ลดการแกว่งตัวของพอร์ตในช่วงตลาดผันผวน",
                "weights": {k: round(float(v), 4) for k, v in w_min.items()},
                "expected_return": round(float(ret_min), 4),
                "expected_annual_profit": round(float(ret_min * budget), 2),
                "volatility": round(float(vol_min), 4),
                "max_drawdown": strat_drawdowns["min_volatility"],
                "final_historical_value": strat_final_values["min_volatility"],
                "sharpe_ratio": round(float(sr_min), 2),
                "discrete_allocation": da_min
            },
            "hrp": {
                "key": "hrp",
                "name": "พอร์ตกระจายความเสี่ยงสมดุล (Risk Parity / HRP)",
                "short_name": "Risk Parity (HRP)",
                "tagline": "จัดกลุ่มสินทรัพย์ด้วย Machine Learning เพื่อกระจายความเสี่ยงอย่างสมดุล ไม่กระจุกตัว",
                "weights": {k: round(float(v), 4) for k, v in w_hrp.items()},
                "expected_return": round(float(ret_hrp), 4),
                "expected_annual_profit": round(float(ret_hrp * budget), 2),
                "volatility": round(float(vol_hrp), 4),
                "max_drawdown": strat_drawdowns["hrp"],
                "final_historical_value": strat_final_values["hrp"],
                "sharpe_ratio": round(float(sr_hrp), 2),
                "discrete_allocation": da_hrp
            },
            "equal_weight": {
                "key": "equal_weight",
                "name": "พอร์ตลงทุนสัดส่วนเท่ากัน (Equal Weight 1/N)",
                "short_name": "Equal Weight (1/N)",
                "tagline": "แบ่งเงินลงทุนเท่ากันในสินทรัพย์ทุกตัว ใช้เป็นเกณฑ์มาตรฐานเปรียบเทียบ",
                "weights": {k: round(float(v), 4) for k, v in w_eq.items()},
                "expected_return": round(float(ret_eq), 4),
                "expected_annual_profit": round(float(ret_eq * budget), 2),
                "volatility": round(float(vol_eq), 4),
                "max_drawdown": strat_drawdowns["equal_weight"],
                "final_historical_value": strat_final_values["equal_weight"],
                "sharpe_ratio": round(float(sr_eq), 2),
                "discrete_allocation": da_eq
            }
        },
        "efficient_frontier": {
            "monte_carlo": monte_carlo_points,
            "curve": frontier_curve
        }
    }
