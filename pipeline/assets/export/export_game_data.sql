/* @bruin
name: export.game_data
type: duckdb.sql
description: Writes the tables the game reads back to CSV. server.js watches data/daily_spawn.csv and hot-reloads it; /api/report serves data/agent_report.csv; /api/footprint serves data/footprint_daily.csv. Paths are relative to the repo root, where bruin is run.
depends:
  - marts.daily_spawn
  - marts.agent_report
  - marts.footprint_daily
@bruin */
COPY (SELECT * FROM marts.daily_spawn ORDER BY zone) TO 'data/daily_spawn.csv' (HEADER, DELIMITER ',');
COPY (SELECT * FROM marts.agent_report) TO 'data/agent_report.csv' (HEADER, DELIMITER ',');
COPY (SELECT * FROM marts.footprint_daily) TO 'data/footprint_daily.csv' (HEADER, DELIMITER ',');
