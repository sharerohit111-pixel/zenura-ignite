# Paper Trading snapshot reconciliation

This is a read-only, offline comparator. It compares the transformed expected JSONL tables
against a separately created Supabase read-only snapshot. It has no Supabase client, no network
access, no SQL execution and no import capability.

## Required inputs
- Expected directory created by \`firebase-to-supabase-transform.js\`, containing its
  \`transform-report.json\` and all seven table JSONL files.
- Actual snapshot directory containing all seven matching JSONL files and a
  \`snapshot-manifest.json\` with format \`zenura-supabase-read-only-snapshot-v1\`,
  \`readOnly: true\`, and each table's row count and SHA-256 of its exact JSONL bytes.
- A new report path outside both input directories.

## Comparison
Compares stable primary keys and canonical full-row hashes. Reports missing, extra and
changed rows separately for identity map, shared accounts, equity positions, derivative
positions, equity orders, derivative orders and watchlists. No financial rounding or fuzzy
matching is used: paise and stored fields must match exactly.

## Run
From \`market-gateway\`:
\`\`\`sh
node --test test/paper-trading-reconcile.test.js
\`\`\`

The report is a reconciliation result only. A passing report does not itself authorize import,
cutover or deletion. Do not create the actual Supabase snapshot until an approved read-only
snapshot procedure and the destination schema are confirmed. The current linked Supabase
project has no public Paper Trading tables, so this comparator has only been exercised with
synthetic fixtures.