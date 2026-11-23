# Impact: heal the planet together

**Track 02 · Co-op Multiplayer Game · Agents for Impact Hackathon (Nov 23, 2026)**

> A UI concept was sketched before the event; all code in this repo was written during the event.

Impact is a co-op 3D planet. **Five AI agents with their own goals** live on it and act every 10 seconds, even when nobody is playing. **Two or more humans** join from their phones and share the same world. The agents' choices are driven by **live air-quality data from a Bruin pipeline** and by the humans' **real carbon ledger**: what you actually ate, drove, showered and threw away today, logged by tapping or by scanning a receipt, and computed only from cited emission factors. An **agent council** renegotiates the street's daily budget every few minutes. Every decision is logged with *why*, *the data it used* and *its source*, and Bruin recomputes everyone's footprint and audits the agents afterwards.

```
 Your real log (tap or receipt scan) ─► server: cited factors ─► logs/ledger.jsonl ─► Bruin footprint_daily (recomputes + checks the math)
 Open-Meteo (live PM2.5, temp, humidity) ─► Bruin pipeline ─► data/daily_spawn.csv ─┐
                                              (21 quality checks)                   ▼
 Humans on 2+ phones ── real actions, photo proof, Smog Pop ──► server.js tick loop (every 10 s)
          ▲                                                       │  Mossling · Ripplet · Frostbun · Sunfox · Smog Baron
          └──────────── SSE: everyone sees the same world ◄───────┤  ally / trade / betray / pollute / quests for humans
                                                                  ▼
                       logs/decisions.jsonl ─► Bruin marts.agent_report (audit) ─► in-app "Run report"
```

## Run it

Needs Node 20.12+ (for `--env-file-if-exists`). No npm install: the server has zero dependencies.

```bash
npm start            # http://localhost:8787 ; phones on the same wifi use the LAN URL printed in the console
npm run demo         # agents tick every 3 s (for the video)
npm run all          # bruin run pipeline, then start the server
npm test             # engine checks (seeds, decision log, quests, learning)
```

- Second player on the same laptop: open `http://localhost:8787/?p=2` in another window.
- No server? The PWA still opens from cache and the same agent engine runs in the browser (offline, single player).
- Phones: open the LAN URL, then Share → Add to Home Screen (it is a PWA with a manifest and service worker).

## Hackathon requirements, and where to see them

| Requirement | Where |
|---|---|
| Characters with a visual identity | Five drawn characters (faces, ears, the Baron's top hat) walking on a WebGL low-poly planet, and as cards in the Agents panel |
| Visual output: movement and actions on screen | Agents walk between zones, speech bubbles show each action, zones visibly heal (green, trees grow) or sicken (grey, smog puffs, space junk) |
| ≥ 3 agents with distinct goals | Mossling (forest ≥ 70), Ripplet (ocean), Frostbun (ice), Sunfox (get rich in seeds), Smog Baron (planet below 30) |
| Agents interact with each other | Alliances, trades, the Baron bribes Sunfox, Sunfox betrays or refuses (and can leak intel), guardians confront the Baron and help each other |
| ≥ 2 humans | Everyone on the server shares one world over Server-Sent Events. Neighbors tab → "Live on your street" |
| Visible decision log | Agents panel → Decision log: action, **why**, **data used**, **sources** (Bruin, Telem), alternatives considered. Also `logs/decisions.jsonl` |
| Acts on its own schedule; world changes while you're away | Server tick loop runs without players; after a restart it replays missed ticks ("caught up N missed ticks"); the app shows "While you were away…" |
| Two runs, different outcomes | Agents panel → **Run it twice** (seed 42 vs 7: instant 120-tick simulations with health curves, betrayals and alliances) |
| Booster: 3D | Three.js planet, agents, smog, orbiting debris |
| Booster: learns between runs | `data/agent_memory.json`: per-agent action → reward running averages bias the next run ("remembers run 2: prefers to tend") |
| Real-world impact | **Today** tab: your carbon ledger vs a budget the council sets; log meals, trips, showers, trash, bills; guardians give missions from your real log ("You're at 14.9 kg CO2e from food today. Your beef was the big one.") |
| Booster: voice | Each agent speaks big moments with its own pitch and rate (Web Speech). Me → Agent voices |

## The carbon ledger and the council

- **Log it** (center tab): tap what you did. Each line is computed from `public/factors.js`, where every number is cited: Poore & Nemecek (2018) via Our World in Data for food; US EPA for driving (404 g CO2/mile), gasoline (8,887 g/gal), electricity (0.394 kg/kWh), natural gas, and WaterSense for showers. Assumptions (like a 150 g portion) are shown next to the number.
- **Scan a receipt or bill**: Gemini (or OpenAI) reads the photo and only *extracts* line items into a fixed JSON schema. It never produces a number: the server computes footprints from the same cited factors, and unknown items are shown as "not counted", never guessed.
- The server ignores any numbers the client sends; it recomputes every line. Each line goes to `logs/ledger.jsonl` with its factor key and amount.
- **Missions from your log**: when you go over today's budget in a category, its agent reacts on the next tick (Mossling: food, Frostbun: travel and energy, Ripplet: water, Sunfox: stuff). Logging a tofu meal completes Mossling's "plant-based meal" mission.
- **Council** (every 12 ticks): the agents read the street's real logs, and an under-budget guardian can give part of its budget to an over-budget one (if it trusts it). The Smog Baron lobbies for a "Black Friday flash sale"; Sunfox casts the deciding vote based on its greed and trust. The council also learns which nudges each person actually follows.

## How the agents decide (`public/agents-engine.js`, shared by server and browser)

Every tick, each agent lists its options and scores them:

**goal gap × live data signal (Bruin) × relationships (trust matrix) + seeded personality + learned bias + a little seeded noise**

It picks the top option and the effect changes the shared world. The log records the runner-ups it rejected. Examples:

- Frostbun's urgency rises on warm days (`heat` from Bruin); Mossling's when forest PM2.5 is high (`smog_pressure`).
- The Smog Baron targets zones that are weak, smoggy in real life, and **ignored by humans** (real actions add "attention").
- Sunfox weighs the bribe against how much the guardians trust it. Betraying steals seeds and leaks the weakest zone to the Baron; refusing raises trust.
- Guardians post **personalized quests** from each player's profile quiz ("You drive most days. One trip on foot cools my ice"). Completing one in real life gives a bonus.

## Bruin (`pipeline/`)

| Asset | What it does | Checks |
|---|---|---|
| `raw.air_live` (Python) | Live hourly PM2.5, temperature, humidity from Open-Meteo for Griffith Park, Mt. Baldy, Downtown LA, Santa Monica Bay. Falls back to a labeled snapshot per place if a fetch fails | |
| `staging.stg_air_daily` (SQL) | Daily averages per zone | not_null, accepted_values, non_negative, 3 custom (PM2.5 0–500, temp −30–55 °C, all 4 zones present) |
| `marts.daily_spawn` (SQL) | What agents read each tick: `smog_pressure`, `heat`, `spawn_score` (+ space) | not_null, unique, non_negative, custom "5 zones" |
| `raw.agent_decisions` (Python) | Loads `logs/decisions.jsonl`, written live by the server | |
| `marts.agent_report` (SQL) | Audits every agent: allies, trades, betrayals and bribes, fights, quests, decisions grounded in Bruin data | not_null, unique, positive, custom "no agent acts without a reason" |
| `raw.emission_factors` (seed CSV) | The cited factor table (EPA, Poore & Nemecek), same numbers as the app | not_null, unique, non_negative |
| `raw.ledger` (Python) | Every real log line from `logs/ledger.jsonl` (factor key + amount) | |
| `marts.footprint_daily` (SQL) | **Recomputes** everyone's footprint per person per day from the factor table (Today tab: "Source: Bruin footprint_daily") | not_null, non_negative, 3 custom: every line has a source, every line maps to a cited factor, **the app's CO2 math matches Bruin's** |
| `export.game_data` (SQL) | Writes `data/daily_spawn.csv`, `data/agent_report.csv`, `data/footprint_daily.csv`; the server hot-reloads them | |

```bash
bruin validate pipeline   # ✓ 9 assets, no issues
bruin run pipeline        # ✓ 9 assets, 33 quality checks passed
```

After a run, the Agents log cites `Bruin · daily_spawn <date>` on every agent decision, **Run report** says `Source: Bruin agent_report`, and Today's history says `Source: Bruin footprint_daily`. Bruin isn't only a loader here: it computes everyone's carbon ledger, checks the app's math, and holds the AI agents accountable.

## Sponsors: honest status

The app's **Me → How Impact works** shows live status from `/api/health`. A sponsor turns green only after a real call succeeds on the server.

| Sponsor | Use in Impact | Status |
|---|---|---|
| **Bruin** | Recomputes everyone's carbon ledger, feeds the agents live air data, audits every decision | ✅ **used**: validate + run pass (9 assets, 33 checks), live Open-Meteo data, server hot-reloads it |
| **BAND** | The street's group chat is a real BAND room, both ways. **Out:** alliances, bribes, betrayals, missions, council meetings and run endings are posted with the agent's reason (max 1 per agent per minute). **In:** humans @mention Impact World with `status`, `rally ocean`, `budget`, `report`; a rally changes the shared planet for every player and is logged with source "BAND room" | ⚪ written (`sponsors/band.js`: REST + live Phoenix WebSocket, startup backlog drain, claim → reply → processed), **not verified yet: waiting on the BAND agent key** |
| **Telem** | Today's real news per zone changes what the agents do: alarming news (smoke, beach closures, smog alerts, low snowpack) raises that zone's guardian urgency and draws the Smog Baron toward it; the log cites the article with a link; Feed shows "Live · via Telem" reels | ⚪ written (`sponsors/telem.js`), **not verified yet: no API key** |
| **Runware** | Every run ends with a storybook postcard of the final planet (posted to the Feed and the BAND room), plus "Make my world postcard" on demand, with a running cost counter | ✅ **used: verified with real calls**. Postcards cost about $0.0057 each; total so far ≈ $0.01 |
| Glasser | Drop-off places in Bin Buddy | not used: we focused on the sponsors whose tools the game needs; adapter kept in `sponsors/glasser.js`, hidden in the app |
| AI: Gemini (OpenAI optional) | Receipt/bill scanner (vision, extraction only, structured JSON) + one-line agent voices (max 1 per 30 s) | ✅ **used: Gemini verified with a real call**. A test grocery receipt came back as 6 correct items (paper towels, tax and totals skipped); footprints computed from the cited factors. The server picks the newest Flash model the key can actually use. OpenAI is wired as an automatic backup (same request retries on OpenAI if Gemini fails), but **not used today: the OpenAI account has no API credits** (`credit_balance_exhausted`) |
| Lingcode | Wrap the PWA as an app | not used yet |
| Teamily | "Maple St" street group for humans + a role agent (link in Neighbors) | event comms |
| AdaL | Demo video | — |

To turn one on: copy `.env.example` to `.env`, add the key, and run `npm start`. If one still fails, this table will say why. Nothing is faked.

## Data honesty
- Air data is live from Open-Meteo through Bruin (`source` column says `open-meteo (live)`), or a labeled snapshot.
- Footprint numbers in the profile are very rough estimates from published averages.
- Photo proof stays on the device. It is not uploaded or verified by AI.
- Players and neighbors shown are real players on the server (no fake sample neighbors).

## Files
```
server.js                 zero-dependency server: SSE, tick loop + catch-up, decisions.jsonl, API
public/agents-engine.js   the five agents (shared by server and browser)
public/factors.js         cited emission factors (shared by server and browser)
public/app.js             PWA UI · public/globe.js 3D planet · public/faces.js characters
pipeline/                 Bruin assets  ·  .bruin.yml (DuckDB at data/impact.duckdb)
sponsors/                 Telem, BAND, Runware, Glasser, Gemini/OpenAI adapters (honest health)
test/engine.test.js       engine checks
```
