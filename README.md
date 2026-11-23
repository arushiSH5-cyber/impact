# Impact: heal the planet together

**Track 02 · Co-op Multiplayer Game · Agents for Impact Hackathon (Nov 23, 2026)**

> A UI concept was sketched before the event; all code in this repo was written during the event.

Impact is a co-op 3D planet. **Five AI agents with their own goals** live on it and act every 10 seconds, even when nobody is playing. **Two or more humans** join from their phones and share the same world. The agents' choices are driven by **live air-quality data from a Bruin pipeline** and by the humans' **real-world eco actions** (photo-proofed). Every decision is logged with *why*, *the data it used* and *its source*, and Bruin audits the agents afterwards.

```
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
| Booster: voice | Each agent speaks big moments with its own pitch and rate (Web Speech). Me → Agent voices |

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
| `export.game_data` (SQL) | Writes `data/daily_spawn.csv` and `data/agent_report.csv`; the server hot-reloads them | |

```bash
bruin validate pipeline   # ✓ 6 assets, no issues
bruin run pipeline        # ✓ 6 assets, 21 quality checks passed
```

After a run, the Agents log cites `Bruin · daily_spawn <date>` on every agent decision and **Run report** says `Source: Bruin agent_report`. Bruin isn't only a loader here: it holds the AI agents accountable.

## Sponsors: honest status

The app's **Me → How Impact works** shows live status from `/api/health`. A sponsor turns green only after a real call succeeds on the server.

| Sponsor | Use in Impact | Status |
|---|---|---|
| **Bruin** | Pipeline feeding the agents live air data and auditing every decision | ✅ **used**: validate + run pass (6 assets, 21 checks), live Open-Meteo data, server hot-reloads it |
| Telem | Each zone's agent cites one fresh news result (with link) in its log; "Live · via Telem" news reels in the Feed | ⚪ adapter written (`sponsors/telem.js`), **not verified: no API key on the build machine yet** |
| BAND | Ally/betray/quest/fight/end events posted to a BAND room with an @mention, max 1 per agent per minute; log shows "posted to BAND" | ⚪ adapter written (`sponsors/band.js`), **not verified: no API key / room yet** |
| Runware | "Make my world postcard" paints the live planet state; cost counter | ⚪ adapter written (`sponsors/runware.js`), **not verified: no API key yet**. Total cost so far: $0 |
| Glasser | "Drop-off places near me" in Bin Buddy | ⚪ adapter written (`sponsors/glasser.js`), **not verified: CLI not installed, no key** |
| Claude (optional) | One in-character line per big agent event | ⚪ off unless `ANTHROPIC_API_KEY` is set |
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
public/app.js             PWA UI · public/globe.js 3D planet · public/faces.js characters
pipeline/                 Bruin assets  ·  .bruin.yml (DuckDB at data/impact.duckdb)
sponsors/                 Telem, BAND, Runware, Glasser, Claude adapters (honest health)
test/engine.test.js       engine checks
```
