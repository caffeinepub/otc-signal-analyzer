# OTC Signal Analyzer — Version 11

## Current State
Version 10 uses 14 indicators with weighted voting. Signals are generated even when consensus is low (50-60%), leading to weaker signals. No divergence detection, no signal quality gate.

## Requested Changes (Diff)

### Add
- RSI divergence detection (bullish/bearish divergence is one of strongest reversal signals)
- Triple-confirmation gate: SURESHOT only fires when MACD + EMA + MTF all agree with direction
- Minimum consensus threshold: 65%+ for STRONG, skip signal (show WAIT) if < 55%
- Volume pressure scoring using price momentum consistency over last 5 bars
- VETO: if MTF Confluence opposes signal direction, cut its weight boost to prevent false signals

### Modify
- Signal strength: STRONG requires 68%+ weighted consensus (was 72% ratio but on full range)
- Price history: smoother trend cycles with more realistic reversals for better indicator readings
- Weighted voting: give extra 30% boost when MACD + EMA + MTF all align with direction
- Auto-signal on candle: only fire if signalStrength is STRONG or MODERATE (suppress WEAK auto-signals)

### Remove
- Nothing removed

## Implementation Plan
1. Update ta.ts: add calcRSIDivergence(), improve generatePriceHistory(), add triple-confirm gate
2. Update App.tsx: suppress auto SURESHOT if signal is WEAK (show waiting state instead)
3. Show RSI divergence as a new named indicator in the breakdown panel
