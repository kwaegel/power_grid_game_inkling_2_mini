# Notes — Sunnydale Grid

## Design choices and decisions

- **Vanilla HTML/CSS/JS, no build step.** Zero runtime dependencies; a tiny Node static server (`server.js`, ~40 lines, no deps) is the whole toolchain. Chosen over Vite/React so the game can be served from anywhere and run anywhere a browser exists.
- **Real-time game loop (`requestAnimationFrame`), 14 s per game day at 1×.** The whole design (demand curves, solar-at-night, weather, disasters) reads naturally as a live simulation rather than a turn-based one. Speed toggle 1×/2×/4× exists for testing and for players who want to skip ahead.
- **Demand curve follows the day:** low at night → ramp in the morning → high mid-morning → midday plateau → evening peak (~1.45× of baseline at peak in season 0) → taper. This is the game's central tension: the battery rarely covers the evening peak alone, so players must add baseload + storage during the day.
- **Seasons (7 days each)** multiply demand, solar, and wind. Difficulty also grows mechanically with distance from game start: `demandMultiplier = 1 + 0.20 × seasonsElapsed`. A run cannot go forever; a careful player eventually runs out of money or stress.
- **Plants** are weighted toward baseload (gas, coal, nuclear, hydro) at high cost but constant output, vs. cheap, free (solar) or volatile (wind) plants. Battery (storage, not MW) is deliberately the "buffer + peaks" tool, not a capacity source: 400 MWh storage, 45 MWh/s charge, 50 MWh/s discharge.
- **Disasters** (storm, heatwave, cold snap, drought, flood, calm, eclipse) are time-boxed events that modify demand/solar/wind/hydro, with per-type on-canvas effects (rain, snow, heat waves, eclipse shadow). Disaster effects apply only to plants they affect — hydro dies in drought/flood, solar at night and during eclipses, etc.
- **Score** = `daysSurvived × 40 + seasonsReached × 200 + round(energyDelivered) × 2`. Best runs persist (localStorage) across sessions.
- **Persistence:** auto-save to `localStorage` (updated each second), plus manual save, JSON export (file download), JSON import (file picker). The save format is versioned (`version: 1`) so the format can evolve.
- **Houses light up according to power delivered** — a visual feedback channel: too dark, stress is mounting; all lit, you're comfortable.

## What I tested and how

All checks were exercised against the running game via `agent-browser` (real Chromium), not by reading the code.

- **Fresh start:** day 1, plant shop visible, $487, 1 gas plant, meters at 0/0/2%. Screenshot `01-start.png` confirms.
- **Careless run (no builds):** blackout at day 5 — stress climbs unmet-demand → 100%. Verified game-over overlay with score, breakdown, best runs, and "Play again".
- **Careful run (solar+wind+battery at the start):** survived ~30+ days. Mid-game screenshot `02-mid-game.png` shows day 6 evening, battery 58/400, stress 0%, wind/solar/gas/battery all rendering in the scene.
- **Long run:** built a minimal grid, survived to day 75+, money $5,563, stress 0 — note the balance starts to turn out around day 90+ (difficulty scaling).
- **Disaster:** flood screenshot `03-disaster.png` — banner (`🌊 Flood — Hydro output cut to 20% for 3 days (2d left)`), rain overlay, flooded-ground tint, plants intact. Flood consumed hydro-only plans (by design).
- **Blackout/game over:** screenshot `04-gameover.png` — "Blackout!", score 8446, breakdown table, best runs #1–#4, Play again.
- **Save / reload:** saved at day 102 with $8,370, plants restored after `location.reload()` (welcome-back log line added).
- **Export / import:** `exportSave()` wrote a valid JSON (`sunnydale-save-day103.json` with `version`, `day`, `money`, `plants`, `stress`, `batteryEnergy`, `activeDisaster`, `log`); after `localStorage.clear()` + reload (fresh state), `agent-browser upload '#file-import'` restored day 103, $8,694, all 4 plants, stress 71%, ongoing drought.
- **Speed toggle:** 2× confirmed via `btn-speed` clicks (day advances track real time at the expected rate).
- **Day/night cycle, weather, season transitions, disaster banners, toasts, and the news feed** were all visually confirmed via screenshots.
- **Balance tuning in response to looking at the game:** the first balance was too punishing (blackout at day 4 with 3 builds). Rebalanced demand curve (evening peak 1.45→1.31, night 0.72→0.75, midday plateau 0.90→0.92, morning ramp 1.08→1.05), battery (storage 250→400, discharge 55→50, charge 45→45), and default demand (42→36). A second tuning pass raised difficulty growth (`0.16`→`0.20` per season) so runs still end. Verified freshly after both passes.

## Known problems

- **Difficulty tuning is a judgment call, not a heatmap.** A careless player dies in 4–5 minutes (at 1×); a careful player survives 30+ days but runs out of time/money in a steady game. Both verified behaviorally. There is no automated difficulty-curve fit, and no hard target for "perfect run length" — the numbers are reasonable but not formulaically optimal.
- **Headless speed-up:** at 4× speed the game clock runs slightly faster than real time (rAF skew in headless Chromium); this is a display quirk of the sandbox, not a game bug — the math is dt-based and 1× is correct.
- **Console noise:** `favicon.ico` 404 and a couple of date-related warnings from the game are expected and irrelevant.
- **House windows at day are lit** if the delivered fraction is high enough; they light on the delivered-power gradient, not on time-of-day alone. This is intentional (feedback channel), not a bug.
- No mobile layout (fixed-width layout, works in desktop viewport).
- No sound effects (by design — visual feedback only).
- Best runs persist by browser profile only (`localStorage`) — a fresh browser profile starts with empty best runs.

## What I would do next with more time

- Add sound effects (wind/solar/chimes, disaster audio) with a mute toggle.
- A real tutorial: first-run "build your first plant" beat.
- Sealed-balance sweep: vary every knob, measure run length vs. build pattern, pick thresholds from the data.
- Cost-of-build tiering: nuclear cost 420 vs. an effective ~85 MW output underestimates the physics honestly; log-scale it.
- Mobile/responsive layout pass.
- A small automated test suite (Vitest or Node's built-in runner) for `tick`/`demandMW`/`disasterEffects`/`importSaveJSON`.
- Dark-mode polish pass on the panels (light palette reads well on desktop but is flat in full-screen night scenes).
