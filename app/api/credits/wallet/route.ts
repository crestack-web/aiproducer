import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getCreditWallet, listCreditLedger } from "@/lib/credits/wallet";
import {
  CREDIT_PACKAGES,
  SONG_PATH_CREDITS,
  SESSION_DOWNLOAD_CREDITS,
  SESSION_DOWNLOAD_USD,
} from "@/lib/credits/catalog";

/** GET /api/credits/wallet — balance + recent ledger + catalog */
export async function GET() {
  const { user, error } = await requireUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const wallet = await getCreditWallet(user.id);
  const ledger = await listCreditLedger(user.id, 40);
  return NextResponse.json({
    wallet,
    ledger,
    catalog: {
      songPathCredits: SONG_PATH_CREDITS,
      sessionDownloadCredits: SESSION_DOWNLOAD_CREDITS,
      sessionDownloadUsd: SESSION_DOWNLOAD_USD,
      packages: CREDIT_PACKAGES,
    },
  });
}
