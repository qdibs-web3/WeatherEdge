# Bot Parameter Change Log

---

## 2026-03-24 — Simulation 4 Post-Mortem Fixes

### Root Cause: Two Bad Trades (BOS T51 + DC T56)

**KXHIGHTBOS-26MAR24-T51** — YES >51°F @ 5¢, wagered ~$2
- Root cause: `probForStrike` was called with `city.sigmaMkt = 5.8°F` instead of `city.sigma = 3.4°F`.
  - sigmaMkt is ~70% wider than actual NWS forecast accuracy.
  - Inflated `ourProb` from ~11% (correct) to ~24% (fake edge at 5¢ market price).
- Secondary: MIN_PRICE_CENTS was 5¢, allowing the bot to bet into near-zero-probability contracts.

**KXHIGHTDC-26MAR24-T56** — YES >56°F @ 10¢, wagered ~$3
- Root cause: Open-Meteo ensemble API was called without date pinning (`forecast_days=2` only).
  - After ~7PM Eastern (midnight UTC), index[0] shifted to the next UTC day.
  - DC ensemble showed 71–75°F when NWS showed 52°F — bot saw a massive apparent edge.
- Already fixed in prior session via `start_date`/`end_date` pinning in `openMeteoService.ts`.

---

### Changes Applied

#### 1. Probability Sigma: `city.sigmaMkt` → `city.sigma`
**File:** `server/bots/weatherBot.ts` ~line 648
**Before:** `probForStrike(marketBiasedForecast, city.sigmaMkt, floor, cap, strikeType)`
**After:** `probForStrike(marketBiasedForecast, city.sigma, floor, cap, strikeType)`
**Why:** `sigmaMkt` is market-implied volatility (~70% wider than actual forecast error). Using it inflates
deep-OTM probabilities by ~2x, creating false edges on cheap contracts. `city.sigma` reflects true
NWS forecast accuracy (e.g., 3.4°F for BOS, 3.3°F for DC) and should be used for all probability estimates.

#### 2. MIN_PRICE_CENTS: 5¢ → 15¢
**File:** `server/bots/weatherBot.ts` (constant at top of file)
**Before:** `const MIN_PRICE_CENTS = 5`
**After:** `const MIN_PRICE_CENTS = 15`
**Why:** Contracts below 15¢ imply >85% chance of loss. Even with a real edge, the variance is too high
and the contracts are highly sensitive to model error. Belt-and-suspenders guard on top of the sigma fix.

#### 3. Scan Parameter Logging
**File:** `server/bots/weatherBot.ts` (scan start)
**Added:** Full log of all guard parameters at the start of every scan (console + activity log):
```
[WeatherBot] Scan params — prob_sigma: city.sigma (NWS accuracy) | MIN_PRICE: 15¢ | MIN_CONVICTION: 55% | MIN_EDGE: 8% | MIN_EV: 2¢ | MAX_PRICE: 85¢
```
Also added `σ=${city.sigma}°F` to the per-city scan log line.

#### 4. Ensemble Date Pinning (prior session)
**File:** `server/services/openMeteoService.ts`
**Change:** Added `start_date`/`end_date` parameters to Open-Meteo API calls to prevent UTC midnight index shift.
**Why:** Without date pinning, after ~7PM Eastern the API's index[0] silently shifted to the next UTC day,
causing ensemble forecasts to reflect tomorrow's weather while NWS reflected today's.

---

### Parameters Active After These Changes

| Parameter         | Old Value         | New Value         | Notes                              |
|-------------------|-------------------|-------------------|------------------------------------|
| Prob sigma        | `city.sigmaMkt`   | `city.sigma`      | NWS accuracy, not market-implied   |
| MIN_PRICE_CENTS   | 5¢                | 15¢               | Hard floor on contract price       |
| MIN_CONVICTION    | 55%               | 55%               | Unchanged                          |
| MIN_EDGE          | 8%                | 8%                | Unchanged                          |
| MIN_EV_CENTS      | 2¢                | 2¢                | Unchanged                          |
| MAX_PRICE_CENTS   | 85¢               | 85¢               | Unchanged                          |
| MIN_LIQUIDITY     | 500               | 500               | Unchanged                          |
| Ensemble dating   | forecast_days=2   | start/end pinned  | Fixed UTC midnight shift bug       |

---

### Impact Assessment

- **BOS T51**: Would be blocked by BOTH sigma fix (ourProb drops from 70% to ~11%, below MIN_CONVICTION) AND MIN_PRICE_CENTS (5¢ < 15¢ floor).
- **DC T56**: Would be blocked by ensemble date fix (forecast corrects from ~72°F to ~52°F, no edge at 10¢).
- **Other 18 open trades**: None would be blocked. All have forecasts clearly on the winning side; sigma fix actually strengthens their conviction slightly.

---

## 2026-03-25 — Simulation 4 Full Post-Mortem (50 trades settled)

### Final Results
- **Win Rate:** 38.0% (19W / 31L)
- **Total P&L:** -$114.13 (ROI -16.0%)
- **Wins:** +$327.40 | **Losses:** -$441.53

### Root Cause Analysis — All 31 Losses

#### FINDING 1: Cheap contracts (≤19¢) = 0% win rate
Every single bet at ≤18¢ lost. 12 losses, 0 wins, -$161 P&L.
```
0-15¢: 0W / 9L  (0%)   -$116.56
15-20¢: 0W / 3L (0%)   -$44.82
```
The 15¢ floor set in the previous session still let through CHI T50@16¢, MSP T53@15¢, OKC T76@18¢ — all lost.
**Rule**: No edge exists below 20¢. A 3°F forecast error (within 1σ) completely wipes any apparent edge.

#### FINDING 2: Between-NO bets are the dominant loss source
21 of 31 losses (68%) were between-NO bets where temp landed exactly in the 1°F range.
By sub-price:
```
Between-NO at <50¢ NO:  4W / 9L  (31%)   — market says >50% chance temp IS in range → defer to market
Between-NO at ≥50¢ NO: 10W / 10L (50%)   — still needs distance guard to improve
```
Wins by NO price bracket:
```
NO @ 55¢ exactly:  6W / 1L  (86%)  ← sweet spot, range clearly away from forecast
NO @ 54¢:          1W / 3L  (25%)
NO @ 50-53¢:       3W / 6L  (33%)
NO @ <50¢:         4W / 9L  (31%)
```

#### FINDING 3: Systematic model warm bias on warm cities during warm events
March 23-24 was an extreme warm event in the Southwest and South.
Actual temperatures vs model expectation:
- LAS: 96-97°F both days (model forecasted ~91-92°F → -4 to -5°F error)
- PHX: 99-100°F on Mar 23 (model forecasted ~95°F → -4°F error)
- AUS: 88-89°F on Mar 23, 87-88°F on Mar 24 (model ~3-4°F low)
- HOU: 83-84°F on Mar 23, 82-83°F on Mar 24 (model ~3-4°F low)
- DAL: 79-80°F on Mar 23, 84-85°F on Mar 24 (model off both ways)
- OKC: 69-70°F on Mar 23, 78-79°F on Mar 24 (model ~4-5°F low on Mar 24)

Result: Between-NO bets on ranges that looked far from our forecast were actually right where the temp landed.
The `directionBias` for warm cities (HOU=-1.5, AUS=-1.5, LAS=-1.5) made this WORSE — subtracting from forecast
when temps were already running hot.

#### FINDING 4: Threshold bets work when priced fairly (≥20¢)
Threshold YES wins: ALL at 22-40¢ (5 wins: BOS T44, ATL T65, LAX T76, NOLA T80, DEN T70)
Threshold YES losses: ALL at ≤18¢ (8 losses — would be blocked by new 20¢ floor)
With 20¢ floor: threshold bets would have been 5W / 0L = 100% win rate.

### Fix Simulation (applied retroactively to Sim 4 data)
```
Baseline:                              19W / 31L  38%   -$114.13
Fix A: MIN_PRICE_CENTS 15→20:          19W / 19L  50%   +$47.25   (+$161 improvement)
Fix A+B: +betweenNO min 50¢ price:     15W / 10L  60%   +$111.02  (+$64 more)
Fix A+B+C: +1.5σ betweenNO distance:   ~12W / 1L  ~92%  ~+$215    (estimated)
```

### Changes Implemented — 2026-03-25

#### 1. MIN_PRICE_CENTS: 15¢ → 20¢
**Why:** Sim4 proof — 12 bets at ≤18¢, 0 wins (0%). Raising to 20¢ blocks all sub-20¢ losses while
keeping every win (lowest win price was NOLA T80 @22¢). Fix A alone: -$114 → +$47.

#### 2. MIN_BETWEEN_NO_PRICE_CENTS = 50¢ (NEW constant)
**Why:** When market prices between-YES > 50¢, market consensus says temp WILL land in range. Fighting
that consensus at <50¢ NO has only 31% win rate. Added as separate guard on NO side for between bets.

#### 3. MIN_BETWEEN_NO_SIGMA_DIST = 1.5σ (NEW constant + pre-probability guard)
**Why:** For a 1°F between range, any forecast within 1.5σ has meaningful probability of being hit by
routine model error. All remaining between-NO losses at 50-55¢ had range within ~1.2σ of blended forecast.
Guard added in pre-probability section (before ourProb calculation), computed as:
`Math.abs(marketBiasedForecast - rangeMidpoint) / city.sigma`

### Parameters Active for Simulation 5

| Parameter                  | Old Value  | New Value  | Expected Impact                        |
|----------------------------|------------|------------|----------------------------------------|
| MIN_PRICE_CENTS             | 15¢        | 20¢        | Eliminates all sub-20¢ bets (0% WR)   |
| MIN_BETWEEN_NO_PRICE_CENTS  | n/a        | 50¢        | Only bet NO when market doesn't favor YES |
| MIN_BETWEEN_NO_SIGMA_DIST   | n/a        | 1.5σ       | Range must be clearly far from forecast |
| MAX_STRIKE_SIGMA (threshold)| 1.0σ       | 1.0σ       | Unchanged                              |
| MIN_CONVICTION              | 70%        | 70%        | Unchanged (note: overconfident, ~70% ourProb → ~60% real) |
| MIN_EDGE                    | 5%         | 5%         | Unchanged                              |
| MIN_EV_CENTS                | 10¢        | 10¢        | Unchanged                              |
| MAX_PRICE_CENTS             | 55¢        | 55¢        | Unchanged                              |

### Open Issues for Future Sims
- **directionBias for warm cities**: Negative bias (-1.5°F for HOU/AUS/LAS/DCA) worsens accuracy during
  warm events. Consider removing or reversing for warm-season months (Apr-Sep).
- **Between-NO at 50-55¢**: Still 50% win rate without the distance guard. The distance guard should
  catch most remaining losses but needs validation in Sim 5.
- **Model overconfidence**: ourProb of 88-98% on between-NO bets but actual win rate ~40-50%. The normal
  distribution model is systematically overconfident for between bets. True uncertainty is higher than σ implies.
