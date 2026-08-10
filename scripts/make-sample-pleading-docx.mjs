/**
 * Build a tiny .docx with known citations for Word intake tests.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "fixtures", "sample-pleading.docx");

const paragraphs = [
  "POINTS AND AUTHORITIES (WORD SAMPLE)",
  "Plaintiff respectfully submits that absolute immunity does not apply.",
  "See Richardson v. McKnight, 521 U.S. 399 (1997).",
  "Judicial immunity remains governed by Stump v. Sparkman, 435 U.S. 349 (1978).",
  "The following pins are method controls / known problems:",
  "In re Leman, 66 Cal.App.5th 200 (2021) — negative control (must not resolve).",
  "In re Hudson, 1 Cal.App.4th 1 (2006) — wrong volume (miscitation).",
  "In re Hudson, 143 Cal.App.4th 1 (2006) — correct pin.",
];

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const body = paragraphs
  .map(
    (p) =>
      `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`,
  )
  .join("");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

const zip = new JSZip();
zip.file("[Content_Types].xml", contentTypes);
zip.folder("_rels").file(".rels", rels);
zip.folder("word").file("document.xml", documentXml);
zip.folder("word").folder("_rels").file("document.xml.rels", docRels);

const buf = await zip.generateAsync({ type: "nodebuffer" });
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buf);
console.log("wrote", outPath, buf.length, "bytes");
