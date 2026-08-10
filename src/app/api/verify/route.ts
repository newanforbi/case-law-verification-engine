import { NextResponse } from "next/server";
import {
  verifyCitationItems,
  verifyCitations,
  type VerifyRequestItem,
} from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      citations?: string;
      text?: string;
      items?: VerifyRequestItem[];
    };

    if (Array.isArray(body.items) && body.items.length) {
      const items = body.items
        .map((item) => ({
          citation: String(item?.citation ?? "").trim(),
          passages: Array.isArray(item?.passages)
            ? item.passages.map((p) => String(p)).filter(Boolean).slice(0, 5)
            : [],
        }))
        .filter((item) => item.citation);
      const result = await verifyCitationItems(items);
      return NextResponse.json(result);
    }

    const raw = (body.citations ?? body.text ?? "").trim();
    if (!raw) {
      return NextResponse.json(
        { error: "Missing citations. Paste one citation per line, or send items[]." },
        { status: 400 },
      );
    }
    const result = await verifyCitations(raw);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    const status = message.includes("at most") || message.includes("at least") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
