import { cookies } from "next/headers";
import MarketplaceApp from "@/components/marketplace/MarketplaceApp";
import { getStorefrontData } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const sid = cookieStore.get("meridian_sid")?.value;
  const initialData = await getStorefrontData(sid);
  return <MarketplaceApp initialData={initialData} />;
}
