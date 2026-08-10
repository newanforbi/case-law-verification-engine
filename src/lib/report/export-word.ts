/**
 * Word-compatible export of a verification report.
 *
 * Produces HTML that Microsoft Word opens as a .doc without a server-side
 * docx dependency. This is the outbound foundation: same artifact as JSON,
 * shaped for counsel who live in Word rather than a browser print dialog.
 */
import type { VerificationReport } from "./report";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reportWordFileName(report: VerificationReport): string {
  const day = report.generatedAt.slice(0, 10);
  const base = report.document?.fileName?.replace(/\.pdf$/i, "") ?? "citations";
  const safe = base.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 40);
  return `citeproof-${safe}-${day}-${report.id}.doc`;
}

/** HTML Word will open; save with a .doc extension. */
export function reportToWordHtml(report: VerificationReport): string {
  const rows = report.records
    .map((r) => {
      const sources = r.sources
        .map((s) => {
          const env = s.envelope
            ? ` [${s.envelope.reason}${s.envelope.reporter ? ` · ${s.envelope.reporter}` : ""}]`
            : "";
          return `${s.source}: ${s.outcome}${env}`;
        })
        .join("; ");
      const quotes = r.quotes.length
        ? r.quotes.map((q) => `${q.match}: “${esc(q.passage)}”`).join("<br/>")
        : "—";
      const links = (r.links ?? [])
        .map((l) => `${esc(l.label)} (${l.kind}): ${esc(l.url)}`)
        .join("<br/>");
      const meta = [r.courtLabel, r.decisionYear].filter(Boolean).join(" · ");
      return `<tr>
  <td>${esc(r.citation)}${meta ? `<br/><span style="color:#555">${esc(meta)}</span>` : ""}</td>
  <td>${esc(r.existence)}</td>
  <td>${esc(r.support)}</td>
  <td>${esc(r.matchedCaption || "—")}</td>
  <td>${esc(sources || "—")}</td>
  <td>${quotes}</td>
  <td>${links || "—"}</td>
  <td>${esc(r.checkedAt || "—")}</td>
</tr>`;
    })
    .join("\n");

  const controls = report.methodology.controls;
  const controlBlock = report.controlRun
    ? report.controlRun.results
        .map(
          (c) =>
            `<li>${esc(c.role)}: ${esc(c.citation)} — expected ${esc(c.expected)}, got ${esc(c.actual)} (${c.ok ? "pass" : "FAIL"})</li>`,
        )
        .join("")
    : `<li>Positive (must resolve): ${esc(controls.positive)}</li>
       <li>Negative (must not resolve): ${esc(controls.negative)}</li>`;

  const caveats = report.caveats.map((c) => `<li>${esc(c)}</li>`).join("\n");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>Citeproof verification report ${esc(report.id)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Calibri, Georgia, serif; font-size: 11pt; color: #111; }
  h1 { font-size: 16pt; margin-bottom: 4pt; }
  h2 { font-size: 12pt; margin-top: 18pt; }
  table { border-collapse: collapse; width: 100%; margin-top: 8pt; }
  th, td { border: 1px solid #444; padding: 4pt 6pt; vertical-align: top; }
  th { background: #f0f0f0; text-align: left; }
  .meta { color: #444; margin: 2pt 0; }
</style>
</head>
<body>
  <h1>Citation verification report</h1>
  <p class="meta">Citeproof · report ${esc(report.id)} · method ${esc(report.methodVersion)}</p>
  <p class="meta">Generated ${esc(report.generatedAt)}${
    report.document
      ? ` · ${esc(report.document.fileName)} (${report.document.pageCount} pp.)`
      : ""
  }</p>
  <p class="meta">${report.summary.citations} authorit${
    report.summary.citations === 1 ? "y" : "ies"
  } checked</p>

  <h2>Method controls</h2>
  <ul>${controlBlock}</ul>

  <h2>Caveats</h2>
  <ul>${caveats}</ul>

  <h2>Authorities</h2>
  <table>
    <thead>
      <tr>
        <th>Citation</th>
        <th>Existence</th>
        <th>Support</th>
        <th>Matched caption</th>
        <th>Sources</th>
        <th>Quotes</th>
        <th>Open links</th>
        <th>Checked at</th>
      </tr>
    </thead>
    <tbody>
${rows || `<tr><td colspan="8">No authorities in this report.</td></tr>`}
    </tbody>
  </table>

  <h2>Sources consulted</h2>
  <p>${esc((report.methodology.sources ?? []).join("; "))}</p>
  <p>${esc(report.methodology.reference ?? "")}</p>
</body>
</html>`;
}
