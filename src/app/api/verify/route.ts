import { NextResponse } from "next/server";
import { verifyCitations } from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { citations?: string; text?: string };
    const raw = (body.citations ?? body.text ?? "").trim();
    if (!raw) {
      return NextResponse.json(
        { error: "Missing citations. Paste one citation per line." },
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
