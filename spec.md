# OTC Signal Analyzer

## Current State
Version 21 runs a single-pass signal engine with 17 indicators, STRONG threshold at 72% weighted + 10/17 raw, no confirmation passes. Signal fires on first analysis pass.

## Requested Changes (Diff)

### Add
- 3 new indicators: Hull Moving Average (HMA), Money Flow Index (MFI), Keltner Channel — total 20 indicators
- Triple-pass confirmation: 3 independent price scenario seeds must ALL agree on direction AND ALL reach STRONG consensus
- "ULTRA STRONG" label for 85%+ confluence signals
- Consensus veto: if 3+ key leading indicators (MACD, EMA Stack, MTF, Parabolic SAR) disagree with majority direction, block signal
- ATR extreme-volatility guard: during abnormal volatility, require 82%+ threshold

### Modify
- STRONG threshold raised: 78%+ weighted consensus AND 12/20 raw indicators must agree (up from 72% + 10/17)
- Triple-pass confirmation replaces single-pass — all 3 must agree and all 3 must reach STRONG
- generateSignalMultiPass now runs 3 passes by default
- Indicator weights rebalanced for higher precision

### Remove
- Nothing removed — all existing indicators preserved

## Implementation Plan
1. Add calcHullMA(), calcMFI(), calcKeltnerChannel() to ta.ts
2. Add these 3 as indicator entries with appropriate weights
3. Raise STRONG gate to 78% + 12/20
4. Add ULTRA_STRONG detection at 85%+ and include in SignalResult
5. Update generateSignalMultiPass to run 3 independent passes, all must be STRONG and agree
6. Add consensus veto logic for MACD+EMA+MTF+PSAR disagreement
7. Update App.tsx signal strength badge to show ULTRA STRONG variant
