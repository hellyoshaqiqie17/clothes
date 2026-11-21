import { cookies } from "next/headers";
import MarketplaceApp from "@/components/marketplace/MarketplaceApp";
import { getStorefrontData } from "@/lib/db";
import { MEMBER_SESSION_COOKIE } from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const sid = cookieStore.get("meridian_sid")?.value;
  const memberToken = cookieStore.get(MEMBER_SESSION_COOKIE)?.value;
  const initialData = await getStorefrontData(sid, memberToken);
  return <MarketplaceApp initialData={initialData} />;
}
