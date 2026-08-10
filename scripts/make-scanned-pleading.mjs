/**
 * Build an image-only PDF (no text layer) with known citations, for OCR tests.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "fixtures");
const outPath = join(outDir, "scanned-pleading.pdf");
const pngPath = join(outDir, "scanned-pleading.png");

mkdirSync(outDir, { recursive: true });

const lines = [
  "POINTS AND AUTHORITIES (SCANNED SAMPLE)",
  "",
  "See Richardson v. McKnight, 521 U.S. 399 (1997).",
  "Judicial immunity: Stump v. Sparkman, 435 U.S. 349 (1978).",
  "Negative control: In re Leman, 66 Cal.App.5th 200 (2021).",
];

const draw = [];
let y = 80;
for (const line of lines) {
  draw.push("-annotate", `+60+${y}`, line);
  y += 48;
}

execFileSync(
  "convert",
  [
    "-size",
    "1275x1650",
    "xc:white",
    "-font",
    "Helvetica",
    "-pointsize",
    "28",
    "-fill",
    "black",
    ...draw,
    pngPath,
  ],
  { stdio: "inherit" },
);

// ImageMagick's PDF writer embeds the raster — no selectable text layer.
execFileSync("convert", [pngPath, outPath], { stdio: "inherit" });
console.log("wrote", outPath, statSync(outPath).size, "bytes");
