import type { Metadata } from "next";
import AdminConsole from "@/components/admin/AdminConsole";
import AdminLoginGate from "@/components/admin/AdminLoginGate";
import {
  getStoreSettings,
  getStorefrontData,
  listNewsletterSubscribers,
  listOrders,
  listVouchers,
} from "@/lib/db";
import { getAuthenticatedMemberContext } from "@/lib/memberAuth";

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
  const ctx = await getAuthenticatedMemberContext();

  if (!ctx || ctx.member.role !== "admin") {
    let storeName = "Meridian";
    try {
      const settings = await getStoreSettings();
      storeName = settings.storeName || "Meridian";
    } catch {
      // keep fallback store name
    }
    return (
      <AdminLoginGate
        storeName={storeName}
        currentMember={ctx?.member ?? null}
      />
    );
  }

  const [storefront, orders, subscribers, vouchers] = await Promise.all([
    getStorefrontData(),
    listOrders(),
    listNewsletterSubscribers(),
    listVouchers(),
  ]);

  return (
    <AdminConsole
      adminMember={ctx.member}
      initialProducts={storefront.products}
      initialHeroSlides={storefront.heroSlides}
      initialSettings={storefront.settings}
      initialOrders={orders}
      initialSubscribers={subscribers}
      initialVouchers={vouchers}
    />
  );
}
