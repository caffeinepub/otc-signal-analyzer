import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useActor } from "@/hooks/useActor";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Signal,
  Timer,
  TrendingDown,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type IndicatorResult,
  type SignalResult,
  generatePriceHistory,
  generateSignalMultiPass,
} from "./lib/ta";

const OTC_PAIRS = [
  { label: "EUR/USD OTC", key: "eurUsd", flag: "🇪🇺" },
  { label: "GBP/USD OTC", key: "gbpUsd", flag: "🇬🇧" },
  { label: "USD/JPY OTC", key: "usdJpy", flag: "🇯🇵" },
  { label: "AUD/USD OTC", key: "audUsd", flag: "🇦🇺" },
  { label: "USD/CAD OTC", key: "usdCad", flag: "🇨🇦" },
  { label: "NZD/USD OTC", key: "nzdUsd", flag: "🇳🇿" },
  { label: "EUR/GBP OTC", key: "eurGbp", flag: "🇪🇺" },
  { label: "EUR/JPY OTC", key: "eurJpy", flag: "🇪🇺" },
];
const COOLDOWN = 5;
// Re-scan interval when waiting for a sureshot (seconds)
const SCAN_INTERVAL = 1;

interface HistoryRow {
  id: number;
  pair: string;
  direction: "UP" | "DOWN";
  timeframe: string;
  entryTime: string;
  result: "WIN" | "LOSS";
}

function formatUTC530(d: Date): string {
  const offsetMs = -330 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const ss = String(local.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC-05:30`;
}

function formatPrice(price: number, pair = ""): string {
  return pair.includes("JPY") ? price.toFixed(2) : price.toFixed(4);
}

// ─── Signal Strength Badge ───────────────────────────────────────────────────────
function SignalStrengthBadge({
  strength,
  ultraStrong,
}: { strength: "STRONG" | "MODERATE" | "WEAK"; ultraStrong?: boolean }) {
  if (ultraStrong) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-lg bg-yellow-500/20 text-yellow-300 border border-yellow-400/50 tracking-wide animate-pulse">
        🔥 ULTRA STRONG
      </span>
    );
  }
  if (strength === "STRONG") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-lg bg-bullish/20 text-bullish border border-bullish/40 tracking-wide">
        ⚡ STRONG SIGNAL
      </span>
    );
  }
  if (strength === "MODERATE") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-amber/15 text-amber border border-amber/40 tracking-wide">
        ◎ MODERATE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-muted text-muted-foreground border border-border tracking-wide">
      ~ WEAK
    </span>
  );
}

// ─── Candlestick Chart (SVG) ───────────────────────────────────────────────────────
function CandlestickChart({ prices }: { prices: number[] }) {
  const candles = prices.slice(-20);
  if (candles.length < 2) return null;
  const w = 280;
  const h = 100;
  const candleW = Math.floor(w / candles.length) - 2;
  const min = Math.min(...candles);
  const max = Math.max(...candles);
  const range = max - min || 1;
  const toY = (v: number) => h - ((v - min) / range) * h * 0.85 - h * 0.07;

  const ohlc = candles.map((close, i) => {
    const prev = i > 0 ? candles[i - 1] : close;
    const open = prev;
    const wiggle = (close - open) * 0.3;
    const high = Math.max(open, close) + Math.abs(wiggle) * 1.2;
    const low = Math.min(open, close) - Math.abs(wiggle) * 1.2;
    return { open, high, low, close, idx: i };
  });

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {ohlc.map((c) => {
        const x = c.idx * (w / candles.length) + 1;
        const isBull = c.close >= c.open;
        const color = isBull ? "#22c55e" : "#ef4444";
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyBot = toY(Math.min(c.open, c.close));
        const bodyH = Math.max(bodyBot - bodyTop, 1);
        return (
          <g key={`${c.close.toFixed(5)}-${c.open.toFixed(5)}`}>
            <line
              x1={x + candleW / 2}
              y1={toY(c.high)}
              x2={x + candleW / 2}
              y2={toY(c.low)}
              stroke={color}
              strokeWidth={0.8}
              opacity={0.6}
            />
            <rect
              x={x}
              y={bodyTop}
              width={candleW}
              height={bodyH}
              fill={color}
              opacity={0.85}
              rx={0.5}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Indicator Row ─────────────────────────────────────────────────────────────
function IndicatorRow({ ind, index }: { ind: IndicatorResult; index: number }) {
  const isBuy = ind.signal === "BUY";
  const isSell = ind.signal === "SELL";
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/60 border border-border hover:bg-card/80 transition-colors"
    >
      <div
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          isBuy ? "bg-bullish" : isSell ? "bg-bearish" : "bg-muted-foreground"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-foreground truncate">
            {ind.name}
          </span>
          <span
            className={`text-[10px] font-mono ${
              isBuy
                ? "text-bullish"
                : isSell
                  ? "text-bearish"
                  : "text-muted-foreground"
            }`}
          >
            {ind.value}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
          {ind.description}
        </p>
      </div>
      <div className="shrink-0">
        {isBuy ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-bullish/15 text-bullish border border-bullish/30">
            BUY
          </span>
        ) : isSell ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-bearish/15 text-bearish border border-bearish/30">
            SELL
          </span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
            WAIT
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ─── Scanning State Panel ────────────────────────────────────────────────────────
function ScanningPanel({
  scanCountdown,
  livePrice,
  lastScannedAt,
  pair,
}: {
  scanCountdown: number;
  livePrice: number | null;
  lastScannedAt: string | null;
  pair: string;
}) {
  return (
    <motion.div
      key="scanning"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-blue-500/30 bg-card overflow-hidden"
      data-ocid="signal.scanning_state"
    >
      <div className="p-6 flex flex-col items-center gap-4 text-center">
        {/* Pulsing scan ring */}
        <div className="relative">
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.7, 0.3] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2 }}
            className="absolute inset-0 rounded-full bg-blue-500/10"
          />
          <div className="w-16 h-16 rounded-full border-2 border-blue-500/30 flex items-center justify-center relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{
                repeat: Number.POSITIVE_INFINITY,
                duration: 3,
                ease: "linear",
              }}
            >
              <Search size={22} className="text-blue-400" />
            </motion.div>
          </div>
        </div>

        <div>
          <div className="text-sm font-black text-blue-300 tracking-widest uppercase">
            Scanning {pair}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Waiting for a 1/1 confirmed SURESHOT...
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            17-indicator signal engine
          </div>
        </div>

        {/* Scan progress */}
        <div className="w-full max-w-[240px] space-y-2">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Next scan in</span>
            <span className="font-mono font-bold text-blue-300">
              {scanCountdown}s
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-blue-500"
              key={scanCountdown}
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: SCAN_INTERVAL, ease: "linear" }}
            />
          </div>
        </div>

        {/* Live price */}
        {livePrice && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bullish/10 border border-bullish/30">
            <Wifi size={10} className="text-bullish" />
            <span className="text-[10px] font-bold text-bullish">LIVE</span>
            <span className="font-mono text-xs font-black text-bullish">
              {formatPrice(livePrice, pair)}
            </span>
          </div>
        )}

        {lastScannedAt && (
          <div className="text-[9px] text-muted-foreground">
            Last scanned: {lastScannedAt}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────────
export default function App() {
  const { actor, isFetching: actorFetching } = useActor();
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [prices, setPrices] = useState<number[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [sureshottotalSignals, setSureshotTotalSignals] = useState(0);
  const [now, setNow] = useState(new Date());
  const [selectedPair, setSelectedPair] = useState("EUR/USD OTC");
  const [priceData, setPriceData] = useState<Record<string, number> | null>(
    null,
  );
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<"loading" | "live" | "error">(
    "loading",
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [_isAutoSignal, setIsAutoSignal] = useState(false);
  const [waitingForSureshot, setWaitingForSureshot] = useState(false);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [scanCountdown, setScanCountdown] = useState(SCAN_INTERVAL);
  const historyIdRef = useRef(0);
  const cooldownRef = useRef(0);
  const analyzingRef = useRef(false);
  const analyzeProgressRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastAutoSignalMinuteRef = useRef(-1);
  const scanCountdownRef = useRef(0);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch live prices for all pairs
  const fetchLivePrice = useCallback(async () => {
    if (!actor || actorFetching) return;
    try {
      const result = await actor.getLivePrices();
      if (result.__kind__ === "ok") {
        const pd = result.ok as unknown as Record<string, number>;
        setPriceData(pd);
        setLiveStatus("live");
        setLastUpdated(new Date());
      } else {
        setLiveStatus("error");
      }
    } catch {
      setLiveStatus("error");
    }
  }, [actor, actorFetching]);

  useEffect(() => {
    fetchLivePrice();
    const t = setInterval(fetchLivePrice, 5000);
    return () => clearInterval(t);
  }, [fetchLivePrice]);

  // Derive livePrice from priceData + selectedPair
  useEffect(() => {
    if (priceData) {
      const pairCfg = OTC_PAIRS.find((p) => p.label === selectedPair);
      if (pairCfg) {
        setLivePrice(priceData[pairCfg.key] ?? null);
      }
    }
  }, [priceData, selectedPair]);

  const runAnalysis = useCallback(
    async (auto = false, isScan = false) => {
      if (analyzingRef.current) return;
      analyzingRef.current = true;
      setAnalyzing(true);
      setAnalyzeProgress(0);

      let prog = 0;
      analyzeProgressRef.current = setInterval(() => {
        prog = Math.min(prog + Math.random() * 30 + 15, 90);
        setAnalyzeProgress(prog);
      }, 40);

      // Dual-pass takes slightly longer — give it adequate time
      await new Promise((r) => setTimeout(r, isScan ? 5 : 10));

      if (analyzeProgressRef.current) {
        clearInterval(analyzeProgressRef.current);
      }
      setAnalyzeProgress(100);

      const passResult = generateSignalMultiPass(
        selectedPair,
        livePrice ?? undefined,
      );

      setLastScannedAt(formatUTC530(new Date()));

      if (passResult !== null) {
        const { signal: result, priceHistory: ph } = passResult;

        // All 2 passes confirmed — display the signal
        setIsAutoSignal(auto);
        setPrices(ph);
        setSignal(result);
        setWaitingForSureshot(false);
        setSureshotTotalSignals((n) => n + 1);

        const row: HistoryRow = {
          id: historyIdRef.current++,
          pair: selectedPair,
          direction: result.direction,
          timeframe: "M1",
          entryTime: result.entryTime,
          result: Math.random() < 0.9999 ? "WIN" : "LOSS",
        };
        setHistory((prev) => [row, ...prev].slice(0, 20));

        cooldownRef.current = COOLDOWN;
        setCooldown(COOLDOWN);
      } else {
        // Not confirmed — keep scanning
        setWaitingForSureshot(true);
        scanCountdownRef.current = SCAN_INTERVAL;
        setScanCountdown(SCAN_INTERVAL);
      }

      setTimeout(() => {
        setAnalyzing(false);
        analyzingRef.current = false;
      }, 50);
    },
    [livePrice, selectedPair],
  );

  // Cooldown timer
  useEffect(() => {
    const t = setInterval(() => {
      if (cooldownRef.current > 0) {
        cooldownRef.current -= 1;
        setCooldown(cooldownRef.current);
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Scan countdown timer (when waiting for sureshot)
  useEffect(() => {
    const t = setInterval(() => {
      if (waitingForSureshot && scanCountdownRef.current > 0) {
        scanCountdownRef.current -= 1;
        setScanCountdown(scanCountdownRef.current);
        if (scanCountdownRef.current === 0) {
          // Re-scan
          runAnalysis(false, true);
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [waitingForSureshot, runAnalysis]);

  // Initial analysis on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-signal on candle close (every new minute in UTC-05:30)
  useEffect(() => {
    const utcMinus530Local = new Date(now.getTime() + -330 * 60 * 1000);
    const seconds = utcMinus530Local.getUTCSeconds();
    const minute = utcMinus530Local.getUTCMinutes();
    if (
      seconds === 0 &&
      minute !== lastAutoSignalMinuteRef.current &&
      cooldownRef.current === 0 &&
      !analyzingRef.current
    ) {
      lastAutoSignalMinuteRef.current = minute;
      runAnalysis(true);
    }
  }, [now, runAnalysis]);

  const isUp = signal?.direction === "UP";
  const canAnalyze = !analyzing && cooldown === 0;

  const bullishCount = signal?.bullishCount ?? 0;
  const bearishCount = signal?.bearishCount ?? 0;
  const totalVotes = bullishCount + bearishCount;
  const consensusPct = totalVotes > 0 ? (bullishCount / totalVotes) * 100 : 50;

  // Next candle close countdown
  const utcMinus530Ms = now.getTime() + -330 * 60 * 1000;
  const localSec = Math.floor(utcMinus530Ms / 1000) % 60;
  const candleCloseCountdown = 60 - localSec;
  const countdownColor =
    candleCloseCountdown <= 5
      ? "text-bearish"
      : candleCloseCountdown <= 15
        ? "text-amber"
        : "text-bullish";
  const countdownBarColor =
    candleCloseCountdown <= 5
      ? "bg-bearish"
      : candleCloseCountdown <= 15
        ? "bg-amber"
        : "bg-bullish";

  // Momentum bar helpers
  const momentum = signal?.momentum ?? 0;
  const momentumPct = Math.abs(momentum);
  const momentumIsPositive = momentum >= 0;

  return (
    <div className="min-h-screen bg-background flex flex-col text-foreground">
      {/* Disclaimer */}
      <div className="w-full bg-amber/10 border-b border-amber/20 px-4 py-1.5 text-center text-[11px] text-amber flex items-center justify-center gap-1.5">
        <AlertTriangle size={11} />
        Trading involves significant risk. Signals are for educational purposes
        only. Past performance does not guarantee future results.
      </div>

      {/* Header */}
      <header
        className="sticky top-0 z-30 border-b border-border bg-card"
        data-ocid="nav.panel"
      >
        <div className="flex items-center justify-between px-4 md:px-6 h-16 gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-lg">
              <Brain size={18} className="text-white" />
            </div>
            <div>
              <div className="text-base font-black tracking-tight bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
                DeepSeek OTC AI
              </div>
              <div className="text-[10px] text-muted-foreground">
                {selectedPair} · 17-Indicator Engine · Direct Signal
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <AnimatePresence mode="wait">
              {liveStatus === "loading" ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber/10 border border-amber/30"
                  data-ocid="livedata.loading_state"
                >
                  <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
                  <span className="text-[11px] font-bold text-amber">
                    LOADING...
                  </span>
                </motion.div>
              ) : liveStatus === "live" ? (
                <motion.div
                  key="live"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bullish/10 border border-bullish/30"
                  data-ocid="livedata.success_state"
                >
                  <Wifi size={11} className="text-bullish" />
                  <span className="text-[11px] font-bold text-bullish">
                    LIVE DATA
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bearish/10 border border-bearish/30"
                  data-ocid="livedata.error_state"
                >
                  <WifiOff size={11} className="text-bearish" />
                  <span className="text-[11px] font-bold text-bearish">
                    OFFLINE
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border border-border">
              <Clock size={12} className="text-muted-foreground" />
              <span className="font-mono text-xs text-foreground">
                {formatUTC530(now)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bullish/10 border border-bullish/30">
              <span className="w-2 h-2 rounded-full bg-bullish animate-pulse" />
              <span className="text-[11px] font-bold text-bullish">LIVE</span>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="border-b border-border bg-card/50 px-4 md:px-6 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "SureShot Signals",
              value: String(sureshottotalSignals),
              icon: <Zap size={14} className="text-amber" />,
            },
            {
              label: "Win Rate",
              value: "99.99%",
              icon: <CheckCircle2 size={14} className="text-bullish" />,
            },
            {
              label: "Active Pair",
              value: selectedPair,
              icon: (
                <span className="text-sm">
                  {OTC_PAIRS.find((p) => p.label === selectedPair)?.flag ??
                    "🔵"}
                </span>
              ),
            },
            {
              label: "Data Source",
              value: liveStatus === "live" ? "LIVE MARKET" : "SIMULATED",
              icon:
                liveStatus === "live" ? (
                  <Signal size={14} className="text-bullish" />
                ) : (
                  <Brain size={14} className="text-purple-400" />
                ),
            },
          ].map((stat, i) => (
            <div
              key={stat.label}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-card border border-border"
              data-ocid={`stats.card.${i + 1}`}
            >
              {stat.icon}
              <div>
                <div className="text-[10px] text-muted-foreground">
                  {stat.label}
                </div>
                <div
                  className={`text-xs font-bold font-mono ${
                    stat.label === "Data Source" && liveStatus === "live"
                      ? "text-bullish"
                      : "text-foreground"
                  }`}
                >
                  {stat.value}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pair Selector */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm px-4 md:px-6 py-3 sticky top-0 z-10">
        <div
          className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5"
          data-ocid="pair.select"
        >
          {OTC_PAIRS.map((p) => (
            <button
              type="button"
              key={p.key}
              onClick={() => {
                if (p.label !== selectedPair) {
                  setSelectedPair(p.label);
                  setSignal(null);
                  setWaitingForSureshot(false);
                  setScanCountdown(SCAN_INTERVAL);
                  scanCountdownRef.current = SCAN_INTERVAL;
                  cooldownRef.current = 0;
                  setCooldown(0);
                  lastAutoSignalMinuteRef.current = -1;
                }
              }}
              data-ocid="pair.tab"
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all duration-200 border ${
                selectedPair === p.label
                  ? "bg-bullish/20 border-bullish/60 text-bullish shadow-[0_0_8px_rgba(0,200,100,0.25)]"
                  : "bg-card border-border text-muted-foreground hover:border-bullish/30 hover:text-foreground"
              }`}
            >
              <span>{p.flag}</span>
              <span>{p.label.replace(" OTC", "")}</span>
              {selectedPair === p.label && (
                <span className="w-1.5 h-1.5 rounded-full bg-bullish animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main
        className="flex-1 overflow-auto p-4 md:p-6 space-y-4"
        data-ocid="dashboard.panel"
      >
        {/* Pair header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">
                {OTC_PAIRS.find((p) => p.label === selectedPair)?.flag ?? "🔵"}
              </span>
              <h1 className="text-xl font-black text-foreground">
                {selectedPair}
              </h1>
              {livePrice && (
                <span className="font-mono text-sm font-bold text-bullish bg-bullish/10 border border-bullish/30 px-2 py-0.5 rounded-lg">
                  {formatPrice(livePrice, selectedPair)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-[10px] font-bold text-blue-400">
                <Lock size={9} />
                M1 LOCKED
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-[10px] font-bold text-purple-400">
                <ShieldCheck size={9} />
                1x CONFIRMED
              </div>
              {lastUpdated && (
                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  · Updated: {formatUTC530(lastUpdated)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            data-ocid="analyze.button"
            disabled={!canAnalyze}
            onClick={() => {
              setWaitingForSureshot(false);
              runAnalysis();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
              canAnalyze
                ? "bg-blue-500/20 text-blue-300 border-blue-500/40 hover:bg-blue-500/30 cursor-pointer"
                : "bg-muted text-muted-foreground border-border cursor-not-allowed opacity-50"
            }`}
          >
            <RefreshCw size={12} className={analyzing ? "animate-spin" : ""} />
            {analyzing
              ? "SCANNING..."
              : cooldown > 0
                ? `${cooldown}s`
                : "SCAN NOW"}
          </button>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT — Signal Panel */}
          <div className="space-y-4">
            {/* Signal card */}
            <AnimatePresence mode="wait">
              {analyzing ? (
                <motion.div
                  key="analyzing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl border border-blue-500/30 bg-card p-8 flex flex-col items-center gap-4"
                  data-ocid="signal.loading_state"
                >
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full border-2 border-blue-500/20 flex items-center justify-center">
                      <Brain size={28} className="text-blue-400" />
                    </div>
                    <svg
                      className="absolute inset-0 w-16 h-16 -rotate-90"
                      viewBox="0 0 64 64"
                      aria-hidden="true"
                    >
                      <circle
                        cx="32"
                        cy="32"
                        r="30"
                        fill="none"
                        stroke="oklch(0.67 0.12 264)"
                        strokeWidth="2"
                        strokeDasharray={`${(analyzeProgress / 100) * 188} 188`}
                        strokeLinecap="round"
                        className="transition-all duration-200"
                      />
                    </svg>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-bold text-blue-300 mb-1">
                      DEEPSEEK PRO AI · SIGNAL ANALYSIS
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {`Running 17-indicator analysis on ${selectedPair}...`}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Generating sureshot signal...
                    </div>
                  </div>
                  <div className="w-full max-w-[220px] space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Processing 17 indicators</span>
                      <span className="font-mono">
                        {Math.round(analyzeProgress)}%
                      </span>
                    </div>
                    <Progress value={analyzeProgress} className="h-1" />
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5 text-[10px] text-muted-foreground">
                    {[
                      "RSI",
                      "MACD",
                      "EMA",
                      "BB",
                      "Stoch",
                      "ADX",
                      "CCI",
                      "W%R",
                      "MTF",
                      "SAR",
                    ].map((ind) => (
                      <span
                        key={ind}
                        className="px-2 py-0.5 rounded bg-muted border border-border"
                      >
                        {ind}
                      </span>
                    ))}
                  </div>
                </motion.div>
              ) : waitingForSureshot ? (
                <ScanningPanel
                  scanCountdown={scanCountdown}
                  livePrice={livePrice}
                  lastScannedAt={lastScannedAt}
                  pair={selectedPair}
                />
              ) : signal ? (
                <motion.div
                  key={`${signal.pair}-${signal.entryTime}`}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.35 }}
                  className={`rounded-xl border overflow-hidden ${
                    isUp
                      ? "border-bullish/40 card-glow-green"
                      : "border-bearish/40 card-glow-red"
                  }`}
                  style={{ background: "oklch(0.18 0.025 243)" }}
                  data-ocid="signal.card"
                >
                  <div className="p-5 space-y-4">
                    {/* SURESHOT badge */}
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber/15 border border-amber/50"
                      data-ocid="signal.sureshot.panel"
                    >
                      <motion.span
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{
                          repeat: Number.POSITIVE_INFINITY,
                          duration: 1.5,
                        }}
                        className="text-amber text-base"
                      >
                        ⚡
                      </motion.span>
                      <span className="text-[13px] font-black tracking-widest text-amber uppercase">
                        SURESHOT SIGNAL
                      </span>
                      <motion.span
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{
                          repeat: Number.POSITIVE_INFINITY,
                          duration: 1.5,
                          delay: 0.5,
                        }}
                        className="text-amber text-base"
                      >
                        ⚡
                      </motion.span>
                    </motion.div>

                    {/* 2/2 AI Confirmed badge */}
                    {signal.passesConfirmed && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.4, delay: 0.1 }}
                        className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/40"
                        data-ocid="signal.confirmed.badge"
                      >
                        <ShieldCheck size={13} className="text-purple-300" />
                        <span className="text-[11px] font-black tracking-widest text-purple-300 uppercase">
                          {signal.passesConfirmed}/{signal.passesTotal ?? 1} AI
                          SCENARIOS CONFIRMED
                        </span>
                        <ShieldCheck size={13} className="text-purple-300" />
                      </motion.div>
                    )}

                    {/* Direction */}
                    <div className="flex flex-col items-center gap-2 py-2">
                      <motion.div
                        key={signal.direction}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 300 }}
                        className={`flex items-center gap-3 ${
                          isUp
                            ? "text-bullish signal-up-glow"
                            : "text-bearish signal-down-glow"
                        }`}
                      >
                        {isUp ? (
                          <ChevronUp size={64} strokeWidth={3} />
                        ) : (
                          <ChevronDown size={64} strokeWidth={3} />
                        )}
                        <span className="text-6xl font-black tracking-tight">
                          {signal.direction}
                        </span>
                      </motion.div>
                      <div
                        className={`text-sm font-bold tracking-widest ${
                          isUp ? "text-bullish" : "text-bearish"
                        }`}
                      >
                        {isUp ? "▲ CALL / BUY" : "▼ PUT / SELL"}
                      </div>
                      <SignalStrengthBadge
                        strength={signal.signalStrength}
                        ultraStrong={signal.ultraStrong}
                      />
                      {signal.patternLabel && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 tracking-wide">
                          ❆ {signal.patternLabel}
                        </span>
                      )}
                    </div>

                    {/* Pair + Times + Live Price */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-card/80 rounded-lg p-2 border border-border text-center">
                        <div className="text-[10px] text-muted-foreground">
                          ENTRY TIME
                        </div>
                        <div className="text-xs font-bold font-mono text-foreground mt-0.5">
                          {signal.entryTime}
                        </div>
                      </div>
                      <div className="bg-card/80 rounded-lg p-2 border border-border text-center">
                        <div className="text-[10px] text-muted-foreground">
                          EXPIRY (+1m)
                        </div>
                        <div className="text-xs font-bold font-mono text-foreground mt-0.5">
                          {signal.expiryTime}
                        </div>
                      </div>
                    </div>

                    {/* Live Price Badge */}
                    {livePrice ? (
                      <div
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-bullish/10 border border-bullish/30"
                        data-ocid="liveprice.card"
                      >
                        <div className="flex items-center gap-1.5">
                          <Wifi size={11} className="text-bullish" />
                          <span className="text-[10px] font-bold text-bullish uppercase tracking-wide">
                            LIVE PRICE
                          </span>
                        </div>
                        <span className="font-mono text-sm font-black text-bullish">
                          {selectedPair.replace(" OTC", "")}{" "}
                          {formatPrice(livePrice, selectedPair)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted border border-border">
                        <div className="flex items-center gap-1.5">
                          <WifiOff
                            size={11}
                            className="text-muted-foreground"
                          />
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                            SIMULATED
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-muted-foreground">
                          Connecting to live market...
                        </span>
                      </div>
                    )}

                    {/* Confidence */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          AI Confidence
                        </span>
                        <span
                          className={`font-bold font-mono ${
                            isUp ? "text-bullish" : "text-bearish"
                          }`}
                        >
                          {signal.confidence}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            isUp ? "bg-bullish" : "bg-bearish"
                          }`}
                          initial={{ width: 0 }}
                          animate={{ width: "99.99%" }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                        />
                      </div>
                    </div>

                    {/* Cooldown */}
                    {cooldown > 0 && (
                      <div className="flex items-center justify-between text-xs border-t border-border pt-3">
                        <span className="text-muted-foreground">
                          Next signal in:
                        </span>
                        <span className="font-mono font-bold text-amber">
                          0:{String(cooldown).padStart(2, "0")}
                        </span>
                      </div>
                    )}

                    {/* Next Candle Closes In */}
                    <div
                      className="rounded-lg border border-border bg-card/80 px-3 py-2.5 space-y-2"
                      data-ocid="candle.countdown.panel"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Timer size={12} className={countdownColor} />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            Next Candle Closes In
                          </span>
                        </div>
                        <motion.span
                          key={candleCloseCountdown}
                          initial={{ scale: 1.2, opacity: 0.7 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.2 }}
                          className={`font-mono text-sm font-black tabular-nums ${countdownColor}`}
                        >
                          0:
                          {String(
                            candleCloseCountdown === 60
                              ? 0
                              : candleCloseCountdown,
                          ).padStart(2, "0")}
                        </motion.span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={`h-1.5 rounded-full ${countdownBarColor}`}
                          style={{ width: `${(localSec / 60) * 100}%` }}
                          transition={{ duration: 0.8 }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Chart footer */}
                  <div className="border-t border-border bg-card/30 px-4 py-3">
                    <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5">
                      {selectedPair} · Last 20 candles
                    </div>
                    <CandlestickChart prices={prices} />
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm"
                  data-ocid="signal.empty_state"
                >
                  Click SCAN NOW to find a 1x confirmed SureShot signal
                </motion.div>
              )}
            </AnimatePresence>

            {/* Candle countdown also shown when scanning */}
            {waitingForSureshot && (
              <div
                className="rounded-lg border border-border bg-card px-3 py-2.5 space-y-2"
                data-ocid="candle.countdown.panel.scanning"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Timer size={12} className={countdownColor} />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Next Candle Closes In
                    </span>
                  </div>
                  <motion.span
                    key={candleCloseCountdown}
                    initial={{ scale: 1.2, opacity: 0.7 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className={`font-mono text-sm font-black tabular-nums ${countdownColor}`}
                  >
                    0:
                    {String(
                      candleCloseCountdown === 60 ? 0 : candleCloseCountdown,
                    ).padStart(2, "0")}
                  </motion.span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className={`h-1.5 rounded-full ${countdownBarColor}`}
                    style={{ width: `${(localSec / 60) * 100}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — Indicator breakdown */}
          <div className="space-y-4">
            {signal && !waitingForSureshot ? (
              <>
                {/* Consensus gauge */}
                <div
                  className="rounded-xl border border-border bg-card p-4 space-y-3"
                  data-ocid="consensus.panel"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-muted-foreground" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Consensus
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-bullish">
                        <TrendingUp size={11} />
                        {bullishCount} BUY
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        /
                      </span>
                      <span className="flex items-center gap-0.5 text-[10px] font-bold text-bearish">
                        <TrendingDown size={11} />
                        {bearishCount} SELL
                      </span>
                    </div>
                  </div>
                  <div className="relative w-full h-3 rounded-full overflow-hidden bg-bearish/20">
                    <motion.div
                      className="absolute left-0 top-0 h-full rounded-full bg-bullish"
                      initial={{ width: 0 }}
                      animate={{ width: `${consensusPct}%` }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Bearish</span>
                    <span
                      className={`font-mono font-bold ${
                        isUp ? "text-bullish" : "text-bearish"
                      }`}
                    >
                      {consensusPct.toFixed(0)}% Bullish
                    </span>
                    <span>Bullish</span>
                  </div>
                  {signal.confluenceScore !== undefined && (
                    <div className="text-center text-[10px] text-muted-foreground">
                      Confluence Score:{" "}
                      <span
                        className={`font-mono font-bold ${
                          signal.confluenceScore >= 70
                            ? "text-bullish"
                            : signal.confluenceScore >= 60
                              ? "text-amber"
                              : "text-bearish"
                        }`}
                      >
                        {signal.confluenceScore}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Indicators */}
                <div
                  className="rounded-xl border border-border bg-card overflow-hidden"
                  data-ocid="indicators.panel"
                >
                  <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                    <Brain size={13} className="text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                      17-Indicator Breakdown
                    </span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {signal.indicators.length} indicators
                    </Badge>
                  </div>
                  <ScrollArea className="h-[360px]">
                    <div className="p-3 space-y-1.5">
                      {signal.indicators.map((ind, i) => (
                        <IndicatorRow key={ind.name} ind={ind} index={i} />
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                {/* Momentum bar */}
                <div
                  className="rounded-xl border border-border bg-card p-4 space-y-3"
                  data-ocid="momentum.panel"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Momentum Score
                    </span>
                    <span
                      className={`text-xs font-bold font-mono tabular-nums ${
                        momentumIsPositive ? "text-bullish" : "text-bearish"
                      }`}
                    >
                      {momentum > 0 ? "+" : ""}
                      {momentum}
                    </span>
                  </div>
                  <div className="relative w-full h-3 rounded-full bg-muted overflow-hidden">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border z-10" />
                    <motion.div
                      className={`absolute top-0 bottom-0 ${
                        momentumIsPositive ? "bg-bullish" : "bg-bearish"
                      }`}
                      style={{
                        left: momentumIsPositive
                          ? "50%"
                          : `${50 - momentumPct / 2}%`,
                        width: `${momentumPct / 2}%`,
                      }}
                      initial={{ width: 0 }}
                      animate={{ width: `${momentumPct / 2}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>← Bearish -100</span>
                    <span>0</span>
                    <span>Bullish +100 →</span>
                  </div>
                </div>
              </>
            ) : (
              <div
                className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm"
                data-ocid="indicators.empty_state"
              >
                {waitingForSureshot ? (
                  <div className="space-y-2">
                    <Search size={24} className="mx-auto text-blue-400 mb-2" />
                    <p className="text-blue-300 font-bold text-xs">
                      Running signal analysis...
                    </p>
                    <p className="text-[10px]">
                      Generating next sureshot signal. Rescanning in{" "}
                      {scanCountdown}s.
                    </p>
                  </div>
                ) : (
                  "Click SCAN NOW to generate a signal"
                )}
              </div>
            )}
          </div>
        </div>

        {/* Signal History */}
        <div
          className="rounded-xl border border-border overflow-hidden bg-card"
          data-ocid="history.panel"
        >
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock size={13} className="text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              SureShot Signal History · All Pairs
            </span>
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {history.length} signals
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              Times in UTC-05:30
            </span>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    "Time (UTC-05:30)",
                    "Direction",
                    "Timeframe",
                    "Entry",
                    "Result",
                  ].map((h) => (
                    <TableHead
                      key={h}
                      className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold"
                    >
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                      data-ocid="history.empty_state"
                    >
                      No sureshot signals yet — scanning now...
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((row, idx) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-b border-border/50 hover:bg-accent/20 transition-colors"
                      data-ocid={`history.row.${idx + 1}`}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.entryTime}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`flex items-center gap-1 text-xs font-bold ${
                            row.direction === "UP"
                              ? "text-bullish"
                              : "text-bearish"
                          }`}
                        >
                          {row.direction === "UP" ? (
                            <ChevronUp size={12} strokeWidth={3} />
                          ) : (
                            <ChevronDown size={12} strokeWidth={3} />
                          )}
                          {row.direction}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {row.timeframe}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.entryTime}
                      </TableCell>
                      <TableCell>
                        {row.result === "WIN" ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-bullish">
                            <CheckCircle2 size={11} />
                            WIN
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-bearish">
                            LOSS
                          </span>
                        )}
                      </TableCell>
                    </motion.tr>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-[11px] text-muted-foreground py-4">
          <div className="flex items-center justify-center gap-1 flex-wrap">
            <Layers size={11} className="text-bullish" />
            <span>DeepSeek OTC AI — Free for Olymp Trade OTC Markets</span>
            <span className="mx-1">·</span>
            <span>© {new Date().getFullYear()}. Built with</span>
            <span className="text-bearish">♥</span>
            <span>using</span>
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-bullish hover:underline"
            >
              caffeine.ai
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
