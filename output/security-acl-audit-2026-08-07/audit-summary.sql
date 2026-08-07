WITH audit_totals (
  database_passed,
  typesense_passed,
  zap_high,
  fixed_findings
) AS (
  VALUES (162, 162, 0, 3)
)
SELECT
  database_passed,
  typesense_passed,
  zap_high,
  fixed_findings
FROM audit_totals;

WITH audit_actor_counts (actor, passed_checks) AS (
  VALUES
    ('workspaceAdmin', 29),
    ('viewer', 22),
    ('groupMember', 17),
    ('owner', 14),
    ('revoked', 14),
    ('anonymous', 13),
    ('editor', 12),
    ('otherSpace', 12),
    ('spaceAdmin', 12),
    ('tenantB', 8),
    ('ragKey', 5),
    ('mcpKey', 4)
)
SELECT actor, passed_checks
FROM audit_actor_counts
ORDER BY passed_checks DESC, actor ASC;
