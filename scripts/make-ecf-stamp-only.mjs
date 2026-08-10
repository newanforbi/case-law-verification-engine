/**
 * Multi-page PDF whose text layer is only CM/ECF page stamps — body blank.
 * Used to prove stamp-only layers fall through to OCR.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "fixtures", "ecf-stamp-only.pdf");
const PAGE_COUNT = 6;

function escapePdf(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function pageContent(pageNum) {
  const stamp = `Case 2:26-cv-00195-TLN-AC Document 1 Filed 01/22/26 Page ${pageNum} of ${PAGE_COUNT}`;
  return ["BT", "/F1 9 Tf", "72 760 Td", `(${escapePdf(stamp)}) Tj`, "ET"].join(
    "\n",
  );
}

// objs: 1 Catalog, 2 Pages, 3 Font, then (Page, Contents) × N
const fontObj = 3;
const pageObjs = [];
const contentObjs = [];
for (let i = 0; i < PAGE_COUNT; i++) {
  pageObjs.push(4 + i * 2);
  contentObjs.push(5 + i * 2);
}
const maxObj = contentObjs[contentObjs.length - 1];

const kids = pageObjs.map((n) => `${n} 0 R`).join(" ");
/** @type {string[]} */
const ordered = new Array(maxObj + 1);
ordered[1] = "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n";
ordered[2] =
  `2 0 obj<< /Type /Pages /Kids [${kids}] /Count ${PAGE_COUNT} >>endobj\n`;
ordered[3] =
  `${fontObj} 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n`;

for (let i = 0; i < PAGE_COUNT; i++) {
  const pageObj = pageObjs[i];
  const contentObj = contentObjs[i];
  const stream = pageContent(i + 1);
  const streamLen = Buffer.byteLength(stream, "utf8");
  ordered[pageObj] =
    `${pageObj} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>endobj\n`;
  ordered[contentObj] =
    `${contentObj} 0 obj<< /Length ${streamLen} >>stream\n${stream}\nendstream\nendobj\n`;
}

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (let i = 1; i <= maxObj; i++) {
  offsets[i] = Buffer.byteLength(pdf, "utf8");
  pdf += ordered[i];
}
const xrefStart = Buffer.byteLength(pdf, "utf8");
pdf += `xref\n0 ${maxObj + 1}\n`;
pdf += "0000000000 65535 f \n";
for (let i = 1; i <= maxObj; i++) {
  pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
}
pdf += `trailer<< /Size ${maxObj + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefStart}\n%%EOF\n`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, pdf);
console.log("wrote", outPath, Buffer.byteLength(pdf), "bytes");
