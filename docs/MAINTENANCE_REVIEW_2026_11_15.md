# Maintenance inventory review: 2026-11-15

The user authorized this review after `verify:full` stopped at the expired
2026-11-14 deadline. Knip and jscpd were rerun with the exact commands and
normalizers used by `check:maintenance-audit`; no suppression or threshold was
changed.

The final inventory matches the accepted baseline exactly: **396 Knip
fingerprints and 16 duplicate blocks**, with no added or resolved fingerprints.
Two unused exports introduced by the MCP implementation were corrected before
the comparison: the internal result-limit helper became private, and the
versioned storage result is now explicitly used by the public storage method.

Retained Knip classifications and owners:

| Review group | Findings | Retained reason |
| --- | ---: | --- |
| Client application contracts | 181 | Cross-feature contracts, component aliases and test/compatibility exports |
| Generated database types | 100 | Generated Kysely aliases kept aligned with the database contract |
| Server framework/domain contracts | 104 | Nest reflection, module registration, email component aliases and reusable protocol/domain contracts |
| Editor package contracts | 11 | Package entry points and downstream extension consumers |

The accepted fingerprint lists, owners, classifications, rationales and duplicate
entries are unchanged. Their existing removal-review requirements remain in
force; this comparative review does not authorize removing these contracts.
The complete `verify:full` gate passed, including 295 server suites / 2604 tests
and 208 client files / 1039 tests. A client test's old guide-version assertion was updated to the
deliberately introduced v45 contract, rather than changing application behavior
to satisfy the old assertion.

The baseline and four review groups are reviewed through **2026-12-15**.
The baseline writer now derives the actual UTC review date and a 30-day deadline
instead of writing the obsolete fixed August/November dates. Its date behavior
is covered by deterministic tests. Future reviews must rerun and classify the
inventory before replacing the baseline.
