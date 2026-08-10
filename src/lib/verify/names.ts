const NOISE = new Set([
  "v",
  "vs",
  "inc",
  "llc",
  "ltd",
  "co",
  "corp",
  "the",
  "of",
  "and",
  "see",
  "re",
  "in",
]);

const LEFT_NOISE = new Set([
  ...NOISE,
  "department",
  "dept",
]);

export function normalizeName(s: string): string {
  let out = s.toLowerCase();
  out = out.replace(/[’‘]/g, "'");
  out = out.replace(/[^a-z0-9]+/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

function partyTokens(name: string): [Set<string>, Set<string>] {
  const n = normalizeName(name);
  const parts = n.split(" v ");
  if (parts.length === 1) {
    const toks = new Set(n.split(" ").filter((t) => !NOISE.has(t)));
    return [toks, new Set()];
  }
  const left = new Set(parts[0].split(" ").filter((t) => !NOISE.has(t)));
  const right = new Set(parts[1].split(" ").filter((t) => !NOISE.has(t)));
  return [left, right];
}

function orderedSide(name: string, side: "left" | "right", noise: Set<string>): string[] {
  const n = normalizeName(name);
  const parts = n.split(" v ");
  const chunk =
    side === "left" ? parts[0] : parts.length > 1 ? parts[1] : n;
  return chunk.split(" ").filter((t) => t && !noise.has(t));
}

function leftSeqOk(a: string, b: string): boolean {
  const oa = orderedSide(a, "left", LEFT_NOISE);
  const ob = orderedSide(b, "left", LEFT_NOISE);
  if (!oa.length || !ob.length) return false;
  if (oa.join(" ") === ob.join(" ")) return true;
  if (oa.length >= 2 && oa.join(" ") === ob.slice(0, oa.length).join(" ")) return true;
  if (ob.length >= 2 && ob.join(" ") === oa.slice(0, ob.length).join(" ")) return true;
  if (oa.length >= 2) {
    for (let i = 0; i <= ob.length - oa.length; i++) {
      if (oa.join(" ") === ob.slice(i, i + oa.length).join(" ")) return true;
    }
  }
  if (ob.length >= 2) {
    for (let i = 0; i <= oa.length - ob.length; i++) {
      if (ob.join(" ") === oa.slice(i, i + ob.length).join(" ")) return true;
    }
  }
  return false;
}

/**
 * Caption compatibility for reporter-pin matches.
 * Blocks substring traps like Home ⊂ "... at Home" and one-token
 * defendant absorption ("Morgan" ⊂ "Morgan Hill Unified").
 */
export function namesCompatible(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const [la, ra] = partyTokens(a);
  const [lb, rb] = partyTokens(b);

  if (ra.size && rb.size) {
    const oaL = orderedSide(a, "left", LEFT_NOISE);
    const obL = orderedSide(b, "left", LEFT_NOISE);
    const leadA = oaL[0];
    const leadB = obL[0];
    const seqOk = leftSeqOk(a, b);
    if (leadA && leadB && leadA !== leadB && !seqOk) return false;
    const leftOk = seqOk || [...la].some((t) => lb.has(t)) || !la.size || !lb.size;
    if (!leftOk) return false;

    const oa = orderedSide(a, "right", NOISE);
    const ob = orderedSide(b, "right", NOISE);
    if (oa.length && ob.length) {
      if (oa.join(" ") === ob.join(" ")) return true;
      // Multi-token prefixes are safe ("Dry Creek" ⊂ "Dry Creek Joint …").
      // A one-token prefix is only safe for org-type words that pleadings wrap
      // ("County" ⊂ "County of Santa Clara") — not surnames ("Morgan" ⊄ "Morgan Hill").
      const ORG = new Set([
        "county",
        "city",
        "state",
        "township",
        "parish",
        "borough",
        "district",
        "department",
        "board",
        "commission",
      ]);
      const prefixOk = (short: string[], long: string[]) => {
        if (!short.length || short.length > long.length) return false;
        if (short.join(" ") !== long.slice(0, short.length).join(" ")) return false;
        return short.length >= 2 || ORG.has(short[0]!);
      };
      if (prefixOk(oa, ob) || prefixOk(ob, oa)) return true;
      const overlap = [...ra].filter((t) => rb.has(t));
      return overlap.length >= 2;
    }
    return [...ra].some((t) => rb.has(t));
  }

  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set([...la, ...ra]);
  const tb = new Set([...lb, ...rb]);
  if (!ta.size || !tb.size) return false;
  const overlap = [...ta].filter((t) => tb.has(t));
  return overlap.length >= Math.min(2, ta.size, tb.size);
}
