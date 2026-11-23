# Impact: handoff

Status as of Nov 23, 2026, 3:16 PM PT. Submit by **5:30 PM** at hackathons.crewbasecollective.com (repo URL, video link, Track 02, sponsors used).

- Repo: https://github.com/arushiSH5-cyber/impact (public, all work pushed)
- Folder on the laptop: `~/Downloads/impact`
- Reference files (pre-event concept, **never commit these**): `~/Downloads/reference/`
- Personal walkthrough page (private): https://claude.ai/artifact/X26oouJsaWbzhm13Gc69Do

---

## 1. What Impact is (say this in the video)

> Five AI characters live on a shared planet that runs on your real day. What you eat, how you travel and the litter you pick up earn you seeds. You and your friends spend those seeds in live showdowns against the Smog Baron. Every agent decision is explained and audited by Bruin.

**The loop:** do something real → earn seeds → jump into the agents' drama (outbid a bribe, shield a zone, gift a character) → the planet changes for everyone on your street.

---

## 2. Run it

Needs Node 20.12+ (this laptop has Node 24). No `npm install`; the server has zero dependencies.

```bash
cd ~/Downloads/impact
```

```bash
npm start
```
- Laptop: http://localhost:8787
- Second player on the same laptop: http://localhost:8787/?p=2 (any `?p=` value is a separate player)
- Phones on the same wifi: the `http://192.168…:8787`-style address printed in the console (GPS is off on plain http, so the Litter Hunt runs in honor mode)

Faster agent ticks for recording the video (every 3 s instead of 10 s):
```bash
npm run demo
```

Rebuild the Bruin data (live air quality, footprints, agent audit), then restart the server:
```bash
bruin run pipeline
```
(If `bruin` isn't found: `export PATH="$HOME/.local/bin:$PATH"`.)

Tests:
```bash
npm test
```

### Phones with real GPS (https link)
Phones only give GPS to an **https** site. A temporary Cloudflare tunnel does that:
```bash
cloudflared tunnel --no-autoupdate --url http://localhost:8787
```
It prints a `https://….trycloudflare.com` link; open it on the phones. The current one is `https://teacher-hospital-toll-devon.trycloudflare.com` (it dies when the tunnel stops; each restart gives a new link). **Anyone with the link can join your game while it runs.** Keys stay on the laptop. If a phone says "can't find server", wait a minute or switch to cellular data.

### Restart cleanly
- Stop the server: Ctrl+C in its terminal (or `pkill -f "server.js"`).
- The world is saved in `data/state.json`. Restarting continues the same world, replays missed ticks, and the app shows "While you were away…".
- Start a fresh run from the app: **Story → (fold) Every decision → New run**.

---

## 3. Keys (`.env`, never committed)

`.env` in the repo folder holds the keys. It's gitignored. Keys present today:

| Key | What it does | Status |
|---|---|---|
| `GEMINI_API_KEY` | Receipt/bill scanner + short agent voice lines | ✅ working (auto-picks a Flash model the key can use) |
| `OPENAI_API_KEY` | Automatic backup if Gemini fails | ⚠️ key is valid but the account has **no credits** (`credit_balance_exhausted`); add credits at platform.openai.com → Billing and restart |
| `RUNWARE_API_KEY` | Postcard images | ✅ working |
| `BAND_API_KEY` | The BAND room (agent "Impact World") | ✅ working; it finds its room automatically |
| `TELEM_API_KEY` | Live news per zone | ✅ working |

Template with every variable: `.env.example`. Check status any time at http://localhost:8787/api/health or in the app: **Me → How Impact works (for judges)**.

---

## 4. Sponsors: what each one really does

| Sponsor | Prize | What it does in the game | Verified |
|---|---|---|---|
| **Bruin** | $1,000 / $500 (required) | Pipeline with 9 assets and 33 checks: live LA air quality → `daily_spawn` (every agent reads it each tick); your log lines + a cited factor table → `footprint_daily` (recomputes every footprint and checks the app's math); `decisions.jsonl` → `agent_report` (audits every agent). Repo also connected to Bruin Cloud. | ✅ |
| **BAND** | $500 | Two-way room. **Out:** agents post alliances, bribes, betrayals, missions, council meetings and run endings with the reason. **In:** in the room, type `@` → pick **Impact World** → `rally ocean` (or `status`, `budget`, `report`, `news`). A rally heals that zone for every player. | ✅ out (posts land). **In: still to test** |
| **Telem** | (check at the event) | Today's real news per zone changes decisions: alarming news raises that zone's guardian urgency and draws the Baron there. Today's forest headline: *"New wildfire reported in Los Angeles County on Nov. 23"*. Every move cites the article. | ✅ |
| **Runware** | (check at the event) | **Voices:** every character talks with its own Runware TTS voice (🔊 in the top bar turns voices on; 🔊 Hear on each character card). **Postcards:** every run ends with a storybook postcard of the final planet, shown in the Feed and posted to the BAND room. Also on demand: Today → Feed & news → **Make my world postcard**. About $0.006 per image; 7 images, $0.04 total today. | ✅ |
| Gemini (not a sponsor) | — | Reads receipts (extraction only; the math uses cited factors) + voice lines | ✅ |
| Glasser | $100 | Not used on purpose (hidden in the app; README says why) | — |
| Lingcode, Teamily, AdaL | — | Not code: wrap the app (Lingcode), "Maple St" group (Teamily), demo video (AdaL) | to do |

### Using Runware in the demo
1. Open Today → **Feed & news** → **Make my world postcard**. It paints the planet as it is right now (lush or grey per zone). Same planet state = cached, no new cost.
2. Or let a run finish (120 ticks; about 6 minutes with `npm run demo`): the end-of-run postcard appears in the Feed under "Run postcards" and is posted to the BAND room.
3. Cost so far shows in **Me → How Impact works** under Runware.
Change the picture style: the prompt in `postcard()` in `sponsors/runware.js`.

---

## 5. How to play (what to show)

| Where | What you do |
|---|---|
| **Planet** (home) | Watch the 5 characters move and talk. **Tap a name** to open the character: mood, what it wants, *Give me a mission*, *Give 5 seeds*. Showdown cards pop up here. |
| **Showdown card** | *"The Baron is bribing Sunfox!"* → **Outbid** with seeds before Sunfox decides (2 ticks). *"The Baron is eyeing the Desert!"* → **Shield**. Result: *"Sunfox stayed loyal!"* (confetti) or *"BETRAYED everyone!"* |
| **Log (+)** | Log real things (meals, drives, showers, trash, bills) with cited CO₂ math. Good swaps earn seeds and complete missions. |
| **Today** | Your CO₂ ring vs the council's budget, missions, **Litter Hunt**, scan a receipt, Feed & news. |
| **Litter Hunt** | Walk 150 m (GPS on the https link), tap **Binned one** + photo per piece. Heals the ocean, completes Ripplet's mission, earns seeds, goes on the leaderboard. |
| **Story** | The run as big moments with faces. The fold "Every decision…" has the full log with reasons and sources, **Run it twice** (seed 42 vs 7), **Run report** (Bruin audit), **New run**. |
| **Street** | Litter Hunt leaderboard, who's online, the BAND room card, invite link. |
| **Top bar** | Seeds, 🔥 daily streak, online count, zone health. |

---

## 6. Two-minute demo script

1. **(0:00) The living planet.** "Five AI characters live here and act every 10 seconds, even when nobody's playing." Tap Mossling: mood, what it wants.
2. **(0:20) Real life earns power.** On the phone: Log → a beef meal. Within a tick Mossling asks for a plant-based meal. Log tofu → mission complete, confetti, seeds.
3. **(0:40) Showdown.** The Baron bribes Sunfox; both phones get the card. Outbid. Sunfox stays loyal (or betrays, and you shield the weak zone).
3b. **(0:50) Baron Duel.** 🎮 Play → Baron Duel. Your AI teammate explains its move; the Baron (Hades voice) taunts. Turn voices on first (🔊 top bar).
4. **(1:00) BAND.** The room fills with agent posts. Type `@Impact World rally ocean`; the ocean heals on both phones.
5. **(1:20) Real data.** Story fold → a decision citing Bruin + the Telem wildfire headline. Terminal: `bruin run pipeline` → 33 checks pass. Run report says "Source: Bruin agent_report".
6. **(1:40) Litter Hunt + postcard.** A quick hunt clip, then the Runware postcard of the last run. Close on the README sponsor table.

Record with `npm run demo` running so things happen fast.

---

## 7. Still to do (in order)

1. **BAND inbound test:** in the room, `@Impact World rally ocean`. Confirm the reply and the ocean jump. Film it.
2. **Phones:** open the https link on 2 phones, add to home screen, do a Litter Hunt with a photo.
3. **Screenshots** for the README (planet with a showdown, Story, Today, a postcard, the BAND room, the Bruin Cloud lineage graph).
4. **Teamily** "Maple St" group (show 5 s in the video). Lingcode only if there's time.
5. **Record and upload** the 2-minute video (unlisted YouTube or Loom).
6. **Submit** by 5:30.

---

## 8. Where to change things

| I want to change… | File | Look for |
|---|---|---|
| How agents decide | `public/agents-engine.js` | `guardianOptions`, `traderOptions`, `villainOptions`, `apply` |
| Showdowns (bribe wait, outbid power, shields) | `public/agents-engine.js` | `OFFER_WAIT`, `out / 25`, `back()`, shield in `pollute` |
| Seeds earned | `public/agents-engine.js` | `earned` in `human()` |
| Difficulty / run length | `public/agents-engine.js` | decay in `tick()` (0.32), `ROUND_TICKS` (120) |
| CO₂ numbers | `public/factors.js` | `FOOD`, `CAR_KM`, `KWH` (Bruin re-checks them via `pipeline/assets/raw/emission_factors.csv`) |
| Screens, showdown cards, character cards | `public/app.js` + `public/app.css` | `renderShow`, `openAgent`, `storyHTML`, `TABS.*` |
| Planet look | `public/globe.js` | `HEALTHY`, `SICK`, clouds, glow |
| Doodle icons | `public/index.html` | `<symbol id="d-…">` |
| BAND commands | `server.js` | `sponsors.band.listen` |
| News topics | `sponsors/telem.js` | `ZONE_QUERIES`, `ALARM` |
| Postcard style | `sponsors/runware.js` | prompt in `postcard()` |

---

## 9. Rules to keep following

- **Event rule:** only code written after 11:30 AM today goes to GitHub. Before every commit:
  `git diff --cached --name-only | xargs -I{} find {} ! -newermt "2026-11-23 11:30" 2>/dev/null` (must print nothing).
- Never commit `.env`, `data/state.json`, `data/footprint_daily.csv` or the `reference/` folder (all already gitignored or outside the repo).
- Honesty: a sponsor shows green only after a real call works; the README says what isn't used and why.

## 10. If something breaks

| Problem | Fix |
|---|---|
| Phone shows the old app | Close the tab and reopen (the app caches itself) |
| A sponsor shows "off" | Check `.env`, restart `npm start`, look at the console's `Sponsors:` line |
| Gemini "quota exceeded" | The server tries other Flash models; or set `GEMINI_MODEL=` to one that works |
| BAND not posting | The agent must be in a room with you; the server finds it within 30 s |
| Planet looks frozen | Check the server terminal is still running; reload |
| `bruin` not found | `export PATH="$HOME/.local/bin:$PATH"` |

## 11. Continue in a new Claude session

Open `~/Downloads/impact` and paste:
> Read HANDOFF.md and README.md in this repo. Keep the event rule (nothing older than 11:30 AM Nov 23 gets committed), never commit `.env`, keep sponsors honest. Then help me with: <what you need>.
