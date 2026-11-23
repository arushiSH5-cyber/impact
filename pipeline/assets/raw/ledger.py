"""@bruin
name: raw.ledger
connection: duckdb-default
description: Every real log line players made (meals, trips, showers, trash, scanned receipts), from logs/ledger.jsonl written live by server.js. Each line keeps the factor key and amount so the footprint can be recomputed here.
materialization:
  type: table
  strategy: create+replace
columns:
  - name: player_id
    type: varchar
  - name: factor_key
    type: varchar
@bruin"""
import json
import os

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, "..", "..", "..", "logs", "ledger.jsonl")
TEXT = ["ts", "day", "player_id", "player", "cat", "kind", "factor_key", "label", "source", "via"]
NUM = ["amount", "kg_app", "liters", "items", "saved_kg"]


def materialize(**kwargs):
    rows = []
    if os.path.exists(LEDGER):
        with open(LEDGER) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # half-written last line while the server runs
    print(f"loaded {len(rows)} ledger lines from logs/ledger.jsonl")
    if not rows:
        # placeholder so the table exists; marts filter player_id <> ''
        rows = [{"ts": "", "day": "1970-01-01", "player_id": "", "player": "", "cat": "none", "kind": "none", "factor_key": "item",
                 "label": "no log lines yet", "source": "none", "via": "", "amount": 0, "kg_app": 0, "liters": 0, "items": 0, "saved_kg": 0}]
    df = pd.DataFrame(rows)
    for c in TEXT:
        df[c] = df[c].fillna("").astype(str) if c in df.columns else ""
    for c in NUM:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0).astype("float64") if c in df.columns else 0.0
    return df[TEXT + NUM]
