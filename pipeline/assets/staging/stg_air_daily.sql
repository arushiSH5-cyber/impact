/* @bruin
name: staging.stg_air_daily
type: duckdb.sql
description: Daily averages per zone, with data-quality checks before the agents see anything.
materialization:
  type: table
depends:
  - raw.air_live
columns:
  - name: zone
    type: varchar
    checks:
      - name: not_null
      - name: accepted_values
        value: [forest, ice, desert, ocean]
  - name: date
    type: date
    checks:
      - name: not_null
  - name: pm25
    type: double
    checks:
      - name: not_null
      - name: non_negative
  - name: humidity
    type: double
    checks:
      - name: not_null
      - name: non_negative
custom_checks:
  - name: pm25 within a sane range (0 to 500)
    query: SELECT count(*) FROM staging.stg_air_daily WHERE pm25 > 500
    value: 0
  - name: temperature within a sane range (-30 to 55 C)
    query: SELECT count(*) FROM staging.stg_air_daily WHERE temp_c < -30 OR temp_c > 55
    value: 0
  - name: every zone has data
    query: SELECT 4 - count(DISTINCT zone) FROM staging.stg_air_daily
    value: 0
@bruin */
SELECT
    zone,
    any_value(place)                                  AS place,
    CAST(substr(CAST(ts AS VARCHAR), 1, 10) AS DATE)  AS date,
    round(avg(pm25), 1)                               AS pm25,
    round(avg(temp_c), 1)                             AS temp_c,
    round(avg(humidity), 0)                           AS humidity,
    count(*)                                          AS hours,
    any_value(source)                                 AS source
FROM raw.air_live
WHERE pm25 IS NOT NULL
GROUP BY zone, CAST(substr(CAST(ts AS VARCHAR), 1, 10) AS DATE)
