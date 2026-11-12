import { currentMember } from "../../../../lib/auth/current-member";
import { partnerFixtureDetail, partnerLocalPreview } from "../../../../lib/partner/fixtures";
import { isPartnerCo } from "../../../../lib/partner/model";
import { loadPartnerDetail } from "../../../../lib/partner/server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const number = params.get("co") ?? "";
  const co = Number(number);
  if (!/^[1-9]\d{0,4}$/.test(number) || !isPartnerCo(co))
    return Response.json({ detail: null }, { status: 400, headers });

  const member = await currentMember();
  if (member.status === "preview") {
    const preview = partnerLocalPreview();
    return Response.json(
      { detail: preview ? partnerFixtureDetail(co, preview.today) : null },
      { headers },
    );
  }
  if (member.status !== "member" || params.get("utente") !== member.member.userId)
    return Response.json({ detail: null }, { status: 403, headers });
  try {
    return Response.json(
      { detail: await loadPartnerDetail(member.supabase, co, { latestReply: true }) },
      { headers },
    );
  } catch {
    return Response.json({ detail: null }, { status: 503, headers });
  }
}
