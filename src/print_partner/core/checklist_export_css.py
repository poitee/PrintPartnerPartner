"""Shared print-checklist CSS for HTML export (laser / letter paper)."""

CHECKLIST_EXPORT_CSS = """
:root {
  --ink: #111111;
  --ink-muted: #444444;
  --line: #222222;
  --line-light: #bbbbbb;
  --paper: #ffffff;
  --screen-bg: #f4f5f7;
  --header-bg: #eef0f4;
}

* { box-sizing: border-box; }

body {
  font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.45;
  color: var(--ink);
  background: var(--screen-bg);
  margin: 0;
  padding: 0;
}

.checklist-doc {
  max-width: 8.5in;
  margin: 0 auto;
  padding: 0.2in 0.3in 0.35in;
  background: var(--paper);
}

.doc-header {
  border-bottom: 2pt solid var(--ink);
  padding-bottom: 0.2rem;
  margin-bottom: 0.35rem;
}

.doc-kicker {
  margin: 0 0 0.15rem;
  font-size: 8.5pt;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.doc-title {
  margin: 0;
  font-size: 18pt;
  font-weight: 700;
  line-height: 1.15;
}

.doc-meta {
  margin: 0.35rem 0 0;
  font-size: 9.5pt;
  color: var(--ink-muted);
}

.doc-meta strong { color: var(--ink); }

.swatch-dot {
  display: inline-block;
  width: 11pt;
  height: 11pt;
  border-radius: 2pt;
  border: 1pt solid var(--line);
  flex-shrink: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.repo-section {
  margin-top: 0.55rem;
  page-break-before: auto;
}

h2.repo-heading {
  margin: 0 0 0.15rem;
  font-size: 12pt;
  font-weight: 700;
  border-left: 4pt solid var(--ink);
  padding-left: 0.35rem;
}

.repo-meta {
  margin: 0 0 0.45rem;
  font-size: 9pt;
  color: var(--ink-muted);
}

h3.folder-heading {
  margin: 0.65rem 0 0.25rem;
  padding: 0.2rem 0.35rem;
  font-size: 9.5pt;
  font-weight: 700;
  background: var(--header-bg);
  border: 1pt solid var(--line-light);
  page-break-after: avoid;
}

table.parts-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 0 0 0.85rem;
  font-size: 9pt;
  page-break-inside: auto;
}

table.parts-table thead {
  display: table-header-group;
}

table.parts-table tr {
  page-break-inside: avoid;
  page-break-after: auto;
}

table.parts-table th,
table.parts-table td {
  border: 1pt solid var(--line);
  padding: 0.28rem 0.35rem;
  vertical-align: middle;
  text-align: left;
}

table.parts-table th {
  background: var(--header-bg);
  font-size: 8.5pt;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

table.parts-table th.check-col {
  white-space: nowrap;
  font-size: 8pt;
  letter-spacing: 0;
}

table.parts-table tbody tr:nth-child(even) {
  background: #fafafa;
}

td.filename-cell {
  word-break: break-word;
  white-space: normal;
  line-height: 1.3;
}

.part-row {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
}

.part-swatch {
  margin-top: 0.12rem;
}

.part-text {
  flex: 1;
  min-width: 0;
}

.part-name {
  display: block;
  font-weight: 600;
}

.part-role {
  display: block;
  margin-top: 0.1rem;
  font-size: 8pt;
  color: var(--ink-muted);
  text-transform: capitalize;
}

td.qty-cell {
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  white-space: nowrap;
}

td.check-cell {
  text-align: center;
  vertical-align: middle;
}

.check-box {
  display: inline-block;
  width: 13pt;
  height: 13pt;
  border: 1.75pt solid var(--ink);
  background: var(--paper);
  vertical-align: middle;
  position: relative;
}

.check-box.checked::after {
  content: "";
  position: absolute;
  left: 2.5pt;
  top: 0.5pt;
  width: 4pt;
  height: 8pt;
  border: solid var(--ink);
  border-width: 0 2pt 2pt 0;
  transform: rotate(45deg);
}

.check-box.checked[data-color]::after {
  border-color: var(--check-color, var(--ink));
}

input.checkbox-screen {
  width: 1.05rem;
  height: 1.05rem;
  margin: 0;
  cursor: pointer;
  vertical-align: middle;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

td.thumb-cell {
  text-align: center;
  padding: 0.25rem;
}

.thumb-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 1.35in;
  max-height: 1.55in;
  padding: 0.15rem;
  border: 1pt solid var(--line-light);
  background: #fff;
}

img.thumb {
  display: block;
  max-width: 100%;
  max-height: 1.45in;
  width: auto;
  height: auto;
  object-fit: contain;
}

.no-thumb {
  color: var(--ink-muted);
  font-size: 8pt;
}

td.notes-cell {
  font-size: 8.5pt;
  word-break: break-word;
  white-space: normal;
}

.screen-hint {
  margin: 0.75rem 0 0;
  padding: 0.4rem 0.5rem;
  font-size: 9pt;
  color: var(--ink-muted);
  border: 1pt dashed var(--line-light);
  background: #fffef8;
}

.no-print { }

@media screen {
  .check-box { display: none !important; }
  input.checkbox-screen { display: inline-block !important; }
}

@media print {
  @page {
    size: letter portrait;
    margin: 0.35in;
  }

  body {
    background: var(--paper);
    font-size: 10pt;
  }

  .checklist-doc {
    max-width: none;
    margin: 0;
    padding: 0;
  }

  .screen-hint,
  .no-print {
    display: none !important;
  }

  input.checkbox-screen {
    display: none !important;
  }

  .check-box {
    display: inline-block !important;
  }

  table.parts-table tbody tr:nth-child(even) {
    background: #fff;
  }

  table.parts-table th {
    background: #f0f0f0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .thumb-wrap,
  img.thumb {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
"""
