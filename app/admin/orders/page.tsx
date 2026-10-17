import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { OrdersClient } from "./orders-client";

export const metadata = { title: "Orders · CreativeOS" };

export type OrderRow = {
  id: string;
  status: string;
  total_usd: number | null;
  customer_email: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  gelato_order_id: string | null;
  gelato_error: string | null;
  items: OrderItem[];
  shipping_address: ShippingAddress | null;
  created_at: string;
};

export type OrderItem = {
  title: string;
  size: string;
  price: number;
  slug?: string;
  assetId?: string;
};

export type ShippingAddress = {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postCode: string;
  state?: string;
  country: string;
  email: string;
};

// Data-fetching split into its own async component so cookies() + the
// Supabase query are inside a <Suspense> boundary — required by Next.js 16
// when cacheComponents is enabled (route segment `dynamic` is not allowed).
async function OrdersData() {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get("admin_token");
  if (!adminCookie?.value) redirect("/admin/login?next=/admin/orders");

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  const orders = (data ?? []) as OrderRow[];

  const counts = {
    total: orders.length,
    pending: orders.filter((o) => o.status === "pending_payment").length,
    paid: orders.filter((o) => o.status === "paid").length,
    placed: orders.filter((o) => o.status === "gelato_placed").length,
    error: orders.filter((o) =>
      ["gelato_error", "paid_variant_error", "paid_no_address"].includes(o.status),
    ).length,
    revenue: orders
      .filter((o) => o.status !== "pending_payment")
      .reduce((sum, o) => sum + (o.total_usd ?? 0), 0),
  };

  return <OrdersClient orders={orders} counts={counts} />;
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-400">Loading orders…</div>}>
      <OrdersData />
    </Suspense>
  );
}
