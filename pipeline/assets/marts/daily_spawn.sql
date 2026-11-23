/* @bruin
name: marts.daily_spawn
type: duckdb.sql
description: What every agent reads each tick. The latest complete day per zone, turned into game signals (smog_pressure drives the Smog Baron, heat drives Frostbun).
materialization:
  type: table
depends:
  - staging.stg_air_daily
columns:
  - name: zone
    type: varchar
    checks:
      - name: not_null
      - name: unique
  - name: smog_pressure
    type: double
    checks:
      - name: not_null
      - name: non_negative
  - name: heat
    type: double
    checks:
      - name: not_null
      - name: non_negative
custom_checks:
  - name: five zones including space
    query: SELECT count(*) FROM marts.daily_spawn
    value: 5
@bruin */
WITH ranked AS (
    -- prefer the most recent day with a full set of hours (today is still partial)
    SELECT *, row_number() OVER (PARTITION BY zone ORDER BY (hours >= 20) DESC, date DESC) AS rn
    FROM staging.stg_air_daily
)
SELECT
    zone,
    place,
    CAST(date AS VARCHAR)                                   AS date,
    pm25,
    temp_c,
    humidity,
    round(least(pm25 / 40.0, 1.2), 2)                       AS smog_pressure,
    round(greatest(least((temp_c - 5) / 25.0, 1), 0), 2)    AS heat,
    round(1 - least(pm25 / 50.0, 1), 2)                     AS spawn_score,
    source
FROM ranked
WHERE rn = 1
UNION ALL
SELECT 'space', 'Low Earth orbit', CAST(current_date AS VARCHAR), 0, 0, 0, 0.3, 0, 0.7, 'constant (orbital debris)'
