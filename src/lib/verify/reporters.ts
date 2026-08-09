export interface ReporterPin {
  volume: string;
  page: string;
  slug: string;
  label: string;
  pin: string;
}

/** reporter slug on static.case.law → regex capturing (volume, page) */
const REPORTER_MAP: Array<[RegExp, string, string]> = [
  [/(\d+)\s+U\.?\s*S\.?\s+(\d+)/i, "us", "U.S."],
  [/(\d+)\s+F\.\s*R\.\s*D\.\s+(\d+)/i, "frd", "F.R.D."],
  [/(\d+)\s+F\.\s*2d\s+(\d+)/i, "f2d", "F.2d"],
  [/(\d+)\s+F\.\s*3d\s+(\d+)/i, "f3d", "F.3d"],
  [/(\d+)\s+F\.\s*4th\s+(\d+)/i, "f4th", "F.4th"],
  [/(\d+)\s+F\.\s*Supp\.\s*2d\s+(\d+)/i, "f-supp-2d", "F. Supp. 2d"],
  [/(\d+)\s+F\.\s*Supp\.\s*3d\s+(\d+)/i, "f-supp-3d", "F. Supp. 3d"],
  [/(\d+)\s+M\.?\s*J\.?\s+(\d+)/i, "mj", "M.J."],
  [/(\d+)\s+Cal\.\s*App\.\s*5th\s+(\d+)/i, "cal-app-5th", "Cal. App. 5th"],
  [/(\d+)\s+Cal\.\s*App\.\s*4th\s+(\d+)/i, "cal-app-4th", "Cal. App. 4th"],
  [/(\d+)\s+Cal\.\s*App\.\s*3d\s+(\d+)/i, "cal-app-3d", "Cal. App. 3d"],
  [/(\d+)\s+Cal\.\s*5th\s+(\d+)/i, "cal-5th", "Cal. 5th"],
  [/(\d+)\s+Cal\.\s*4th\s+(\d+)/i, "cal-4th", "Cal. 4th"],
  [/(\d+)\s+Cal\.\s*3d\s+(\d+)/i, "cal-3d", "Cal. 3d"],
  [/(\d+)\s+S\.\s*Ct\.\s+(\d+)/i, "s-ct", "S. Ct."],
  [/(\d+)\s+L\.\s*Ed\.\s*2d\s+(\d+)/i, "l-ed-2d", "L. Ed. 2d"],
];

export const WL_RE = /(?:WL|Westlaw)\s*(\d{7,})/i;

export function parseReporter(citation: string): ReporterPin | null {
  let c = citation.replace(/Cal\.App\./g, "Cal. App.").replace(/Cal\.App /g, "Cal. App. ");
  c = c.replace(/\s+/g, " ");
  for (const [pat, slug, label] of REPORTER_MAP) {
    const m = c.match(pat);
    if (m) {
      const volume = m[1];
      const page = m[2];
      return {
        volume,
        page,
        slug,
        label,
        pin: `${volume} ${label} ${page}`,
      };
    }
  }
  return null;
}

export function guessName(citation: string): string {
  let c = citation.trim();
  c = c.replace(/^(?:See|Under|In|Holding\s+Key\s+Fact)\s+/i, "");
  const nameRe = /^(?:See\s+)?(.+?),\s+\d+\s+(?:U\.S\.|F\.|Cal\.)/i;
  const m = nameRe.exec(c);
  if (m) return m[1].trim();
  const m2 = /^([^0-9]+)/.exec(c);
  return (m2 ? m2[1].replace(/[ ,]+$/, "") : citation).slice(0, 80);
}
