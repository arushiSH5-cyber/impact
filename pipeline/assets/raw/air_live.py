"""@bruin
name: raw.air_live
connection: duckdb-default
description: Live hourly PM2.5, temperature and humidity for 4 real LA places (Open-Meteo, no API key). Falls back to data/snapshot_air.csv per place if a fetch fails, and labels those rows.
materialization:
  type: table
  strategy: create+replace
columns:
  - name: zone
    type: varchar
  - name: source
    type: varchar
@bruin"""
import csv
import json
import os
import urllib.request

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PLACES = os.path.join(HERE, "..", "..", "..", "data", "snapshot_air.csv")
AIR = "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat}&longitude={lon}&hourly=pm2_5&past_days=1&forecast_days=1&timezone=America%2FLos_Angeles"
WEATHER = "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,relative_humidity_2m&past_days=1&forecast_days=1&timezone=America%2FLos_Angeles"


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "impact-hackathon-pipeline"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def live_rows(place):
    air = get_json(AIR.format(**place))["hourly"]
    wx = get_json(WEATHER.format(**place))["hourly"]
    weather = {t: (temp, hum) for t, temp, hum in zip(wx["time"], wx["temperature_2m"], wx["relative_humidity_2m"])}
    rows = []
    for t, pm in zip(air["time"], air["pm2_5"]):
        temp, hum = weather.get(t, (None, None))
        if pm is None or temp is None:
            continue
        rows.append({"zone": place["zone"], "place": place["place"], "ts": t, "pm25": float(pm),
                     "temp_c": float(temp), "humidity": float(hum), "source": "open-meteo (live)"})
    if not rows:
        raise ValueError("no hourly values")
    return rows


def materialize(**kwargs):
    with open(PLACES) as f:
        places = list(csv.DictReader(f))
    rows = []
    for p in places:
        try:
            got = live_rows(p)
            print(f"{p['zone']:<7} {p['place']:<20} {len(got)} live hours")
            rows += got
        except Exception as e:  # offline or API down: use the labeled snapshot for this place
            print(f"{p['zone']}: live fetch failed ({e}); using snapshot")
            rows.append({"zone": p["zone"], "place": p["place"], "ts": p["date"] + "T12:00", "pm25": float(p["pm25"]),
                         "temp_c": float(p["temp_c"]), "humidity": float(p["humidity"]), "source": "snapshot (sample)"})
    return pd.DataFrame(rows)
