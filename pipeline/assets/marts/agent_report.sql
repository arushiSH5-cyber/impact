/* @bruin
name: marts.agent_report
type: duckdb.sql
description: Holds the AI agents accountable. Per agent, across every run in logs/decisions.jsonl - alliances, trades, betrayals and bribes, fights, quests for humans, and how many decisions were grounded in Bruin data.
materialization:
  type: table
depends:
  - raw.agent_decisions
columns:
  - name: agent
    type: varchar
    checks:
      - name: not_null
      - name: unique
  - name: actions
    type: integer
    checks:
      - name: positive
custom_checks:
  - name: no agent acts without a reason
    query: SELECT count(*) FROM raw.agent_decisions WHERE agent NOT IN ('world', 'human') AND kind <> 'none' AND coalesce(why, '') = ''
    value: 0
@bruin */
SELECT
    CASE agent WHEN 'baron' THEN 'Smog Baron' ELSE upper(substr(agent, 1, 1)) || substr(agent, 2) END AS agent,
    count(DISTINCT run_seed)                                     AS runs,
    count(*)                                                     AS actions,
    sum(CASE WHEN kind = 'ally'   THEN 1 ELSE 0 END)             AS allies,
    sum(CASE WHEN kind = 'trade'  THEN 1 ELSE 0 END)             AS trades,
    sum(CASE WHEN kind = 'betray' THEN 1 ELSE 0 END)             AS betrayals_and_bribes,
    sum(CASE WHEN kind = 'fight'  THEN 1 ELSE 0 END)             AS fights,
    sum(CASE WHEN kind = 'quest'  THEN 1 ELSE 0 END)             AS quests_for_humans,
    sum(CASE WHEN sources LIKE '%Bruin%' THEN 1 ELSE 0 END)      AS decisions_using_bruin_data,
    max(ts)                                                      AS last_seen
FROM raw.agent_decisions
WHERE agent NOT IN ('world', 'human')
GROUP BY 1
ORDER BY actions DESC
