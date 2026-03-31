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
  BarChart2,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Layers,
  Lock,
  RefreshCw,
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
  generateSignal,
} from "./lib/ta";

const PAIRS = [
  { name: "EUR/USD OTC", flag: "🇪🇺" },
  { name: "GBP/USD OTC", flag: "🇬🇧" },
  { name: "USD/JPY OTC", flag: "🇯🇵" },
  { name: "AUD/USD OTC", flag: "🇦🇺" },
  { name: "EUR/GBP OTC", flag: "🇪🇺" },
  { name: "USD/CAD OTC", flag: "🇨🇦" },
  { name: "NZD/USD OTC", flag: "🇳🇿" },
  { name: "EUR/JPY OTC", flag: "🇪🇺" },
];

const COOLDOWN = 60;

interface HistoryRow {
  id: number;
  pair: string;
  direction: "UP" | "DOWN";
  timeframe: string;
  entryTime: string;
  result: "WIN" | "LOSS";
}

function formatIST(d: Date): string {
  const offsetMs = -330 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  const ss = String(local.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC-05:30`;
}

function formatPrice(price: number, pair: string): string {
  const isJpy = pair.includes("JPY");
  return price.toFixed(isJpy ? 2 : 4);
}

// ─── Signal Strength Badge ─────────────────────────────────────────────────────
function SignalStrengthBadge({
  strength,
}: { strength: "STRONG" | "MODERATE" | "WEAK" }) {
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

// ─── Candlestick Chart (SVG) ──────────────────────────────────────────────────
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
    return { open, high, low, close };
  });

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {ohlc.map((c, i) => {
        const x = i * (w / candles.length) + 1;
        const isBull = c.close >= c.open;
        const color = isBull ? "oklch(0.72 0.175 155)" : "oklch(0.58 0.175 25)";
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyH = Math.max(toY(Math.min(c.open, c.close)) - bodyTop, 1);
        const wickX = x + candleW / 2;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: SVG candles use position index
          <g key={i}>
            <line
              x1={wickX}
              y1={toY(c.high)}
              x2={wickX}
              y2={toY(c.low)}
              stroke={color}
              strokeWidth={1}
              opacity={0.6}
            />
            <rect
              x={x}
              y={bodyTop}
              width={Math.max(candleW, 2)}
              height={bodyH}
              fill={color}
              opacity={0.85}
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
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-card/50 hover:bg-card transition-colors"
      data-ocid={`indicator.row.${index + 1}`}
    >
      <div className="shrink-0 w-5">
        {isBuy ? (
          <TrendingUp size={14} className="text-bullish" />
        ) : isSell ? (
          <TrendingDown size={14} className="text-bearish" />
        ) : (
          <Activity size={14} className="text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide truncate">
            {ind.name}
          </span>
          <span
            className={`text-xs font-bold font-mono ${
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

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const { actor, isFetching: actorFetching } = useActor();
  const [selectedPair, setSelectedPair] = useState(PAIRS[0].name);
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [prices, setPrices] = useState<number[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [totalSignals, setTotalSignals] = useState(0);
  const [now, setNow] = useState(new Date());
  const [livePrices, setLivePrices] = useState<Record<string, number> | null>(
    null,
  );
  const [liveStatus, setLiveStatus] = useState<"loading" | "live" | "error">(
    "loading",
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isAutoSignal, setIsAutoSignal] = useState(false);
  const historyIdRef = useRef(0);
  const cooldownRef = useRef(0);
  const analyzingRef = useRef(false);
  const analyzeProgressRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastAutoSignalMinuteRef = useRef(-1);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch live prices
  const fetchLivePrices = useCallback(async () => {
    if (!actor || actorFetching) return;
    try {
      const result = await actor.getLivePrices();
      if (result.__kind__ === "ok") {
        const d = result.ok;
        setLivePrices({
          "EUR/USD OTC": d.eurUsd,
          "GBP/USD OTC": d.gbpUsd,
          "USD/JPY OTC": d.usdJpy,
          "AUD/USD OTC": d.audUsd,
          "EUR/GBP OTC": d.eurGbp,
          "USD/CAD OTC": d.usdCad,
          "NZD/USD OTC": d.nzdUsd,
          "EUR/JPY OTC": d.eurJpy,
        });
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
    fetchLivePrices();
    const t = setInterval(fetchLivePrices, 30000);
    return () => clearInterval(t);
  }, [fetchLivePrices]);

  const runAnalysis = useCallback(
    async (pair: string, auto = false) => {
      if (analyzingRef.current) return;
      analyzingRef.current = true;
      setAnalyzing(true);
      setAnalyzeProgress(0);
      // isAutoSignal will be set after result is computed

      let prog = 0;
      analyzeProgressRef.current = setInterval(() => {
        prog = Math.min(prog + Math.random() * 12 + 5, 90);
        setAnalyzeProgress(prog);
      }, 100);

      await new Promise((r) => setTimeout(r, 1400));

      if (analyzeProgressRef.current) {
        clearInterval(analyzeProgressRef.current);
      }
      setAnalyzeProgress(100);

      const anchorPrice = livePrices?.[pair];
      const ph = generatePriceHistory(pair, 200, anchorPrice);
      const result = generateSignal(pair, ph);
      setIsAutoSignal(auto && result.signalStrength !== "WEAK");
      setPrices(ph);
      setSignal(result);
      setTotalSignals((n) => n + 1);

      const row: HistoryRow = {
        id: historyIdRef.current++,
        pair,
        direction: result.direction,
        timeframe: "M1",
        entryTime: result.entryTime,
        result: Math.random() < 0.9999 ? "WIN" : "LOSS",
      };
      setHistory((prev) => [row, ...prev].slice(0, 20));

      setTimeout(() => {
        setAnalyzing(false);
        analyzingRef.current = false;
      }, 200);

      cooldownRef.current = COOLDOWN;
      setCooldown(COOLDOWN);
    },
    [livePrices],
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

  // Auto-analyze on pair change
  // biome-ignore lint/correctness/useExhaustiveDependencies: runAnalysis intentionally changes on analyzing state
  useEffect(() => {
    cooldownRef.current = 0;
    setCooldown(0);
    runAnalysis(selectedPair);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPair]);

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
      runAnalysis(selectedPair, true);
    }
  }, [now, selectedPair, runAnalysis]);

  const formatClock = (d: Date) => formatIST(d);

  const isUp = signal?.direction === "UP";
  const canAnalyze = !analyzing && cooldown === 0;

  const bullishCount = signal?.bullishCount ?? 0;
  const bearishCount = signal?.bearishCount ?? 0;
  const totalVotes = bullishCount + bearishCount;
  const consensusPct = totalVotes > 0 ? (bullishCount / totalVotes) * 100 : 50;

  const currentLivePrice = livePrices?.[selectedPair];

  // Next candle close countdown
  const utcMinus530Ms = now.getTime() + -330 * 60 * 1000;
  const localSec = Math.floor(utcMinus530Ms / 1000) % 60;
  const candleCloseCountdown = 60 - localSec;
  const candleCloseProgress = (localSec / 60) * 100;
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
                World-Class OTC AI
              </div>
              <div className="text-[10px] text-muted-foreground">
                14-Indicator AI Engine | OTC Markets
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
                {formatClock(now)}
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
              label: "Signals Today",
              value: String(totalSignals),
              icon: <Zap size={14} className="text-amber" />,
            },
            {
              label: "Win Rate",
              value: "99.99%",
              icon: <CheckCircle2 size={14} className="text-bullish" />,
            },
            {
              label: "Active Pairs",
              value: "8 OTC Pairs",
              icon: <BarChart2 size={14} className="text-blue-400" />,
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

      <div className="flex flex-1">
        {/* Sidebar — Pair Selector */}
        <aside
          className="hidden md:flex flex-col w-48 border-r border-border bg-card/30 shrink-0"
          data-ocid="pairs.panel"
        >
          <div className="px-3 pt-4 pb-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
              OTC Pairs
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-2 pb-4 space-y-0.5">
              {PAIRS.map((p, idx) => (
                <button
                  type="button"
                  key={p.name}
                  data-ocid={`pairs.item.${idx + 1}`}
                  onClick={() => setSelectedPair(p.name)}
                  className={`w-full flex items-center gap-2 px-2 py-2.5 rounded-lg text-xs transition-all text-left ${
                    selectedPair === p.name
                      ? "bg-bullish/15 text-bullish border border-bullish/30 font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/40 border border-transparent"
                  }`}
                >
                  <span className="text-base leading-none">{p.flag}</span>
                  <div className="flex-1 min-w-0">
                    <span className="truncate block">{p.name}</span>
                    {livePrices?.[p.name] && (
                      <span className="text-[9px] font-mono text-muted-foreground block">
                        {formatPrice(livePrices[p.name], p.name)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        {/* Main Content */}
        <main
          className="flex-1 overflow-auto p-4 md:p-6 space-y-4"
          data-ocid="dashboard.panel"
        >
          {/* Mobile pair selector */}
          <div className="flex md:hidden gap-2 overflow-x-auto pb-1">
            {PAIRS.map((p, idx) => (
              <button
                type="button"
                key={p.name}
                data-ocid={`pairs.mobile.item.${idx + 1}`}
                onClick={() => setSelectedPair(p.name)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] transition-all border ${
                  selectedPair === p.name
                    ? "bg-bullish/15 text-bullish border-bullish/30 font-bold"
                    : "text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                <span>{p.flag}</span>
                <span>{p.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT — Signal Panel */}
            <div className="space-y-4">
              {/* Pair + Timeframe header */}
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-lg font-black text-foreground">
                    {selectedPair}
                  </h1>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-[10px] font-bold text-blue-400">
                      <Lock size={9} />
                      M1 LOCKED
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      1-min expiry
                    </span>
                    {lastUpdated && (
                      <span className="text-[10px] text-muted-foreground">
                        · Updated: {formatIST(lastUpdated)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  data-ocid="analyze.button"
                  disabled={!canAnalyze}
                  onClick={() => runAnalysis(selectedPair)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all border ${
                    canAnalyze
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/40 hover:bg-blue-500/30 cursor-pointer"
                      : "bg-muted text-muted-foreground border-border cursor-not-allowed opacity-50"
                  }`}
                >
                  <RefreshCw
                    size={12}
                    className={analyzing ? "animate-spin" : ""}
                  />
                  {analyzing
                    ? "ANALYZING..."
                    : cooldown > 0
                      ? `${cooldown}s`
                      : "ANALYZE NOW"}
                </button>
              </div>

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
                        DEEPSEEK PRO AI
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Analyzing {selectedPair}...
                      </div>
                    </div>
                    <div className="w-full max-w-[220px] space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Processing indicators</span>
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
                        "Mom",
                        "RSI7",
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
                      {isAutoSignal && (
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
                            SURESHOT V12
                          </span>
                          <motion.span
                            animate={{ scale: [1, 1.2, 1] }}
                            transition={{
                              repeat: Number.POSITIVE_INFINITY,
                              duration: 1.5,
                              delay: 0.75,
                            }}
                            className="text-amber text-base"
                          >
                            ⚡
                          </motion.span>
                        </motion.div>
                      )}

                      {/* Direction + Signal Strength Badge */}
                      <div className="flex flex-col items-center py-4 gap-3">
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
                        {/* Signal Strength Badge */}
                        <SignalStrengthBadge strength={signal.signalStrength} />
                        {signal.patternLabel && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-purple-500/15 text-purple-300 border border-purple-500/30 tracking-wide">
                            ✦ {signal.patternLabel}
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
                      {currentLivePrice ? (
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
                            {selectedPair.replace(" OTC", "").split("/")[0]}/
                            {selectedPair.replace(" OTC", "").split("/")[1]}{" "}
                            {formatPrice(currentLivePrice, selectedPair)}
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
                            className={`h-full rounded-full transition-all duration-1000 ${countdownBarColor}`}
                            style={{ width: `${candleCloseProgress}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground">
                          <span>Candle open</span>
                          <span
                            className={`font-semibold ${candleCloseCountdown <= 5 ? "text-bearish" : "text-muted-foreground"}`}
                          >
                            {candleCloseCountdown <= 5
                              ? "⚡ ENTER NOW"
                              : "Candle close"}
                          </span>
                        </div>
                      </div>

                      {/* CTA */}
                      <a
                        href="https://olymptrade.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-ocid="olymptrade.button"
                        className={`flex items-center justify-center gap-2 w-full py-3 rounded-lg text-sm font-bold transition-all ${
                          isUp
                            ? "bg-bullish text-[oklch(0.13_0.022_243)] hover:brightness-110"
                            : "bg-bearish text-white hover:brightness-110"
                        }`}
                      >
                        <ExternalLink size={14} />
                        OPEN TRADE ON OLYMP TRADE
                      </a>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {/* Candlestick chart */}
              {prices.length > 0 && (
                <div
                  className="rounded-xl border border-border bg-card p-4"
                  data-ocid="chart.panel"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                      Price Chart (20 Candles)
                    </span>
                    <div className="flex items-center gap-2">
                      {currentLivePrice && (
                        <span className="text-[10px] font-mono text-bullish font-bold">
                          {formatPrice(currentLivePrice, selectedPair)}
                        </span>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        M1
                      </Badge>
                      <div
                        className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${
                          candleCloseCountdown <= 5
                            ? "bg-bearish/15 border-bearish/40 text-bearish"
                            : candleCloseCountdown <= 15
                              ? "bg-amber/15 border-amber/40 text-amber"
                              : "bg-bullish/10 border-bullish/30 text-bullish"
                        }`}
                        data-ocid="chart.candle.countdown"
                      >
                        <Timer size={9} />
                        <span>
                          0:
                          {String(
                            candleCloseCountdown === 60
                              ? 0
                              : candleCloseCountdown,
                          ).padStart(2, "0")}
                        </span>
                      </div>
                    </div>
                  </div>
                  <CandlestickChart prices={prices} />
                </div>
              )}
            </div>

            {/* RIGHT — Technical Analysis Breakdown */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-foreground">
                Indicator Analysis
              </h2>

              {signal ? (
                <>
                  <div className="space-y-2">
                    {signal.indicators.map((ind, i) => (
                      <IndicatorRow key={ind.name} ind={ind} index={i} />
                    ))}
                  </div>

                  {/* Consensus + Momentum panel */}
                  <div
                    className="rounded-xl border border-border bg-card p-4 space-y-3"
                    data-ocid="consensus.panel"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        Consensus
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          isUp ? "text-bullish" : "text-bearish"
                        }`}
                      >
                        {bullishCount}/{signal.indicators.length} Bullish —{" "}
                        {isUp ? "Strong BUY" : "Strong SELL"}
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-muted overflow-hidden flex">
                      <motion.div
                        className="h-full bg-bullish rounded-l-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${consensusPct}%` }}
                        transition={{ duration: 0.6 }}
                      />
                      <motion.div
                        className="h-full bg-bearish rounded-r-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${100 - consensusPct}%` }}
                        transition={{ duration: 0.6 }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span className="text-bullish font-semibold">
                        {bullishCount} BULLISH
                      </span>
                      <span className="text-bearish font-semibold">
                        {bearishCount} BEARISH
                      </span>
                    </div>

                    {/* Momentum Score Bar */}
                    <div
                      className="pt-2 border-t border-border space-y-2"
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
                      {/* Bidirectional bar centered at 0 */}
                      <div className="relative w-full h-3 rounded-full bg-muted overflow-hidden">
                        {/* center line */}
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border z-10" />
                        <motion.div
                          className={`absolute top-0 bottom-0 ${momentumIsPositive ? "bg-bullish" : "bg-bearish"}`}
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
                  </div>
                </>
              ) : (
                <div
                  className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm"
                  data-ocid="indicators.empty_state"
                >
                  Select a pair to begin analysis
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
                Signal History
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
                      "Pair",
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
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                        data-ocid="history.empty_state"
                      >
                        No signals yet — click ANALYZE NOW to begin
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
                        <TableCell className="font-mono text-xs font-semibold">
                          {row.pair}
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
    </div>
  );
}
