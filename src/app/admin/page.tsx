import type { Metadata } from "next";
import AdminConsole from "@/components/admin/AdminConsole";
import {
  getStoreSettings,
  getStorefrontData,
  listNewsletterSubscribers,
  listOrders,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getStoreSettings();
    return {
      title: `Admin | ${settings.storeName}`,
      description:
        "Manage clothing catalog, 3D garments, hero slides, orders, and store settings.",
    };
  } catch {
    return {
      title: "Admin | Meridian",
      description:
        "Manage clothing catalog, 3D garments, hero slides, orders, and store settings.",
    };
  }
}

export default async function AdminPage() {
  const storefront = await getStorefrontData();
  const orders = await listOrders();
  const subscribers = await listNewsletterSubscribers();

  return (
    <AdminConsole
      initialProducts={storefront.products}
      initialHeroSlides={storefront.heroSlides}
      initialSettings={storefront.settings}
      initialOrders={orders}
      initialSubscribers={subscribers}
    />
  );
}
