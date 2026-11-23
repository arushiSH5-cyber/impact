/* @bruin
name: marts.footprint_daily
type: duckdb.sql
description: Everyone's carbon ledger per person per day, recomputed by Bruin from the cited factor table (not trusted from the app). Checks that every line has a source, every factor exists, and the app's math matches Bruin's.
materialization:
  type: table
depends:
  - raw.ledger
  - raw.emission_factors
columns:
  - name: player
    type: varchar
    checks:
      - name: not_null
  - name: food_kg
    type: double
    checks:
      - name: non_negative
  - name: travel_energy_kg
    type: double
    checks:
      - name: non_negative
custom_checks:
  - name: every log line has a source
    query: SELECT count(*) FROM raw.ledger WHERE player_id <> '' AND coalesce(source, '') = ''
    value: 0
  - name: every log line maps to a cited factor
    query: SELECT count(*) FROM raw.ledger l LEFT JOIN raw.emission_factors f USING (factor_key) WHERE l.player_id <> '' AND f.factor_key IS NULL
    value: 0
  - name: the app's CO2 math matches Bruin's recomputation
    query: SELECT count(*) FROM raw.ledger l JOIN raw.emission_factors f USING (factor_key) WHERE l.player_id <> '' AND l.factor_key <> 'car_km_avoided' AND abs(l.amount * f.kg_co2e_per_unit - l.kg_app) > 0.01
    value: 0
@bruin */
WITH lines AS (
    SELECT l.*, f.kg_co2e_per_unit, f.liters_per_unit
    FROM raw.ledger l
    JOIN raw.emission_factors f USING (factor_key)
    WHERE l.player_id <> ''
)
SELECT
    day,
    any_value(player)                                                                             AS player,
    player_id,
    round(sum(CASE WHEN cat = 'food' THEN amount * kg_co2e_per_unit ELSE 0 END), 2)              AS food_kg,
    round(sum(CASE WHEN cat = 'travel' AND factor_key <> 'car_km_avoided' THEN amount * kg_co2e_per_unit ELSE 0 END), 2) AS travel_energy_kg,
    round(sum(CASE WHEN cat = 'water' THEN amount * liters_per_unit ELSE 0 END), 0)               AS water_l,
    CAST(sum(CASE WHEN cat = 'stuff' THEN items ELSE 0 END) AS INTEGER)                           AS stuff_items,
    round(sum(CASE WHEN factor_key = 'car_km_avoided' THEN amount * kg_co2e_per_unit ELSE 0 END), 2) AS saved_kg,
    count(*)                                                                                      AS log_lines,
    sum(CASE WHEN via = 'scan' THEN 1 ELSE 0 END)                                                 AS scanned_lines
FROM lines
GROUP BY day, player_id
ORDER BY day DESC, food_kg + travel_energy_kg DESC
