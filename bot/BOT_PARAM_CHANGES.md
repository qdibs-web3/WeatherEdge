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

---

## 2026-03-25/26 — Simulation 5 Startup: Bugs Fixed + Parameter Tuning

### Sim 5 Status (as of 2026-03-26)
- **Trades placed:** 1
- **Open:** DCA >78°F NO@45¢ (blended forecast ~75.9°F, ourProb ~73%, EV ~25¢)
- **Settled:** 0
- **Conditions:** Spring warm season across all 19 cities — structurally low opportunity environment

---

### Bug Fixes Applied at Sim 5 Start

#### BUG 1: Settlement Date Calculated from `close_time` Instead of Ticker (CRITICAL)
**File:** `server/bots/weatherBot.ts`
**Root cause:** Bot used `market.close_time` converted to local timezone to determine if a market was
for today or tomorrow. Kalshi's `close_time` can be set to early-morning UTC (e.g. 06:00 UTC = 1 AM CDT)
while the market still measures TODAY's temperature.
**Impact:** `isTomorrow=true` — bot fetched tomorrow's NWS forecast (~79°F) for a today-market (actual ~71°F),
producing a fake 76% ourProb on a losing CHI trade. Five bad trades were placed before this was caught.
**Fix:** Added `parseDateFromTicker()` — reads YYYY-MM-DD directly from the Kalshi ticker string (YYMONDD format).
Settlement date is no longer derived from `close_time` at all.

```typescript
// Ticker format: YYMONDD — e.g. "26MAR25" = March 25, 2026
function parseDateFromTicker(ticker: string): string | null {
  const MONTH_MAP: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const m = ticker.toUpperCase().match(/-(\d{2})([A-Z]{3})(\d{2})(?:-|$)/);
  if (!m) return null;
  const year  = 2000 + parseInt(m[1], 10);
  const month = MONTH_MAP[m[2]];
  const day   = m[3].padStart(2, "0");
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

// Usage (replaces close_time logic):
const settlementDate = parseDateFromTicker(market.ticker) ?? forecast.forecastDate;
```

#### BUG 2: NWS API Timeouts at 8000ms
**File:** `server/services/nwsService.ts`
**Root cause:** NWS `/gridpoints/.../forecast` endpoint was consistently taking >8s during sim 5 startup,
causing all 19 cities to be skipped every scan cycle.
**Fix:** Raised timeout from 8000ms to 15000ms on all three NWS calls (`/points`, `/gridpoints/forecast`,
`/gridpoints/hourly`).

---

### Parameter Changes — Sim 5 Startup

#### 1. MAX_PRICE_CENTS: 55¢ → 60¢
**File:** `server/bots/weatherBot.ts`
**Why:** At 55¢ cap, EV filter (MIN_EV=10¢) auto-gates at ~65% ourProb. Raising to 60¢ opens the
upper band slightly. EV guard still applies: at 60¢, EV≥10¢ requires ourProb≥72%. Breakeven real WR
at 60¢ = 61.7%. Net effect is modest — primarily unlocks high-conviction entries between 55-60¢.

#### 2. NO-Side Regime Filter: Relaxed (removed warm+greater block)
**File:** `server/bots/weatherBot.ts`
**Before:** Blocked NO on `>X` in warm regime (i.e., blocked betting that temp WON'T exceed a high strike when it's warm).
**After:** Only blocks NO on `<X` in cold regime (betting temp WILL be warm when it's cold — genuinely unreliable).
**Why:** The warm regime was already reflected in the blended forecast via directionBias and ensemble data.
Double-counting it by also blocking NO on warm-side strikes was suppressing valid trades (e.g. DCA >78°F
NO at 45¢ — 73% ourProb, 28% edge, 25¢ EV — was blocked solely by this filter despite clear edge).

```typescript
const noIsWarmBet = strikeType === "less";
// Only block NO when betting warm in a cold regime — not the reverse.
const noRegimeOk  = !(marketRegime === "cold" && noIsWarmBet);
```

#### 3. MIN_CONVICTION: 70% → 65%
**File:** `server/bots/weatherBot.ts`
**Why:** Spring warm season creates a structural opportunity gap — cheap YES contracts (1-15¢) fail
MIN_PRICE, mid-range YES contracts fail MIN_CONVICTION at 70%. Bot ran 16+ hours and found 0 new trades.
Lowering to 65% unlocks mid-range threshold bets (22-52¢ range). MIN_EV_CENTS=10¢ acts as secondary
gate: at 65% ourProb, only contracts ≤52¢ pass EV — self-polices against expensive entries.
Note: 65% model conviction ≈ 55% real win rate (model systematically overconfident).

---

### Parameters Active for Simulation 5 (current)

| Parameter                  | Sim 4 End  | Sim 5 Current | Notes                                          |
|----------------------------|------------|---------------|------------------------------------------------|
| MIN_PRICE_CENTS             | 20¢        | 20¢           | Unchanged — hard floor from sim 4 post-mortem  |
| MAX_PRICE_CENTS             | 55¢        | 60¢           | Raised to unlock high-conviction 55-60¢ entries |
| MIN_CONVICTION              | 70%        | 65%           | Lowered — spring warm season gap fix           |
| MIN_BETWEEN_NO_PRICE_CENTS  | 50¢        | 50¢           | Unchanged                                      |
| MIN_BETWEEN_NO_SIGMA_DIST   | 1.5σ       | 1.5σ          | Unchanged                                      |
| MIN_EDGE                    | 5%         | 5%            | Unchanged                                      |
| MIN_EV_CENTS                | 10¢        | 10¢           | Secondary gate: at 65% ourProb, caps entry ≤52¢ |
| NO-side regime filter       | warm+cold  | cold only     | Removed warm+greater block (double-counting)   |
| Settlement date source      | close_time | ticker parse  | BUG FIX: parseDateFromTicker() (YYMONDD)       |
| NWS timeout                 | 8000ms     | 15000ms       | BUG FIX: /gridpoints consistently >8s          |

### Between-NO Structural Note
The 1.5σ distance guard + 50-60¢ price cap are mathematically incompatible for typical 1°F Kalshi ranges.
A range at 1.5σ from forecast has ~4% YES probability → NO priced at ~95¢ → fails MAX_PRICE cap.
Between-NO trades will only appear when markets are severely mispriced. This is expected and acceptable.

---

## 2026-03-29 — Simulation 5 Post-Mortem & Simulation 6 Restructure

### Sim 5 Results (5 days, 13 total trades)
- **Record:** 2W / 6L settled, 5 open when cleared
- **P&L:** −$32.15
- **Win rate:** 25% (well below any profitable threshold)
- **Trade frequency:** Only 13 trades found across 5 days (~2.6/day) — far too low

### Root Cause Analysis

#### Why Win Rate Was 25%

**1. Between-NO structural failure (confirmed again)**
Between-NO bets placed with model showing 97% ourProb lost at ~40-50% real rate. The normal distribution
model fundamentally understates real forecast uncertainty on 1°F ranges. A 2σ forecast error is not rare —
it happens routinely with NWS in March. Even the raised 1.75σ guard wasn't sufficient.

**2. NWS March inaccuracy wiping edge on threshold bets**
NWS forecasts in March carry 4-8°F errors (spring transition chaos). Two bets lost where actual temp
landed within 2°F of the strike but on the wrong side.

**3. Boston correlated loss (same city, same settlement date)**
BOS YES >67°F AND BOS NO 62-63°F were both open for March 26. When actual BOS landed at 62-63°F, both
settled as losses simultaneously — correlated failure that the conflict guard was added to prevent.

#### Why Trade Frequency Was Low

**1. Regime filter blocking valid YES signals in spring**
The remaining regime filter (cold regime blocks warm YES) was blocking contracts in the 22-50¢ range
exactly when spring weather creates mispricing. The warm conditions are already in the blended forecast.

**2. MAX_STRIKE_SIGMA=1.0 blocking valid NO bets**
The strike distance guard computed distance symmetrically and blocked NO on >X markets where the strike
was far ABOVE forecast — exactly the safest NO bets. A strike 1.5σ above forecast is a very good NO
bet (strike is safely far away), but the guard was rejecting it.

**3. MAX_PRICE=75¢ still cutting off the "already happening" tier**
Contracts priced 75-90¢ represent 80-95% probability events. The bot's edge here is simply confirming
the NWS forecast agrees with the implied probability. Between bets dominating and blocking capacity also
reduced the pool of yes/no bets found.

### Core Insight for Sim 6

The market prices weather contracts using climatological base rates. The bot's edge is knowing the current
NWS point forecast. On any given day: if NWS says 75°F and the strike is >65°F, the market may price at
70¢ while NWS gives 85% probability — that's real edge. The old regime filter and symmetric distance guard
were both blocking these high-quality signals.

The solution is to replace label-based guards with directional, per-side safety margins:
- YES bets: require forecast to be on the correct side of the strike by ≥0.5σ (not just nearby)
- NO bets: require strike to be safely far from forecast by ≥1.5σ (not just within 1.0σ)

---

### Sim 6 Changes (2026-03-29)

#### 1. Between Bets: Permanently Eliminated
**File:** `server/bots/weatherBot.ts`
**Change:** `if (strikeType === "between") continue;` added immediately after strikeType check.
**Why:** Confirmed structural failure in sim 4 AND sim 5. 1°F ranges have ~4-5% hit probability even at
2σ from forecast. Normal distribution model overconfidence (97% ourProb → 40-50% real WR) is unfixable
without a fundamentally different model. Eliminating between bets entirely removes the biggest loss source.

#### 2. Regime Filter: Removed Entirely
**File:** `server/bots/weatherBot.ts`
**Before:** YES-side blocked YES >X in cold regime. NO-side blocked NO <X in cold regime.
**After:** No regime filter on either side.
**Why:** Regime conditions (cold/warm vs monthly normal) are already captured in the blended forecast
via directionBias and ensemble. Applying a second regime label filter was double-counting and suppressing
valid signals. The directional safety margin (item 3 below) provides better structural protection than
a regime label ever did — it checks the actual forecast position, not just a warm/cold label.

#### 3. Strike Distance Guard → Directional Safety Requirement
**File:** `server/bots/weatherBot.ts`
**Before:** `MAX_STRIKE_SIGMA = 1.0` — symmetric guard, blocked any market where strike is >1σ from
forecast in EITHER direction. This wrongly blocked NO bets where the strike was safely far ABOVE forecast.

**After:** Per-side directional safety:
```typescript
// YES side: forecast must be at least 0.5σ on the favorable side of the strike
// YES >X: (forecast - floor) / σ ≥ 0.5
// YES <X: (cap - forecast) / σ ≥ 0.5
const YES_SAFETY_SIGMA = 0.5;

// NO side: strike must be at least 1.5σ away from forecast in the safe direction
// NO >X: (floor - forecast) / σ ≥ 1.5  (strike is safely above forecast)
// NO <X: (forecast - cap)   / σ ≥ 1.5  (forecast is safely above the cap)
const NO_SAFETY_SIGMA = 1.5;
```

**Why YES=0.5σ:** A 0.5σ favorable margin means forecast is already on the right side. It allows
moderate-conviction YES bets where the forecast agrees with direction without demanding a large gap.
EV and conviction gates prevent marginal entries.

**Why NO=1.5σ:** NO bets are more dangerous (we lose if temp moves toward the strike). Requiring 1.5σ
clearance means even a 1σ NWS forecast error leaves 0.5σ safety buffer. Consistent with the prior
between-NO sigma requirement (1.75σ) but adapted for threshold bets.

#### 4. MAX_PRICE_CENTS: 75¢ → 82¢
**File:** `server/bots/weatherBot.ts`
**Why:** Contracts at 75-82¢ represent ~80-88% market-implied probability. When NWS strongly agrees,
these are high-quality bets with 80%+ real win rate. The EV=8¢ filter still gates quality.

#### 5. MIN_EV_CENTS: 10¢ → 8¢
**File:** `server/bots/weatherBot.ts`
**Why:** At 82¢ entry with 88% ourProb: EV = 0.88×18×0.93 − 0.12×82 = 14.7 − 9.8 = 4.9¢ — would
fail the 10¢ bar. The old 10¢ bar was calibrated for the 45-60¢ entry range. Lowering to 8¢ allows
high-probability entries without abandoning EV discipline entirely.

#### 6. MIN_CONVICTION: 60% → 55%
**File:** `server/bots/weatherBot.ts`
**Why:** The directional safety margin ensures the forecast is structurally aligned with the bet. A 55%
ourProb with ≥0.5σ YES safety and ≥8% edge is a higher-quality signal than a 60% ourProb that passed
only a regime label filter. MIN_EDGE=8% prevents weak signals from slipping through.

#### 7. MIN_EDGE: 5% → 8%
**File:** `server/bots/weatherBot.ts`
**Why:** MIN_CONVICTION was lowered to 55%. Without a stronger edge gate, 55% ourProb + market at 48%
(only 7% edge) could pass. 8% edge at 55% ourProb requires market at ≤47¢ — a meaningful pricing gap
that reflects genuine forecast divergence, not just daily noise.

---

### Sim 6 Mid-Run Adjustment (2026-03-29)

After first several scans found 0 new trades (only 2 MSY positions from early-morning ensemble conditions),
analysis of the live scan output identified three overlapping guards blocking the target trade set.

**Root cause:** YES_SAFETY_SIGMA=0.5 requires forecast to be 0.5σ on the favorable side. The available YES
bets in the 50-70% ourProb range (exactly what we want) have safety 0.0-0.4σ — forecast is *correctly
oriented* but not 0.5σ past the strike. Combined with MIN_PRICE=20¢ (many of these are 10-19¢) and
MIN_CONVICTION=55% (borderline 50-54% bets blocked), the system produced zero trades despite genuine edge.

**Specific bets blocked that should have been placed:**
- `DCA <68°F YES@27¢` — 64% ourProb, 37% edge, safety=0.36σ — failed only `dir-safety 0.36<0.5`
- `AUS <87°F YES@13¢` — 62% ourProb, 49% edge, safety=0.30σ — failed `dir-safety` + `price 13<20`
- `BOS >68°F YES@7¢`  — 51% ourProb, 44% edge, safety=0.02σ — failed all three guards

**Why DCA/AUS have huge edge:** Market uses raw NWS (DCA: 70°F, AUS: 87°F). We use bias-corrected blended
forecast (DCA: 66.8°F via -1.5°F bias + ensemble, AUS: ~85.5°F). The gap creates 37-49% model edge —
this IS the edge the system was designed to capture.

**Key insight:** A negative-safety YES bet (forecast on wrong side of strike) implies ourProb < 50% by
definition. So MIN_CONVICTION=50% already blocks all wrong-direction bets — YES_SAFETY=0.0σ adds no
duplicate risk; it just stops blocking correctly-oriented moderate-probability bets.

#### A. YES_SAFETY_SIGMA: 0.5 → 0.0
**Why:** 0.5σ was too strict — it requires 69%+ ourProb before any YES bet passes, eliminating the entire
50-69% range. 0.0σ means "forecast is on the correct side of the strike." MIN_CONVICTION=50% is the true
gate for direction, since negative safety ↔ ourProb < 50% ↔ fails conviction check already.

#### B. MIN_PRICE_CENTS: 20¢ → 10¢
**Why:** The 20¢ floor was calibrated for OTM bets (sim 4 era) where a 3°F forecast error wipes all
edge on cheap contracts. For moderate-probability bets (50-65% ourProb) priced cheaply because the market
uses raw NWS while we use bias+ensemble, the edge survives forecast error. MIN_EV=8¢ and MIN_EDGE=8%
remain the quality gates. 10¢ floor still blocks near-zero-probability penny markets.

#### C. MIN_CONVICTION: 55% → 50%
**Why:** With YES_SAFETY=0.0, the conviction floor is now the primary directional guard. 50% is the exact
boundary between "forecast on favorable side" and "forecast on wrong side" — mathematically consistent.
8% MIN_EDGE requirement at 50% ourProb requires market ≤42¢, ensuring meaningful pricing divergence.

---

### Parameters Active for Simulation 6 (current)

| Parameter               | Sim 5        | Sim 6 start  | Sim 6 current | Notes                                               |
|-------------------------|--------------|--------------|---------------|-----------------------------------------------------|
| MIN_PRICE_CENTS         | 20¢          | 20¢          | **10¢**       | Lowered — 20¢ filtered moderate-prob cheap YES bets |
| MAX_PRICE_CENTS         | 75¢          | 82¢          | 82¢           | Unchanged                                           |
| MIN_CONVICTION          | 60%          | 55%          | **50%**       | Lowered — YES_SAFETY=0.0 is the directional gate    |
| MIN_EDGE                | 5%           | 8%           | 8%            | Unchanged                                           |
| MIN_EV_CENTS            | 10¢          | 8¢           | 8¢            | Unchanged                                           |
| YES_SAFETY_SIGMA        | N/A          | 0.5σ         | **0.0σ**      | Lowered — 0.5σ blocked entire 50-69% target range  |
| NO_SAFETY_SIGMA         | N/A          | 1.5σ         | 1.5σ          | Unchanged                                           |
| MIN_BETWEEN_NO_PRICE    | 50¢          | N/A          | N/A           | Removed — between bets permanently eliminated       |
| MIN_BETWEEN_NO_SIGMA    | 1.75σ        | N/A          | N/A           | Removed — between bets permanently eliminated       |
| Between bets            | Allowed      | Eliminated   | Eliminated    | `if (strikeType === "between") continue;`          |
| Regime filter           | Cold only    | None         | None          | Removed — double-counting with blended forecast     |

---

## 2026-03-29 — Simulation 6 Post-Run Bug Reverts + Volume Increase

### What Went Wrong (Sim 6 Mid-Run Changes)

The mid-run adjustments (YES_SAFETY 0.5→0.0, MIN_PRICE 20→10, MIN_CONVICTION 55→50) caused three
wrong-directional bets:

- **BOS YES >68°F @ 7¢** — blended forecast 66.9°F (0.02σ safety before ensemble flip). Bet placed when
  safety was barely positive; ensemble updated and flipped forecast below strike. Loss.
- **AUS YES <87°F @ 13¢** — blended forecast 87.4°F (ABOVE the cap = negative safety). Only passed because
  YES_SAFETY was set to 0.0. Loss.
- **DC YES <68°F @ 27¢** — blended forecast 68.3°F (slightly above cap). Same issue. Loss.

**Root cause:** YES_SAFETY=0.0 technically blocks wrong-direction bets only when ourProb < 50%. But at the
boundary (forecast barely past strike, safety 0.0-0.1σ), ensemble updates can flip the forecast to the wrong
side mid-run. The 0.5σ buffer was specifically designed to prevent this. The BOS case is the textbook example:
safety was 0.02σ when bet was placed, ensemble updated 2 hours later, forecast dropped below strike → loss.

The two MSY trades placed at sim 6 start (YES <78°F and YES <74°F) are the correct model — 70%+ ourProb,
forecast clearly 0.6-0.8σ past strike, market underpriced by 30-40% using raw NWS vs our bias+ensemble.

---

### Reverts Applied (2026-03-29 post-run)

#### REVERT 1: MIN_PRICE_CENTS: 10¢ → 20¢
**Why:** Sim4 proof still holds — 0% win rate on all bets at ≤18¢. The 10¢ floor was predicated on
YES_SAFETY=0.0 as the directional gate. With YES_SAFETY reverted to 0.5, the high-conviction target bets
(MSY-type, 70%+ ourProb) price at 22-35¢ anyway — the 10¢ floor was only needed to access wrong-direction bets.

#### REVERT 2: MIN_CONVICTION: 50% → 65%
**Why:** 50% is a coin flip, not conviction. The original sim 6 plan had 55%; walking it down to 50% combined
with YES_SAFETY=0.0 was the cause of the wrong-directional bets. Resetting to 65% ensures the forecast must
strongly favor the outcome: at sigma=3.2°F, 65% ourProb = forecast ~1σ past the strike.
Target high-value zone: 70%+ ourProb (MSY-type trades) remains fully accessible.

#### REVERT 3: YES_SAFETY_SIGMA: 0.0 → 0.5
**Why:** As documented above — 0.5σ prevents bets placed at the forecast/strike boundary where ensemble
updates can flip direction. The BOS case (safety=0.02σ, ensemble flip 2h later) is the proof case.
YES_SAFETY is now a module-level constant (moved from inside `analyzeCity`) to make it visible in scan logs.

---

### Volume Increases Applied (2026-03-29 post-run)

#### VOL 1: Ensemble Spread Guard Removed
**File:** `server/bots/weatherBot.ts`
**Change:** Deleted `MAX_ENSEMBLE_SPREAD_F` constant and the city-level spread guard block entirely.
**Why:** The guard was redundant and unnormalized:
- Redundant: the per-market NWS-ensemble divergence guard (4°F, inside market loop) already catches the real
  problem — model uncertainty making the blended forecast unreliable for a specific market.
- Unnormalized: a 7°F spread means very different things for MIA (σ=2.1) vs MSP (σ=4.2). CHI and MSP were
  being skipped on their highest-opportunity days simply because they have naturally wider model disagreement.
- City-level vs market-level: skipping ALL markets for a city when one model comparison is borderline is too
  blunt. The per-market divergence guard already handles this at the right granularity.
**Note:** Ensemble spread is still calculated in `openMeteoService.ts` and displayed in `Forecasts.tsx` (UI color
coding: ✓ Agree / ~ Partial / ⚠ Disagree). This is informational only — it no longer blocks any trades.

#### VOL 2: Added 6 New Cities to `nwsService.ts`
**File:** `server/services/nwsService.ts`
**New cities:** PDX (Portland), CLT (Charlotte), TPA (Tampa), DTW (Detroit), RDU (Raleigh), BNA (Nashville)

| Code | City       | stationId | seriesTicker   | sigma | directionBias | Notes                              |
|------|------------|-----------|----------------|-------|---------------|------------------------------------|
| PDX  | Portland   | KPDX      | KXHIGHTPDX     | 3.2°F | 0.0           | Pacific NW, marine influence       |
| CLT  | Charlotte  | KCLT      | KXHIGHTCLT     | 3.1°F | 0.0           | Southeast, low variability         |
| TPA  | Tampa      | KTPA      | KXHIGHTTPA     | 2.3°F | 0.0           | Subtropical stable                 |
| DTW  | Detroit    | KDTW      | KXHIGHTDET     | 3.7°F | 0.0           | Great Lakes continental            |
| RDU  | Raleigh    | KRDU      | KXHIGHTRDU     | 3.0°F | 0.0           | Southeast coastal                  |
| BNA  | Nashville  | KBNA      | KXHIGHTNAS     | 3.3°F | 0.0           | Mid-South                          |

**IMPORTANT:** directionBias = 0.0 for all new cities — no historical Kalshi win-rate analysis performed yet.
Do NOT apply directional bias until historical data confirms systematic model error direction.

**IMPORTANT:** seriesTicker values are best-guess from KXHIGHT pattern. **Verify each ticker against the live
Kalshi API before enabling these cities** using: `GET /markets?series_ticker=KXHIGHTPDX&status=open`

**How to enable:** Add new city codes to `enabledCities` in the bot config via the UI.

---

### Parameters Active for Simulation 7

| Parameter               | Sim 6 end    | Sim 7 start  | Notes                                               |
|-------------------------|--------------|--------------|-----------------------------------------------------|
| MIN_PRICE_CENTS         | 10¢          | **20¢**      | Reverted — 10¢ enabled wrong-direction cheap bets   |
| MAX_PRICE_CENTS         | 82¢          | 82¢          | Unchanged                                           |
| MIN_CONVICTION          | 50%          | **65%**      | Reverted — 50% was coin flip territory              |
| MIN_EDGE                | 8%           | 8%           | Unchanged                                           |
| MIN_EV_CENTS            | 8¢           | 8¢           | Unchanged                                           |
| YES_SAFETY_SIGMA        | 0.0σ         | **0.5σ**     | Reverted — 0.0σ allowed boundary bets that flip     |
| NO_SAFETY_SIGMA         | 1.5σ         | 1.5σ         | Unchanged                                           |
| NWS directional align   | None         | **Added**    | YES bets require NWS itself to agree with direction |
| Ensemble spread guard   | 6.0°F city-level | **Removed** | Per-market NWS-divergence guard covers this better  |
| City count              | 19           | **20**       | SAT (San Antonio) re-added via KXHIGHSATX           |
| Between bets            | Eliminated   | Eliminated   | Unchanged                                           |
| Regime filter           | None         | None         | Unchanged                                           |

---

## 2026-03-30 — NWS Directional Alignment Guard (YES side)

### Problem
The 3-model ensemble was manufacturing YES trades where NWS itself was on the WRONG side of the
strike. Example: MSY YES <78°F when NWS=79.0°F (above the 78°F cap). Only the ensemble consensus
(75.4°F) dragged the blended forecast (76.3°F) below the cap. The market priced YES at 23¢ (23%
probability) because it tracks NWS. If NWS is right, the bet loses.

The ensemble's role should be to REFINE probability when NWS agrees with direction — not to
OVERRIDE NWS direction and create bets NWS would never support.

### Fix: `nwsAlignedYes` guard
**File:** `server/bots/weatherBot.ts` (inside per-market YES evaluation block)

```typescript
const nwsAlignedYes =
  strikeType === "greater" ? (floor !== null && marketNwsRaw >= floor) :
  strikeType === "less"    ? (cap  !== null && marketNwsRaw <= cap)   :
  true;
```

Added `nwsAlignedYes` to YES pass conditions and to the skip-reason log.

**Why not on NO side:** The 1.5σ NO safety margin already handles this. If ensemble pushes
blended toward the strike, noSafety shrinks and fails the 1.5σ requirement — self-correcting.
The YES side at 0.5σ doesn't have sufficient buffer, hence the explicit NWS alignment check.

### Impact
- **Blocked:** Ensemble-only YES bets where NWS disagrees with direction (high payout, high risk)
- **Kept:** YES bets where both NWS AND ensemble agree on direction (NWS-supported edge)
- **Kept:** All NO bets (handled by existing 1.5σ safety — unchanged)
- **Target trade profile:** DC NO >75°F (NWS=70.8°F clearly below strike, both models agree)
  and SFO NO >73°F (NWS=69.5°F clearly below strike) — "already likely outcomes" type trades
