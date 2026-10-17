"use client";

import { useState } from "react";
import Link from "next/link";
import type { OrderRow, ShippingAddress } from "./page";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending_payment:   { label: "Awaiting Payment", color: "#888" },
  paid:              { label: "Paid",              color: "#c9a84c" },
  paid_no_address:   { label: "No Address",        color: "#e07b39" },
  paid_variant_error:{ label: "Variant Error",     color: "#e07b39" },
  gelato_placed:     { label: "Fulfilling",        color: "#4caf84" },
  gelato_error:      { label: "Gelato Error",      color: "#e05555" },
};

function statusBadge(status: string) {
  const s = STATUS_LABEL[status] ?? { label: status, color: "#888" };
  return (
    <span
      style={{
        background: s.color + "22",
        color: s.color,
        border: `1px solid ${s.color}55`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

function formatAddress(addr: ShippingAddress) {
  const parts = [
    `${addr.firstName} ${addr.lastName}`.trim(),
    addr.addressLine1,
    addr.addressLine2,
    `${addr.city}${addr.state ? `, ${addr.state}` : ""} ${addr.postCode}`.trim(),
    addr.country,
  ].filter(Boolean);
  return parts.join(" · ");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function OrdersClient({
  orders,
  counts,
}: {
  orders: OrderRow[];
  counts: {
    total: number;
    pending: number;
    paid: number;
    placed: number;
    error: number;
    revenue: number;
  };
}) {
  const [filter, setFilter] = useState<"all" | "error" | "gelato_placed" | "paid">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = orders.filter(o => {
    if (filter === "all") return true;
    if (filter === "error") return ["gelato_error", "paid_variant_error", "paid_no_address"].includes(o.status);
    return o.status === filter;
  });

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e8e0d0", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <Link href="/admin" style={{ color: "#c9a84c", fontSize: 13, textDecoration: "none" }}>
            ← Admin
          </Link>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 24px", color: "#fff" }}>
          Orders
        </h1>

        {/* Stat tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Total Orders", value: counts.total },
            { label: "Revenue", value: `$${counts.revenue.toFixed(2)}` },
            { label: "Fulfilling", value: counts.placed },
            { label: "Needs Attention", value: counts.error },
            { label: "Awaiting Payment", value: counts.pending },
          ].map(t => (
            <div key={t.label} style={{ background: "#111", border: "1px solid #222", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, color: "#666", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{t.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#e8e0d0" }}>{t.value}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {(["all", "gelato_placed", "paid", "error"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 14px", borderRadius: 6, fontSize: 13,
                cursor: "pointer", fontWeight: filter === f ? 600 : 400,
                background: filter === f ? "#c9a84c22" : "transparent",
                border: filter === f ? "1px solid #c9a84c88" : "1px solid #333",
                color: filter === f ? "#c9a84c" : "#888",
              }}
            >
              {f === "all" ? "All" : f === "gelato_placed" ? "Fulfilling" : f === "paid" ? "Paid" : "Errors"}
            </button>
          ))}
        </div>

        {/* Orders table */}
        {visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#555" }}>
            No orders yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visible.map(order => {
              const isOpen = expanded === order.id;
              return (
                <div
                  key={order.id}
                  style={{ background: "#111", border: "1px solid #222", borderRadius: 10, overflow: "hidden" }}
                >
                  {/* Row */}
                  <button
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 120px 110px 160px 80px",
                      gap: 12,
                      alignItems: "center",
                      width: "100%",
                      padding: "14px 18px",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#e8e0d0",
                      textAlign: "left",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                        {order.customer_email ?? "—"}
                      </div>
                      <div style={{ fontSize: 11, color: "#555" }}>
                        {order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? "s" : ""}
                        {" · "}
                        {formatDate(order.created_at)}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#c9a84c" }}>
                      ${(order.total_usd ?? 0).toFixed(2)}
                    </div>
                    <div>{statusBadge(order.status)}</div>
                    <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {order.gelato_order_id ? `Gelato: ${order.gelato_order_id}` : order.stripe_session_id ? `Stripe: ${order.stripe_session_id.slice(-12)}` : "—"}
                    </div>
                    <div style={{ fontSize: 18, color: "#444", textAlign: "right" }}>
                      {isOpen ? "▲" : "▼"}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div style={{ borderTop: "1px solid #1e1e1e", padding: "16px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

                      {/* Items */}
                      <div>
                        <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Items</div>
                        {(order.items ?? []).map((item, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a1a1a", fontSize: 13 }}>
                            <div>
                              <span style={{ color: "#e8e0d0" }}>{item.title}</span>
                              <span style={{ color: "#666", marginLeft: 8 }}>Size {item.size}</span>
                            </div>
                            <div style={{ color: "#c9a84c" }}>${item.price.toFixed(2)}</div>
                          </div>
                        ))}
                      </div>

                      {/* Shipping + IDs */}
                      <div>
                        <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Shipping</div>
                        <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.7, marginBottom: 16 }}>
                          {order.shipping_address ? formatAddress(order.shipping_address) : "—"}
                        </div>

                        <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>IDs</div>
                        <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", display: "flex", flexDirection: "column", gap: 4 }}>
                          <div>Order: {order.id}</div>
                          {order.stripe_payment_intent_id && <div>Payment: {order.stripe_payment_intent_id}</div>}
                          {order.gelato_order_id && <div>Gelato: {order.gelato_order_id}</div>}
                        </div>

                        {order.gelato_error && (
                          <div style={{ marginTop: 12, background: "#e0555522", border: "1px solid #e0555544", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#e05555" }}>
                            <strong>Error:</strong> {order.gelato_error}
                          </div>
                        )}

                        {/* Links */}
                        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                          {order.stripe_session_id && (
                            <a
                              href={`https://dashboard.stripe.com/payments/${order.stripe_payment_intent_id ?? order.stripe_session_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: 12, color: "#c9a84c", textDecoration: "none", border: "1px solid #c9a84c44", borderRadius: 5, padding: "4px 10px" }}
                            >
                              Stripe ↗
                            </a>
                          )}
                          {order.gelato_order_id && (
                            <a
                              href={`https://dashboard.gelato.com/orders`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontSize: 12, color: "#c9a84c", textDecoration: "none", border: "1px solid #c9a84c44", borderRadius: 5, padding: "4px 10px" }}
                            >
                              Gelato ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
