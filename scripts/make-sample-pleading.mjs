/**
 * Build a tiny text-layer PDF with known good/bad citations for smoke tests.
 * Pure PDF writer — no native deps.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "fixtures", "sample-pleading.pdf");

const lines = [
  "POINTS AND AUTHORITIES (SAMPLE)",
  "",
  "Plaintiff respectfully submits that absolute immunity does not apply.",
  "See Richardson v. McKnight, 521 U.S. 399 (1997).",
  "Judicial immunity remains governed by Stump v. Sparkman, 435 U.S. 349 (1978).",
  "",
  "The following pins are method controls / known problems:",
  "In re Leman, 66 Cal.App.5th 200 (2021) — negative control (must not resolve).",
  "In re Hudson, 1 Cal.App.4th 1 (2006) — wrong volume (miscitation).",
  "In re Hudson, 143 Cal.App.4th 1 (2006) — correct pin.",
  "",
  "Westlaw-only example also appears in some drafts: Burrell v. Jackson, 2003 WL 23545858.",
];

function escapePdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const contentLines = ["BT", "/F1 11 Tf", "50 740 Td", "14 TL"];
for (const line of lines) {
  contentLines.push(`(${escapePdf(line)}) Tj`, "T*");
}
contentLines.push("ET");
const stream = contentLines.join("\n");

const objects = [];
objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
objects.push(
  "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
);
objects.push(
  `4 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream\nendobj\n`,
);
objects.push(
  "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
);

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const obj of objects) {
  offsets.push(Buffer.byteLength(pdf, "utf8"));
  pdf += obj;
}
const xrefStart = Buffer.byteLength(pdf, "utf8");
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefStart}\n%%EOF\n`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, pdf);
console.log("wrote", outPath, Buffer.byteLength(pdf), "bytes");
