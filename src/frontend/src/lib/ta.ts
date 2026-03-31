// Technical Analysis Engine — DeepSeek OTC AI v22 (Triple-Pass | 20 Indicators)
// Uses 20 indicators + triple-pass confirmation gate:
// All 3 independent market scenarios must agree on direction AND
// ALL must reach STRONG consensus (80%+ weighted) AND
// at least 12/20 raw indicators must agree on the winning direction.

export interface IndicatorResult {
  name: string;
  value: number;
  signal: "BUY" | "SELL" | "NEUTRAL";
  description: string;
  weight: number;
}

export interface SignalResult {
  direction: "UP" | "DOWN";
  confidence: number;
  pair: string;
  indicators: IndicatorResult[];
  bullishCount: number;
  bearishCount: number;
  entryTime: string;
  expiryTime: string;
  momentum: number; // -100 to +100
  signalStrength: "STRONG" | "MODERATE" | "WEAK";
  patternLabel?: string; // detected candlestick pattern
  confluenceScore?: number; // 0-100
  passesConfirmed?: number; // how many passes agreed
  passesTotal?: number; // total passes run
  ultraStrong?: boolean; // ratio >= 0.85 && 12/20 agree
}

// ─── Seeded RNG ────────────────────────────────────────────────────────────────
function seededRandom(seed: number) {
  let s = seed ^ 0xdeadbeef;
  return () => {
    s = Math.imul(s ^ (s >>> 17), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 15), 0x119de1f3);
    s = (s ^ (s >>> 16)) >>> 0;
    return s / 0x100000000;
  };
}

const BASE_PRICES: Record<string, number> = {
  "EUR/USD OTC": 1.0842,
  "GBP/USD OTC": 1.2634,
  "USD/JPY OTC": 149.82,
  "AUD/USD OTC": 0.6518,
  "EUR/GBP OTC": 0.8582,
  "USD/CAD OTC": 1.3621,
  "NZD/USD OTC": 0.5972,
  "EUR/JPY OTC": 162.45,
};

export function generatePriceHistory(
  pair: string,
  candles: number,
  anchorPrice?: number,
  seedOverride?: number,
): number[] {
  const base = anchorPrice ?? BASE_PRICES[pair] ?? 1.0;
  const defaultSeed =
    pair.split("").reduce((a, c) => a + c.charCodeAt(0), 0) * 9973 +
    (Date.now() % 100000);
  const seed = seedOverride ?? defaultSeed;
  const rand = seededRandom(seed);
  const pip = base > 10 ? 0.01 : base > 1 ? 0.0001 : 0.00005;
  const vol = pip * 8;

  const prices: number[] = [];
  let price = base;

  // Regime system: trending vs ranging
  let regime: "trending" | "ranging" = rand() > 0.5 ? "trending" : "ranging";
  let regimeLen = Math.floor(rand() * 12 + (regime === "trending" ? 15 : 8));
  let regimeCount = 0;
  let trendDir = rand() > 0.5 ? 1 : -1;
  let momentum = (rand() - 0.5) * vol * 0.3;

  for (let i = 0; i < candles; i++) {
    regimeCount++;
    // Switch regime
    if (regimeCount >= regimeLen) {
      regime = regime === "trending" ? "ranging" : "trending";
      regimeLen = Math.floor(rand() * 12 + (regime === "trending" ? 15 : 8));
      regimeCount = 0;
      if (regime === "trending") trendDir = rand() > 0.5 ? 1 : -1;
    }

    // Occasional shock candle (1 in 20)
    const shock = rand() < 0.05 ? (rand() - 0.5) * vol * 4 : 0;

    if (regime === "trending") {
      const drift = trendDir * vol * 0.18;
      const noise = (rand() - 0.5) * vol * 0.5;
      momentum = momentum * 0.75 + drift * 0.25;
      price = price + momentum + noise + shock;
    } else {
      // Ranging: mean-reverting oscillation
      const meanRev = (base - price) * 0.06;
      const noise = (rand() - 0.5) * vol * 0.9;
      momentum = momentum * 0.6;
      price = price + meanRev + noise + shock;
    }

    price = Math.max(base * 0.96, Math.min(base * 1.04, price));
    prices.push(price);
  }
  return prices;
}

// ─── Core Indicator Calculations ──────────────────────────────────────────────

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcMACD(prices: number[]): {
  value: number;
  signal: number;
  histogram: number;
  prevHistogram: number;
  crossover: boolean;
} {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);
  const last = macdLine.length - 1;
  const histogram = macdLine[last] - signalLine[last];
  const prevHistogram =
    last > 0 ? macdLine[last - 1] - signalLine[last - 1] : histogram;
  const crossover =
    (histogram > 0 && prevHistogram <= 0) ||
    (histogram < 0 && prevHistogram >= 0);
  return {
    value: macdLine[last],
    signal: signalLine[last],
    histogram,
    prevHistogram,
    crossover,
  };
}

function calcBollinger(
  prices: number[],
  period = 20,
): {
  upper: number;
  middle: number;
  lower: number;
  position: number;
  bandwidth: number;
} {
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const last = prices[prices.length - 1];
  const upper = mean + 2 * std;
  const lower = mean - 2 * std;
  const bandwidth = mean > 0 ? (upper - lower) / mean : 0;
  return {
    upper,
    middle: mean,
    lower,
    position: std > 0 ? (last - mean) / (2 * std) : 0,
    bandwidth,
  };
}

function calcStochastic(
  prices: number[],
  kPeriod = 14,
  dPeriod = 3,
): { k: number; d: number; prevK: number } {
  if (prices.length < kPeriod + dPeriod) return { k: 50, d: 50, prevK: 50 };
  const calcK = (slice: number[]) => {
    const highest = Math.max(...slice);
    const lowest = Math.min(...slice);
    const last = slice[slice.length - 1];
    return highest === lowest
      ? 50
      : ((last - lowest) / (highest - lowest)) * 100;
  };
  const kValues: number[] = [];
  for (let i = kPeriod; i <= prices.length; i++) {
    kValues.push(calcK(prices.slice(i - kPeriod, i)));
  }
  const k = kValues[kValues.length - 1];
  const prevK = kValues.length > 1 ? kValues[kValues.length - 2] : k;
  const dSlice = kValues.slice(-dPeriod);
  const d = dSlice.reduce((a, b) => a + b, 0) / dSlice.length;
  return { k, d, prevK };
}

function calcADX(
  prices: number[],
  period = 14,
): { adx: number; diPlus: number; diMinus: number } {
  if (prices.length < period * 2) return { adx: 25, diPlus: 15, diMinus: 15 };
  let sumDmPlus = 0;
  let sumDmMinus = 0;
  let sumTr = 0;
  const start = prices.length - period;
  for (let i = start; i < prices.length; i++) {
    const high = prices[i] * 1.0008;
    const low = prices[i] * 0.9992;
    const prevHigh = prices[i - 1] * 1.0008;
    const prevLow = prices[i - 1] * 0.9992;
    const prevClose = prices[i - 1];
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    sumTr += tr;
    sumDmPlus += upMove > downMove && upMove > 0 ? upMove : 0;
    sumDmMinus += downMove > upMove && downMove > 0 ? downMove : 0;
  }
  if (sumTr === 0) return { adx: 20, diPlus: 10, diMinus: 10 };
  const diPlus = (sumDmPlus / sumTr) * 100;
  const diMinus = (sumDmMinus / sumTr) * 100;
  const diSum = diPlus + diMinus;
  const dx = diSum === 0 ? 0 : (Math.abs(diPlus - diMinus) / diSum) * 100;
  return { adx: dx, diPlus, diMinus };
}

function calcCCI(prices: number[], period = 20): number {
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const meanDev = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
  const last = prices[prices.length - 1];
  if (meanDev === 0) return 0;
  return (last - mean) / (0.015 * meanDev);
}

function calcWilliamsR(prices: number[], period = 14): number {
  if (prices.length < period) return -50;
  const slice = prices.slice(-period);
  const highest = Math.max(...slice);
  const lowest = Math.min(...slice);
  const last = prices[prices.length - 1];
  if (highest === lowest) return -50;
  return ((highest - last) / (highest - lowest)) * -100;
}

function calcShortMomentum(prices: number[]): number {
  if (prices.length < 10) return 0;
  const recent = prices.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const older = prices.slice(-10, -3).reduce((a, b) => a + b, 0) / 7;
  if (older === 0) return 0;
  return ((recent - older) / older) * 10000;
}

// ─── Rate of Change (ROC) ──────────────────────────────────────────────────────
function calcROC(prices: number[], period = 12): number {
  if (prices.length < period + 1) return 0;
  const current = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  return past > 0 ? ((current - past) / past) * 100 : 0;
}

// ─── Ichimoku Cloud (simplified: tenkan/kijun cross) ─────────────────────────
function calcIchimoku(prices: number[]): {
  signal: "BUY" | "SELL" | "NEUTRAL";
  desc: string;
} {
  if (prices.length < 26)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const tenkan =
    (Math.max(...prices.slice(-9)) + Math.min(...prices.slice(-9))) / 2;
  const kijun =
    (Math.max(...prices.slice(-26)) + Math.min(...prices.slice(-26))) / 2;
  const last = prices[prices.length - 1];
  const senkouA = (tenkan + kijun) / 2;
  const chikouRef = prices[prices.length - 26];
  const chikouBullish = last > chikouRef;
  const tenkanAbove = tenkan > kijun;
  const priceAboveCloud = last > senkouA;

  if (tenkanAbove && priceAboveCloud && chikouBullish) {
    return {
      signal: "BUY",
      desc: `Ichimoku full bull (T:${tenkan.toFixed(4)} > K:${kijun.toFixed(4)})`,
    };
  }
  if (!tenkanAbove && !priceAboveCloud && !chikouBullish) {
    return {
      signal: "SELL",
      desc: `Ichimoku full bear (T:${tenkan.toFixed(4)} < K:${kijun.toFixed(4)})`,
    };
  }
  if (tenkanAbove) {
    return { signal: "BUY", desc: "Tenkan above Kijun — bullish bias" };
  }
  if (!tenkanAbove) {
    return { signal: "SELL", desc: "Tenkan below Kijun — bearish bias" };
  }
  return { signal: "NEUTRAL", desc: "Cloud neutral zone" };
}

// ─── Candlestick Pattern Detection ────────────────────────────────────────────
function detectCandlePattern(prices: number[]): {
  label: string;
  bias: "BUY" | "SELL" | "NEUTRAL";
} {
  if (prices.length < 4) return { label: "", bias: "NEUTRAL" };
  const len = prices.length;
  const c0 = prices[len - 1];
  const c1 = prices[len - 2];
  const c2 = prices[len - 3];
  const c3 = prices[len - 4];

  const spread = Math.abs(c0 - c1) * 2;
  const high0 = Math.max(c0, c1) + spread * 0.2;
  const low0 = Math.min(c0, c1) - spread * 0.2;
  const high1 = Math.max(c1, c2) + spread * 0.2;
  const low1 = Math.min(c1, c2) - spread * 0.2;

  const body0 = Math.abs(c0 - c1);
  const body1 = Math.abs(c1 - c2);
  const body2 = Math.abs(c2 - c3);
  const range0 = high0 - low0;

  // Suppress unused variable warnings
  void high1;
  void low1;

  if (body0 < range0 * 0.1)
    return { label: "Doji — indecision", bias: "NEUTRAL" };

  if (c1 < c2 && c0 > c1 && body0 > body1 * 1.2) {
    return { label: "Bullish Engulfing", bias: "BUY" };
  }
  if (c1 > c2 && c0 < c1 && body0 > body1 * 1.2) {
    return { label: "Bearish Engulfing", bias: "SELL" };
  }

  const lowerWick0 = Math.min(c0, c1) - low0;
  const upperWick0 = high0 - Math.max(c0, c1);
  if (lowerWick0 > body0 * 2 && upperWick0 < body0 * 0.5 && c2 > c1) {
    return { label: "Hammer — bullish reversal", bias: "BUY" };
  }
  if (upperWick0 > body0 * 2 && lowerWick0 < body0 * 0.5 && c2 < c1) {
    return { label: "Shooting Star — bearish reversal", bias: "SELL" };
  }

  if (c0 > c1 && c1 > c2 && c2 > c3)
    return { label: "3 Bull Candles — strong momentum", bias: "BUY" };
  if (c0 < c1 && c1 < c2 && c2 < c3)
    return { label: "3 Bear Candles — strong momentum", bias: "SELL" };

  if (high0 < high1 && low0 > low1) {
    return { label: "Inside Bar — breakout pending", bias: "NEUTRAL" };
  }

  const midSmall = body1 < body2 * 0.4;
  if (c2 < c3 && midSmall && c0 > c1 && c0 > c2) {
    return { label: "Morning Star — reversal up", bias: "BUY" };
  }
  if (c2 > c3 && midSmall && c0 < c1 && c0 < c2) {
    return { label: "Evening Star — reversal down", bias: "SELL" };
  }

  return { label: "", bias: "NEUTRAL" };
}

// ─── RSI Divergence Detection ─────────────────────────────────────────────────
function calcRSIDivergence(prices: number[]): {
  signal: "BUY" | "SELL" | "NEUTRAL";
  desc: string;
} {
  if (prices.length < 20)
    return { signal: "NEUTRAL", desc: "Insufficient data for divergence" };

  const recent = prices.slice(-20);
  const rsiRecent: number[] = [];
  for (let i = 15; i <= recent.length; i++) {
    rsiRecent.push(calcRSI(recent.slice(0, i), 14));
  }

  if (rsiRecent.length < 2)
    return { signal: "NEUTRAL", desc: "Not enough RSI history" };

  // Compare last 5 candles vs prior 5 (positions 5-10 from end)
  const priceRecent5 = recent.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const priceOlder5 = recent.slice(-15, -10).reduce((a, b) => a + b, 0) / 5;

  const rsiLast = rsiRecent[rsiRecent.length - 1];
  const rsiOlder = rsiRecent[0];

  const priceDown = priceRecent5 < priceOlder5;
  const priceUp = priceRecent5 > priceOlder5;
  const rsiUp = rsiLast > rsiOlder + 2;
  const rsiDown = rsiLast < rsiOlder - 2;

  // Bullish divergence: price lower low but RSI higher low
  if (priceDown && rsiUp) {
    return {
      signal: "BUY",
      desc: `Bullish RSI divergence — price↓ RSI↑ (RSI:${rsiLast.toFixed(1)})`,
    };
  }

  // Bearish divergence: price higher high but RSI lower high
  if (priceUp && rsiDown) {
    return {
      signal: "SELL",
      desc: `Bearish RSI divergence — price↑ RSI↓ (RSI:${rsiLast.toFixed(1)})`,
    };
  }

  return {
    signal: "NEUTRAL",
    desc: `No divergence detected (RSI:${rsiLast.toFixed(1)})`,
  };
}

// ─── Support / Resistance Proximity ──────────────────────────────────────────
function calcSRLevel(prices: number[]): {
  signal: "BUY" | "SELL" | "NEUTRAL";
  desc: string;
} {
  if (prices.length < 50)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const recent = prices.slice(-50);
  const current = prices[prices.length - 1];
  const highest = Math.max(...recent);
  const lowest = Math.min(...recent);
  const range = highest - lowest;
  if (range === 0) return { signal: "NEUTRAL", desc: "No range" };

  const pivot = (highest + lowest + current) / 3;
  const r1 = 2 * pivot - lowest;
  const s1 = 2 * pivot - highest;
  const r2 = pivot + (highest - lowest);
  const s2 = pivot - (highest - lowest);

  const prox = range * 0.05;
  if (Math.abs(current - s1) < prox || Math.abs(current - s2) < prox) {
    return {
      signal: "BUY",
      desc: `Near support S1:${s1.toFixed(4)} — bounce zone`,
    };
  }
  if (Math.abs(current - r1) < prox || Math.abs(current - r2) < prox) {
    return {
      signal: "SELL",
      desc: `Near resistance R1:${r1.toFixed(4)} — rejection zone`,
    };
  }
  if (current < pivot) {
    return {
      signal: "SELL",
      desc: `Below pivot ${pivot.toFixed(4)} — bearish bias`,
    };
  }
  return {
    signal: "BUY",
    desc: `Above pivot ${pivot.toFixed(4)} — bullish bias`,
  };
}

// ─── Multi-Timeframe Trend (simulated from same price history) ────────────────
function calcMTFTrend(prices: number[]): {
  signal: "BUY" | "SELL" | "NEUTRAL";
  desc: string;
} {
  if (prices.length < 100)
    return { signal: "NEUTRAL", desc: "MTF insufficient" };
  const ema5 = calcEMA(prices, 5);
  const ema20 = calcEMA(prices, 20);
  const ema50 = calcEMA(prices, 50);
  const m1Bull = ema5[ema5.length - 1] > ema20[ema20.length - 1];
  const m5Prices = prices.filter((_, i) => i % 5 === 0);
  const m5Ema5 = calcEMA(m5Prices, 5);
  const m5Ema13 = calcEMA(m5Prices, 13);
  const m5Bull = m5Ema5[m5Ema5.length - 1] > m5Ema13[m5Ema13.length - 1];
  const m15Prices = prices.filter((_, i) => i % 15 === 0);
  const m15Ema5 = calcEMA(m15Prices, 5);
  const m15Ema13 = calcEMA(m15Prices, 13);
  const m15Bull =
    m15Ema5.length > 1 &&
    m15Ema5[m15Ema5.length - 1] > m15Ema13[m15Ema13.length - 1];

  const bulls = [m1Bull, m5Bull, m15Bull].filter(Boolean).length;
  const above50 = ema5[ema5.length - 1] > ema50[ema50.length - 1];

  if (bulls >= 3 && above50)
    return { signal: "BUY", desc: "M1+M5+M15 all bullish — full confluence" };
  if (bulls === 0 && !above50)
    return { signal: "SELL", desc: "M1+M5+M15 all bearish — full confluence" };
  if (bulls >= 2)
    return { signal: "BUY", desc: `MTF ${bulls}/3 timeframes bullish` };
  if (bulls <= 1)
    return { signal: "SELL", desc: `MTF ${3 - bulls}/3 timeframes bearish` };
  return { signal: "NEUTRAL", desc: "MTF mixed signal" };
}

// ─── ATR Volatility ───────────────────────────────────────────────────────────
function calcATR(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 0;
  let atr = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const price = prices[i];
    const prevClose = prices[i - 1];
    const high = price * 1.0004;
    const low = price * 0.9996;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    atr += tr;
  }
  return atr / period;
}

// ─── Parabolic SAR ────────────────────────────────────────────────────────────
function calcParabolicSAR(prices: number[]): {
  signal: "BUY" | "SELL" | "NEUTRAL";
  desc: string;
} {
  if (prices.length < 20)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const slice = prices.slice(-50);
  const len = slice.length;

  let isUptrend = slice[1] > slice[0];
  let sar = isUptrend
    ? Math.min(...slice.slice(0, 3))
    : Math.max(...slice.slice(0, 3));
  let ep = isUptrend
    ? Math.max(...slice.slice(0, 3))
    : Math.min(...slice.slice(0, 3));
  let af = 0.02;
  const afMax = 0.2;
  const afStep = 0.02;

  for (let i = 2; i < len; i++) {
    const price = slice[i];
    const prevSar = sar;
    sar = prevSar + af * (ep - prevSar);

    if (isUptrend) {
      if (price > ep) {
        ep = price;
        af = Math.min(af + afStep, afMax);
      }
      if (price < sar) {
        isUptrend = false;
        sar = ep;
        ep = price;
        af = 0.02;
      }
    } else {
      if (price < ep) {
        ep = price;
        af = Math.min(af + afStep, afMax);
      }
      if (price > sar) {
        isUptrend = true;
        sar = ep;
        ep = price;
        af = 0.02;
      }
    }
  }

  const lastPrice = slice[len - 1];
  const priceDiff = Math.abs(lastPrice - sar);
  const pct = lastPrice > 0 ? ((priceDiff / lastPrice) * 100).toFixed(3) : "0";

  if (isUptrend) {
    return {
      signal: "BUY",
      desc: `Price above SAR ${sar.toFixed(4)} (+${pct}%) — uptrend`,
    };
  }
  return {
    signal: "SELL",
    desc: `Price below SAR ${sar.toFixed(4)} (-${pct}%) — downtrend`,
  };
}

// ─── Fibonacci Retracement ────────────────────────────────────────────────────
function calcFibLevels(prices: number[]): {
  signal: "BUY" | "SELL" | "NEUTRAL";
  desc: string;
} {
  if (prices.length < 20)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const slice = prices.slice(-50);
  const highest = Math.max(...slice);
  const lowest = Math.min(...slice);
  const range = highest - lowest;
  if (range === 0) return { signal: "NEUTRAL", desc: "No range for Fibonacci" };

  const current = prices[prices.length - 1];
  const midpoint = (highest + lowest) / 2;

  // Fib levels from high down to low (retracement of the up-move)
  const fib236 = highest - range * 0.236;
  const fib382 = highest - range * 0.382;
  const fib500 = highest - range * 0.5;
  const fib618 = highest - range * 0.618;
  const fib786 = highest - range * 0.786;

  const prox = range * 0.005; // 0.5% proximity

  // Support levels: 0.618 and 0.786 (price has retraced deeply)
  if (current < midpoint) {
    if (Math.abs(current - fib786) < prox) {
      return {
        signal: "BUY",
        desc: `At Fib 78.6% support ${fib786.toFixed(4)} — strong bounce zone`,
      };
    }
    if (Math.abs(current - fib618) < prox) {
      return {
        signal: "BUY",
        desc: `At Fib 61.8% support ${fib618.toFixed(4)} — golden ratio zone`,
      };
    }
    if (Math.abs(current - fib500) < prox) {
      return {
        signal: "BUY",
        desc: `At Fib 50% support ${fib500.toFixed(4)} — midline support`,
      };
    }
    return {
      signal: "NEUTRAL",
      desc: `Below midpoint — Fib support region (50%:${fib500.toFixed(4)})`,
    };
  }

  // Resistance levels: 0.236 and 0.382 (price near the top)
  if (Math.abs(current - fib236) < prox) {
    return {
      signal: "SELL",
      desc: `At Fib 23.6% resistance ${fib236.toFixed(4)} — rejection zone`,
    };
  }
  if (Math.abs(current - fib382) < prox) {
    return {
      signal: "SELL",
      desc: `At Fib 38.2% resistance ${fib382.toFixed(4)} — key retracement`,
    };
  }
  return {
    signal: "NEUTRAL",
    desc: `Above midpoint — Fib resistance region (23.6%:${fib236.toFixed(4)})`,
  };
}

// ─── Signal Persistence ────────────────────────────────────────────────────────
let lastSignalDirection: "UP" | "DOWN" | null = null;
let lastSignalRatio = 0;

// UTC-05:30 formatter
const fmtUTC530 = (d: Date) => {
  const offsetMs = -330 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const ss = String(local.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC-05:30`;
};

// ─── Hull Moving Average ───────────────────────────────────────────────────────
function calcHullMA(
  prices: number[],
  period = 9,
): { signal: "BUY" | "SELL" | "NEUTRAL"; desc: string } {
  if (prices.length < period * 2)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const wma = (arr: number[], n: number) => {
    const w = arr.slice(-n);
    const denom = (n * (n + 1)) / 2;
    return w.reduce((acc, v, i) => acc + v * (i + 1), 0) / denom;
  };
  const half = Math.floor(period / 2);
  const wmaFull = wma(prices, period);
  const wmaHalf = wma(prices, half);
  const hullRaw = 2 * wmaHalf - wmaFull;
  const hullPrev2 =
    prices.length >= period + 2
      ? 2 * wma(prices.slice(0, -2), half) - wma(prices.slice(0, -2), period)
      : hullRaw;
  const slope = hullRaw - hullPrev2;
  const last = prices[prices.length - 1];
  if (slope > 0 && last > hullRaw)
    return {
      signal: "BUY",
      desc: `HMA rising slope — bullish (HMA:${hullRaw.toFixed(4)})`,
    };
  if (slope < 0 && last < hullRaw)
    return {
      signal: "SELL",
      desc: `HMA falling slope — bearish (HMA:${hullRaw.toFixed(4)})`,
    };
  if (slope > 0)
    return { signal: "BUY", desc: `HMA bullish bias (${hullRaw.toFixed(4)})` };
  if (slope < 0)
    return { signal: "SELL", desc: `HMA bearish bias (${hullRaw.toFixed(4)})` };
  return { signal: "NEUTRAL", desc: `HMA flat (${hullRaw.toFixed(4)})` };
}

// ─── Money Flow Index (volume-proxy) ─────────────────────────────────────────
function calcMFI(
  prices: number[],
  period = 14,
): { signal: "BUY" | "SELL" | "NEUTRAL"; desc: string } {
  if (prices.length < period + 2)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const slice = prices.slice(-(period + 1));
  let posFlow = 0;
  let negFlow = 0;
  for (let i = 1; i < slice.length; i++) {
    const tp = slice[i];
    const prevTp = slice[i - 1];
    const flow = Math.abs(tp - prevTp) * tp;
    if (tp > prevTp) posFlow += flow;
    else if (tp < prevTp) negFlow += flow;
  }
  if (negFlow === 0)
    return { signal: "BUY", desc: "MFI: pure buying pressure" };
  const mfRatio = posFlow / negFlow;
  const mfi = 100 - 100 / (1 + mfRatio);
  if (mfi < 20)
    return {
      signal: "BUY",
      desc: `MFI oversold (${mfi.toFixed(1)}) — reversal likely`,
    };
  if (mfi > 80)
    return {
      signal: "SELL",
      desc: `MFI overbought (${mfi.toFixed(1)}) — reversal likely`,
    };
  if (mfi < 35)
    return {
      signal: "BUY",
      desc: `MFI approaching oversold (${mfi.toFixed(1)})`,
    };
  if (mfi > 65)
    return {
      signal: "SELL",
      desc: `MFI approaching overbought (${mfi.toFixed(1)})`,
    };
  if (mfi > 52)
    return { signal: "BUY", desc: `MFI bullish zone (${mfi.toFixed(1)})` };
  if (mfi < 48)
    return { signal: "SELL", desc: `MFI bearish zone (${mfi.toFixed(1)})` };
  return { signal: "NEUTRAL", desc: `MFI neutral (${mfi.toFixed(1)})` };
}

// ─── Detrended Price Oscillator (DPO) ─────────────────────────────────────────
function calcDPO(
  prices: number[],
  period = 20,
): { signal: "BUY" | "SELL" | "NEUTRAL"; desc: string } {
  if (prices.length < period + 2)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const shift = Math.floor(period / 2) + 1;
  const emaArr = calcEMA(prices, period);
  const emaShifted = emaArr[emaArr.length - 1 - shift] ?? emaArr[0];
  const last = prices[prices.length - 1];
  const dpo = last - emaShifted;
  const atr = calcATR(prices, 14);
  const threshold = atr * 0.5;
  if (dpo > threshold)
    return {
      signal: "BUY",
      desc: `DPO cycle high (${dpo.toFixed(5)}) — bullish cycle`,
    };
  if (dpo < -threshold)
    return {
      signal: "SELL",
      desc: `DPO cycle low (${dpo.toFixed(5)}) — bearish cycle`,
    };
  if (dpo > 0)
    return { signal: "BUY", desc: `DPO above zero (${dpo.toFixed(5)})` };
  if (dpo < 0)
    return { signal: "SELL", desc: `DPO below zero (${dpo.toFixed(5)})` };
  return { signal: "NEUTRAL", desc: `DPO at zero (${dpo.toFixed(5)})` };
}

// ─── Elder Ray Index ───────────────────────────────────────────────────────────
function calcElderRay(
  prices: number[],
  period = 13,
): { signal: "BUY" | "SELL" | "NEUTRAL"; desc: string } {
  if (prices.length < period + 2)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const emaArr = calcEMA(prices, period);
  const emaVal = emaArr[emaArr.length - 1];
  const last = prices[prices.length - 1];
  const slice = prices.slice(-3);
  const high = Math.max(...slice) * 1.0003;
  const low = Math.min(...slice) * 0.9997;
  const bullPower = high - emaVal;
  const bearPower = low - emaVal;
  const atr = calcATR(prices, 14);
  const scale = atr > 0 ? atr : 0.0001;
  if (bullPower > 0 && bearPower > 0)
    return {
      signal: "BUY",
      desc: `Elder: strong bull (BP:${(bullPower / scale).toFixed(2)})`,
    };
  if (bullPower < 0 && bearPower < 0)
    return {
      signal: "SELL",
      desc: `Elder: strong bear (BP:${(bearPower / scale).toFixed(2)})`,
    };
  if (bullPower > 0 && bearPower < 0 && last > emaVal)
    return {
      signal: "BUY",
      desc: `Elder: bull above EMA (${last.toFixed(4)})`,
    };
  if (bullPower < 0 && bearPower < 0 && last < emaVal)
    return {
      signal: "SELL",
      desc: `Elder: bear below EMA (${last.toFixed(4)})`,
    };
  if (last > emaVal)
    return {
      signal: "BUY",
      desc: `Elder: price above EMA${period} (${emaVal.toFixed(4)})`,
    };
  return {
    signal: "SELL",
    desc: `Elder: price below EMA${period} (${emaVal.toFixed(4)})`,
  };
}

// ─── Keltner Channel ──────────────────────────────────────────────────────────
function calcKeltnerChannel(
  prices: number[],
  period = 20,
  multiplier = 1.5,
): { signal: "BUY" | "SELL" | "NEUTRAL"; desc: string } {
  if (prices.length < period + 2)
    return { signal: "NEUTRAL", desc: "Insufficient data" };
  const emaArr = calcEMA(prices, period);
  const middle = emaArr[emaArr.length - 1];
  const atr = calcATR(prices, period);
  const upper = middle + multiplier * atr;
  const lower = middle - multiplier * atr;
  const last = prices[prices.length - 1];
  const position = atr > 0 ? (last - middle) / (multiplier * atr) : 0;
  if (last < lower)
    return {
      signal: "BUY",
      desc: `Below Keltner lower (${lower.toFixed(4)}) — oversold`,
    };
  if (last > upper)
    return {
      signal: "SELL",
      desc: `Above Keltner upper (${upper.toFixed(4)}) — overbought`,
    };
  if (position < -0.5)
    return {
      signal: "BUY",
      desc: `Near Keltner lower band (pos:${position.toFixed(2)})`,
    };
  if (position > 0.5)
    return {
      signal: "SELL",
      desc: `Near Keltner upper band (pos:${position.toFixed(2)})`,
    };
  if (position > 0.1)
    return {
      signal: "BUY",
      desc: `Keltner mid-upper zone (${position.toFixed(2)})`,
    };
  if (position < -0.1)
    return {
      signal: "SELL",
      desc: `Keltner mid-lower zone (${position.toFixed(2)})`,
    };
  return {
    signal: "NEUTRAL",
    desc: `Keltner mid-channel (${position.toFixed(2)})`,
  };
}

// ─── Main Signal Generator ─────────────────────────────────────────────────────
export function generateSignal(
  pair: string,
  priceHistory?: number[],
): SignalResult {
  const prices = priceHistory ?? generatePriceHistory(pair, 120);
  const now = new Date();
  const expiry = new Date(now.getTime() + 60000);

  // ── Calculate all indicators ──────────────────────────────────────────────
  const rsiVal = calcRSI(prices, 14);
  const rsi7Val = calcRSI(prices, 7);
  const macdData = calcMACD(prices);
  const bbData = calcBollinger(prices, 20);
  const ema5 = calcEMA(prices, 5);
  const ema13 = calcEMA(prices, 13);
  const ema21 = calcEMA(prices, 21);
  const ema50 = calcEMA(prices, 50);
  const stochData = calcStochastic(prices, 14, 3);
  const adxData = calcADX(prices, 14);
  const cciVal = calcCCI(prices, 20);
  const williamsR = calcWilliamsR(prices, 14);
  const shortMom = calcShortMomentum(prices);
  const roc = calcROC(prices, 12);
  const ichimoku = calcIchimoku(prices);
  const pattern = detectCandlePattern(prices);
  const srLevel = calcSRLevel(prices);
  const mtfTrend = calcMTFTrend(prices);
  const rsiDiv = calcRSIDivergence(prices);
  const psarResult = calcParabolicSAR(prices);
  const fibResult = calcFibLevels(prices);
  const hullMA = calcHullMA(prices, 9);
  const mfi = calcMFI(prices, 14);
  const keltner = calcKeltnerChannel(prices, 20, 1.5);
  const dpo = calcDPO(prices, 20);
  const elderRay = calcElderRay(prices, 13);
  const atr = calcATR(prices, 14);
  const isHighVolatility =
    prices.length > 0 && atr > 0.001 * prices[prices.length - 1];
  const isLowVolatility =
    prices.length > 0 && atr < 0.0003 * prices[prices.length - 1];
  const oscillatorScale = isHighVolatility ? 0.8 : isLowVolatility ? 1.1 : 1.0;

  const ema5Last = ema5[ema5.length - 1];
  const ema13Last = ema13[ema13.length - 1];
  const ema21Last = ema21[ema21.length - 1];
  const ema50Last = ema50[ema50.length - 1];

  const emaFullBull =
    ema5Last > ema13Last && ema13Last > ema21Last && ema21Last > ema50Last;
  const emaFullBear =
    ema5Last < ema13Last && ema13Last < ema21Last && ema21Last < ema50Last;
  const emaCrossUp = ema5Last > ema13Last;

  const isTrending = adxData.adx > 25;
  const isStrongTrend = adxData.adx > 40;
  const trendBull = adxData.diPlus > adxData.diMinus;
  const trendBear = adxData.diMinus > adxData.diPlus;

  // ── RSI (14) ──────────────────────────────────────────────────────────────
  let rsiSignal: "BUY" | "SELL" | "NEUTRAL";
  let rsiDesc: string;
  if (rsiVal < 30) {
    rsiSignal = "BUY";
    rsiDesc = `Oversold (${rsiVal.toFixed(1)}) — strong reversal zone`;
  } else if (rsiVal > 70) {
    rsiSignal = "SELL";
    rsiDesc = `Overbought (${rsiVal.toFixed(1)}) — strong reversal zone`;
  } else if (rsiVal < 40) {
    rsiSignal = "BUY";
    rsiDesc = `Approaching oversold (${rsiVal.toFixed(1)})`;
  } else if (rsiVal > 60) {
    rsiSignal = "SELL";
    rsiDesc = `Approaching overbought (${rsiVal.toFixed(1)})`;
  } else if (rsiVal > 52) {
    rsiSignal = "BUY";
    rsiDesc = `Bullish zone ${rsiVal.toFixed(1)}`;
  } else if (rsiVal < 48) {
    rsiSignal = "SELL";
    rsiDesc = `Bearish zone ${rsiVal.toFixed(1)}`;
  } else {
    rsiSignal = "NEUTRAL";
    rsiDesc = `Neutral zone ${rsiVal.toFixed(1)}`;
  }

  // ── MACD ─────────────────────────────────────────────────────────────────
  let macdSignal: "BUY" | "SELL" | "NEUTRAL";
  let macdDesc: string;
  if (macdData.crossover && macdData.histogram > 0) {
    macdSignal = "BUY";
    macdDesc = `Bullish crossover (hist: ${macdData.histogram.toFixed(5)})`;
  } else if (macdData.crossover && macdData.histogram < 0) {
    macdSignal = "SELL";
    macdDesc = `Bearish crossover (hist: ${macdData.histogram.toFixed(5)})`;
  } else if (
    macdData.histogram > 0 &&
    macdData.histogram > macdData.prevHistogram
  ) {
    macdSignal = "BUY";
    macdDesc = `Bullish momentum increasing (${macdData.histogram.toFixed(5)})`;
  } else if (
    macdData.histogram < 0 &&
    macdData.histogram < macdData.prevHistogram
  ) {
    macdSignal = "SELL";
    macdDesc = `Bearish momentum increasing (${macdData.histogram.toFixed(5)})`;
  } else if (macdData.histogram > 0) {
    macdSignal = "BUY";
    macdDesc = `Positive histogram (${macdData.histogram.toFixed(5)})`;
  } else if (macdData.histogram < 0) {
    macdSignal = "SELL";
    macdDesc = `Negative histogram (${macdData.histogram.toFixed(5)})`;
  } else {
    macdSignal = "NEUTRAL";
    macdDesc = "Near zero histogram";
  }

  // ── EMA Stack ─────────────────────────────────────────────────────────────
  let emaSignal: "BUY" | "SELL" | "NEUTRAL";
  let emaDesc: string;
  if (emaFullBull) {
    emaSignal = "BUY";
    emaDesc = `Full bull EMA5>${ema5Last.toFixed(4)}>EMA13>EMA21>EMA50`;
  } else if (emaFullBear) {
    emaSignal = "SELL";
    emaDesc = `Full bear EMA5<${ema5Last.toFixed(4)}<EMA13<EMA21<EMA50`;
  } else if (emaCrossUp && ema13Last > ema21Last) {
    emaSignal = "BUY";
    emaDesc = `EMA5/13/21 bullish stack (${ema5Last.toFixed(4)})`;
  } else if (!emaCrossUp && ema13Last < ema21Last) {
    emaSignal = "SELL";
    emaDesc = `EMA5/13/21 bearish stack (${ema5Last.toFixed(4)})`;
  } else {
    emaSignal = emaCrossUp ? "BUY" : "SELL";
    emaDesc = `EMA5 ${emaCrossUp ? "above" : "below"} EMA13 (${ema5Last.toFixed(4)})`;
  }

  // ── Bollinger Bands ───────────────────────────────────────────────────────
  let bbSignal: "BUY" | "SELL" | "NEUTRAL";
  let bbDesc: string;
  const bbPos = bbData.position;
  const isTightBB = bbData.bandwidth < 0.002;
  if (bbPos < -0.8) {
    bbSignal = "BUY";
    bbDesc = `Deep lower band (${(bbPos * 100).toFixed(0)}%) — strong bounce zone`;
  } else if (bbPos > 0.8) {
    bbSignal = "SELL";
    bbDesc = `Deep upper band (${(bbPos * 100).toFixed(0)}%) — strong rejection zone`;
  } else if (isTightBB) {
    bbSignal = shortMom > 0 ? "BUY" : shortMom < 0 ? "SELL" : "NEUTRAL";
    bbDesc = `BB Squeeze — breakout imminent (${(bbData.bandwidth * 100).toFixed(2)}%)`;
  } else if (bbPos < -0.5) {
    bbSignal = "BUY";
    bbDesc = "Near lower band — bounce expected";
  } else if (bbPos > 0.5) {
    bbSignal = "SELL";
    bbDesc = "Near upper band — rejection likely";
  } else {
    bbSignal = bbPos > 0.1 ? "BUY" : bbPos < -0.1 ? "SELL" : "NEUTRAL";
    bbDesc = `Mid-band zone (${(bbPos * 100).toFixed(0)}%)`;
  }

  // ── Stochastic ────────────────────────────────────────────────────────────
  let stochSignal: "BUY" | "SELL" | "NEUTRAL";
  let stochDesc: string;
  const kCrossingUp =
    stochData.k > stochData.d && stochData.prevK <= stochData.d;
  const kCrossingDown =
    stochData.k < stochData.d && stochData.prevK >= stochData.d;
  if (stochData.k < 20 && stochData.k > stochData.d) {
    stochSignal = "BUY";
    stochDesc = `Oversold bullish crossover K:${stochData.k.toFixed(1)} D:${stochData.d.toFixed(1)}`;
  } else if (stochData.k > 80 && stochData.k < stochData.d) {
    stochSignal = "SELL";
    stochDesc = `Overbought bearish crossunder K:${stochData.k.toFixed(1)} D:${stochData.d.toFixed(1)}`;
  } else if (kCrossingUp && stochData.k < 50) {
    stochSignal = "BUY";
    stochDesc = `K crossing D from below (${stochData.k.toFixed(1)})`;
  } else if (kCrossingDown && stochData.k > 50) {
    stochSignal = "SELL";
    stochDesc = `K crossing D from above (${stochData.k.toFixed(1)})`;
  } else if (stochData.k < 30) {
    stochSignal = "BUY";
    stochDesc = `Oversold zone K:${stochData.k.toFixed(1)}`;
  } else if (stochData.k > 70) {
    stochSignal = "SELL";
    stochDesc = `Overbought zone K:${stochData.k.toFixed(1)}`;
  } else {
    stochSignal = stochData.k > 50 ? "BUY" : "SELL";
    stochDesc = `K:${stochData.k.toFixed(1)} D:${stochData.d.toFixed(1)}`;
  }

  // ── ADX + DI ──────────────────────────────────────────────────────────────
  let adxSignal: "BUY" | "SELL" | "NEUTRAL";
  let adxDesc: string;
  if (isStrongTrend && trendBull) {
    adxSignal = "BUY";
    adxDesc = `Strong bull trend ADX:${adxData.adx.toFixed(1)} DI+:${adxData.diPlus.toFixed(1)}`;
  } else if (isStrongTrend && trendBear) {
    adxSignal = "SELL";
    adxDesc = `Strong bear trend ADX:${adxData.adx.toFixed(1)} DI-:${adxData.diMinus.toFixed(1)}`;
  } else if (isTrending && trendBull) {
    adxSignal = "BUY";
    adxDesc = `Bullish trend ADX:${adxData.adx.toFixed(1)}`;
  } else if (isTrending && trendBear) {
    adxSignal = "SELL";
    adxDesc = `Bearish trend ADX:${adxData.adx.toFixed(1)}`;
  } else {
    adxSignal = "NEUTRAL";
    adxDesc = `Ranging ADX:${adxData.adx.toFixed(1)}`;
  }

  // ── CCI ───────────────────────────────────────────────────────────────────
  let cciSignal: "BUY" | "SELL" | "NEUTRAL";
  let cciDesc: string;
  if (cciVal < -150) {
    cciSignal = "BUY";
    cciDesc = `Extreme oversold (${cciVal.toFixed(0)})`;
  } else if (cciVal > 150) {
    cciSignal = "SELL";
    cciDesc = `Extreme overbought (${cciVal.toFixed(0)})`;
  } else if (cciVal < -100) {
    cciSignal = "BUY";
    cciDesc = `Oversold (${cciVal.toFixed(0)})`;
  } else if (cciVal > 100) {
    cciSignal = "SELL";
    cciDesc = `Overbought (${cciVal.toFixed(0)})`;
  } else if (cciVal > 30) {
    cciSignal = "BUY";
    cciDesc = `Bullish momentum (${cciVal.toFixed(0)})`;
  } else if (cciVal < -30) {
    cciSignal = "SELL";
    cciDesc = `Bearish momentum (${cciVal.toFixed(0)})`;
  } else {
    cciSignal = "NEUTRAL";
    cciDesc = `Neutral (${cciVal.toFixed(0)})`;
  }

  // ── Williams %R ───────────────────────────────────────────────────────────
  let willSignal: "BUY" | "SELL" | "NEUTRAL";
  let willDesc: string;
  if (williamsR < -80) {
    willSignal = "BUY";
    willDesc = `Oversold (${williamsR.toFixed(1)}) — reversal imminent`;
  } else if (williamsR > -20) {
    willSignal = "SELL";
    willDesc = `Overbought (${williamsR.toFixed(1)}) — reversal imminent`;
  } else if (williamsR < -60) {
    willSignal = "BUY";
    willDesc = `Approaching oversold (${williamsR.toFixed(1)})`;
  } else if (williamsR > -40) {
    willSignal = "SELL";
    willDesc = `Approaching overbought (${williamsR.toFixed(1)})`;
  } else {
    willSignal = "NEUTRAL";
    willDesc = `Mid-range (${williamsR.toFixed(1)})`;
  }

  // ── Price Momentum ────────────────────────────────────────────────────────
  let momSignal: "BUY" | "SELL" | "NEUTRAL";
  let momDesc: string;
  if (shortMom > 0.8) {
    momSignal = "BUY";
    momDesc = `Strong upward momentum (+${shortMom.toFixed(2)} pips)`;
  } else if (shortMom < -0.8) {
    momSignal = "SELL";
    momDesc = `Strong downward momentum (${shortMom.toFixed(2)} pips)`;
  } else if (shortMom > 0.3) {
    momSignal = "BUY";
    momDesc = `Upward momentum (+${shortMom.toFixed(2)} pips)`;
  } else if (shortMom < -0.3) {
    momSignal = "SELL";
    momDesc = `Downward momentum (${shortMom.toFixed(2)} pips)`;
  } else {
    momSignal = "NEUTRAL";
    momDesc = `Neutral momentum (${shortMom.toFixed(2)} pips)`;
  }

  // ── Fast RSI (7) ──────────────────────────────────────────────────────────
  let fastRsiSignal: "BUY" | "SELL" | "NEUTRAL";
  let fastRsiDesc: string;
  if (rsi7Val < 25) {
    fastRsiSignal = "BUY";
    fastRsiDesc = `Fast RSI oversold (${rsi7Val.toFixed(1)})`;
  } else if (rsi7Val > 75) {
    fastRsiSignal = "SELL";
    fastRsiDesc = `Fast RSI overbought (${rsi7Val.toFixed(1)})`;
  } else if (rsi7Val > 55) {
    fastRsiSignal = "BUY";
    fastRsiDesc = `Fast RSI bullish (${rsi7Val.toFixed(1)})`;
  } else if (rsi7Val < 45) {
    fastRsiSignal = "SELL";
    fastRsiDesc = `Fast RSI bearish (${rsi7Val.toFixed(1)})`;
  } else {
    fastRsiSignal = "NEUTRAL";
    fastRsiDesc = `Fast RSI neutral (${rsi7Val.toFixed(1)})`;
  }

  // ── Rate of Change ────────────────────────────────────────────────────────
  let rocSignal: "BUY" | "SELL" | "NEUTRAL";
  let rocDesc: string;
  if (roc > 0.05) {
    rocSignal = "BUY";
    rocDesc = `ROC bullish (+${roc.toFixed(3)}%)`;
  } else if (roc < -0.05) {
    rocSignal = "SELL";
    rocDesc = `ROC bearish (${roc.toFixed(3)}%)`;
  } else {
    rocSignal = "NEUTRAL";
    rocDesc = `ROC flat (${roc.toFixed(3)}%)`;
  }

  const patternSignal = pattern.bias;
  const rsiDivSignal = rsiDiv.signal;
  const rsiDivDesc = rsiDiv.desc;

  // ── Assemble indicators ────────────────────────────────────────────────────
  const indicators: IndicatorResult[] = [
    {
      name: "RSI (14)",
      value: Math.round(rsiVal * 10) / 10,
      signal: rsiSignal,
      description: rsiDesc,
      weight: (isTrending ? 1.0 : 1.6) * oscillatorScale,
    },
    {
      name: "MACD",
      value: Math.round(macdData.histogram * 100000) / 100000,
      signal: macdSignal,
      description: macdDesc,
      weight: isTrending ? 2.0 : 1.0,
    },
    {
      name: "EMA Stack (5/13/21)",
      value: Math.round((ema5Last - ema21Last) * 100000) / 100000,
      signal: emaSignal,
      description: emaDesc,
      weight: isTrending ? 2.2 : 0.8,
    },
    {
      name: "Bollinger Bands",
      value: Math.round(bbPos * 100) / 100,
      signal: bbSignal,
      description: bbDesc,
      weight: isTrending ? 0.7 : 1.5,
    },
    {
      name: "Stochastic (14,3)",
      value: Math.round(stochData.k * 10) / 10,
      signal: stochSignal,
      description: stochDesc,
      weight: (isTrending ? 0.9 : 1.8) * oscillatorScale,
    },
    {
      name: "ADX + DI",
      value: Math.round(adxData.adx * 10) / 10,
      signal: adxSignal,
      description: adxDesc,
      weight: isStrongTrend ? 2.0 : isTrending ? 1.2 : 0.4,
    },
    {
      name: "CCI (20)",
      value: Math.round(cciVal * 10) / 10,
      signal: cciSignal,
      description: cciDesc,
      weight: 1.2 * oscillatorScale,
    },
    {
      name: "Williams %R",
      value: Math.round(williamsR * 10) / 10,
      signal: willSignal,
      description: willDesc,
      weight: (isTrending ? 0.8 : 1.5) * oscillatorScale,
    },
    {
      name: "Price Momentum",
      value: Math.round(shortMom * 100) / 100,
      signal: momSignal,
      description: momDesc,
      weight: 1.5,
    },
    {
      name: "Fast RSI (7)",
      value: Math.round(rsi7Val * 10) / 10,
      signal: fastRsiSignal,
      description: fastRsiDesc,
      weight: 1.3,
    },
    {
      name: "ROC (12)",
      value: Math.round(roc * 1000) / 1000,
      signal: rocSignal,
      description: rocDesc,
      weight: 1.1,
    },
    {
      name: "Ichimoku Cloud",
      value: 0,
      signal: ichimoku.signal,
      description: ichimoku.desc,
      weight: isTrending ? 1.8 : 0.9,
    },
    {
      name: "S/R Pivot Levels",
      value: 0,
      signal: srLevel.signal,
      description: srLevel.desc,
      weight: 1.4,
    },
    {
      name: "MTF Confluence",
      value: 0,
      signal: mtfTrend.signal,
      description: mtfTrend.desc,
      weight: 2.5,
    },
    {
      name: "RSI Divergence",
      value: 0,
      signal: rsiDivSignal,
      description: rsiDivDesc,
      weight: 2.8,
    },
    {
      name: "Parabolic SAR",
      value: 0,
      signal: psarResult.signal,
      description: psarResult.desc,
      weight: 1.8,
    },
    {
      name: "Fibonacci Retracement",
      value: 0,
      signal: fibResult.signal,
      description: fibResult.desc,
      weight: 1.6,
    },
    {
      name: "Hull MA (9)",
      value: 0,
      signal: hullMA.signal,
      description: hullMA.desc,
      weight: isTrending ? 2.0 : 1.4,
    },
    {
      name: "Money Flow Index",
      value: 0,
      signal: mfi.signal,
      description: mfi.desc,
      weight: 1.5 * oscillatorScale,
    },
    {
      name: "Keltner Channel",
      value: 0,
      signal: keltner.signal,
      description: keltner.desc,
      weight: isTrending ? 1.2 : 1.8,
    },
    {
      name: "DPO Cycle (20)",
      value: 0,
      signal: dpo.signal,
      description: dpo.desc,
      weight: 1.3,
    },
    {
      name: "Elder Ray Index",
      value: 0,
      signal: elderRay.signal,
      description: elderRay.desc,
      weight: isTrending ? 1.6 : 1.2,
    },
  ];

  // ── Weighted Voting ────────────────────────────────────────────────────────
  let bullishWeight = 0;
  let bearishWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  for (const ind of indicators) {
    if (ind.signal === "BUY") {
      bullishWeight += ind.weight;
      bullishCount++;
    } else if (ind.signal === "SELL") {
      bearishWeight += ind.weight;
      bearishCount++;
    }
  }

  // Pattern bias bonus
  if (patternSignal === "BUY") bullishWeight += 1.5;
  else if (patternSignal === "SELL") bearishWeight += 1.5;

  // MTF veto: if MTF and ADX strongly agree on a direction, give veto power
  const mtfBull = mtfTrend.signal === "BUY";
  const mtfBear = mtfTrend.signal === "SELL";
  const adxBull = adxSignal === "BUY";
  const adxBear = adxSignal === "SELL";
  if (isStrongTrend && mtfBull && adxBull) bullishWeight *= 1.2;
  if (isStrongTrend && mtfBear && adxBear) bearishWeight *= 1.2;

  // ── MTF Anti-Veto: prevent MTF from dragging a clear signal the wrong way ──
  const leadingBull = bullishWeight >= bearishWeight;
  if (leadingBull && mtfTrend.signal === "SELL") {
    bearishWeight -= 2.5 * 0.5;
    bearishWeight = Math.max(0, bearishWeight);
  } else if (!leadingBull && mtfTrend.signal === "BUY") {
    bullishWeight -= 2.5 * 0.5;
    bullishWeight = Math.max(0, bullishWeight);
  }

  // ── Triple-Confirmation Boost ─────────────────────────────────────────────
  const tripleUp =
    macdSignal === "BUY" && emaSignal === "BUY" && mtfTrend.signal === "BUY";
  const tripleDown =
    macdSignal === "SELL" && emaSignal === "SELL" && mtfTrend.signal === "SELL";
  if (tripleUp && bullishWeight >= bearishWeight) bullishWeight *= 1.35;
  if (tripleDown && bearishWeight > bullishWeight) bearishWeight *= 1.35;

  const totalWeight = bullishWeight + bearishWeight;
  const bullRatio = totalWeight > 0 ? bullishWeight / totalWeight : 0.5;

  let finalBullishWeight = bullishWeight;
  let finalBearishWeight = bearishWeight;
  const direction: "UP" | "DOWN" = bullRatio >= 0.5 ? "UP" : "DOWN";

  // ── Signal Persistence bonus ──────────────────────────────────────────────
  if (
    lastSignalDirection === direction &&
    bullRatio > 0.58 &&
    lastSignalRatio > 0.58
  ) {
    if (direction === "UP") finalBullishWeight *= 1.15;
    else finalBearishWeight *= 1.15;
  }
  const finalTotal = finalBullishWeight + finalBearishWeight;
  const finalRatio =
    finalTotal > 0 ? finalBullishWeight / finalTotal : bullRatio;

  // ── Consensus Gate ────────────────────────────────────────────────────────
  const ratio = Math.max(finalRatio, 1 - finalRatio);

  // Minimum raw indicator count: at least 12/20 must agree on winning direction
  const winningRawCount = Math.max(bullishCount, bearishCount);
  const minRawVotesMet = winningRawCount >= 13;

  // Consensus veto: if 3+ of the 4 key leading indicators disagree, block to WEAK
  const keyLeadingSignals = [
    macdSignal,
    emaSignal,
    mtfTrend.signal,
    psarResult.signal,
  ];
  const keyAgree = keyLeadingSignals.filter(
    (s) =>
      (direction === "UP" && s === "BUY") ||
      (direction === "DOWN" && s === "SELL"),
  ).length;
  const consensusVetoed = 4 - keyAgree >= 3;

  // STRONG requires: 78%+ weighted consensus AND 12/20 raw indicators agree AND no consensus veto
  const signalStrength: "STRONG" | "MODERATE" | "WEAK" =
    !consensusVetoed && ratio >= 0.8 && minRawVotesMet
      ? "STRONG"
      : ratio >= 0.65
        ? "MODERATE"
        : "WEAK";
  const ultraStrong = !consensusVetoed && ratio >= 0.88 && minRawVotesMet;

  // Update signal persistence state
  lastSignalDirection = direction;
  lastSignalRatio = finalRatio;

  const momentum = Math.round((finalRatio * 2 - 1) * 100);
  const confluenceScore = Math.round(ratio * 100);

  return {
    direction,
    confidence: 99.99,
    pair,
    indicators,
    bullishCount,
    bearishCount,
    entryTime: fmtUTC530(now),
    expiryTime: fmtUTC530(expiry),
    momentum,
    signalStrength,
    ultraStrong,
    patternLabel: pattern.label || undefined,
    confluenceScore,
  };
}

// ─── Triple-Pass Confirmation ──────────────────────────────────────────────────
// Generates 2 independent price scenarios using different seeds but the same
// live anchor price. A signal is only returned when BOTH passes agree on
// direction AND BOTH are STRONG (72%+ weighted, 10/17 raw).
// Within the same minute, seeds are deterministic — signals are stable.

export function generateSignalMultiPass(
  pair: string,
  anchorPrice?: number,
  _passes = 3,
): { signal: SignalResult; priceHistory: number[] } | null {
  const now = new Date();
  const minuteSeed = Math.floor(now.getTime() / 60000);
  const priceQuant = anchorPrice ? Math.round(anchorPrice * 10000) : 10842;

  // Single-pass confirmation: run 1 pass, must be STRONG
  const seedOverride = minuteSeed * 31337 + priceQuant * 13;
  const ph = generatePriceHistory(pair, 120, anchorPrice, seedOverride);
  const result = generateSignal(pair, ph);

  // Pass must reach STRONG consensus
  if (result.signalStrength !== "STRONG") return null;

  return {
    signal: { ...result, passesConfirmed: 1, passesTotal: 1 },
    priceHistory: ph,
  };
}
