"""@bruin
name: raw.agent_decisions
connection: duckdb-default
description: Every agent and human decision, loaded from logs/decisions.jsonl (written live by server.js every tick).
materialization:
  type: table
  strategy: create+replace
columns:
  - name: agent
    type: varchar
  - name: kind
    type: varchar
@bruin"""
import json
import os

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "..", "..", "..", "logs", "decisions.jsonl")
COLS = ["id", "run_seed", "tick", "ts", "agent", "kind", "action", "why", "data", "sources", "target"]


def materialize(**kwargs):
    rows = []
    if os.path.exists(LOG):
        with open(LOG) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # a half-written last line while the server is running
    print(f"loaded {len(rows)} decisions from logs/decisions.jsonl")
    if not rows:
        rows = [{"id": 0, "run_seed": 0, "tick": 0, "ts": "", "agent": "world", "kind": "none",
                 "action": "no decisions yet", "why": "", "data": "", "sources": "", "target": ""}]
    df = pd.DataFrame(rows)
    for c in COLS:
        if c not in df.columns:
            df[c] = ""
    df = df[COLS]
    for c in ["id", "run_seed", "tick"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0).astype("int64")
    for c in COLS[3:]:
        df[c] = df[c].fillna("").astype(str)
    return df
