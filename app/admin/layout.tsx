import type { ReactNode } from "react";
import { AdminNav } from "./_components/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      {/* Sidebar — hidden on mobile, visible md+ */}
      <aside className="hidden w-52 flex-shrink-0 border-r border-neutral-800 md:block lg:w-56">
        <div className="sticky top-0 h-screen">
          <AdminNav />
        </div>
      </aside>

      {/* Mobile top bar */}
      <MobileNavBar />

      {/* Page content */}
      <div className="min-w-0 flex-1">
        {children}
      </div>
    </div>
  );
}

// Minimal mobile header with a dropdown nav — no JS required for the links themselves.
// We keep it simple: a scrollable horizontal pill row for mobile.
function MobileNavBar() {
  return (
    <div className="fixed inset-x-0 top-0 z-40 border-b border-neutral-800 bg-[#0d0d0d]/95 backdrop-blur md:hidden">
      <div className="flex items-center gap-3 overflow-x-auto px-4 py-2 scrollbar-hide">
        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-widest text-[#c9a84c]">
          CreativeOS
        </span>
        {[
          { href: "/admin/master",  label: "⭐ Master" },
          { href: "/admin/review",  label: "🎨 Review" },
          { href: "/admin/mockups", label: "👕 Mockups" },
          { href: "/social",        label: "📱 Social" },
          { href: "/admin/orders",  label: "📦 Orders" },
          { href: "/admin",         label: "🗂 Database" },
          { href: "/agents",        label: "🤖 Agents" },
          { href: "/rani",          label: "💬 Rani" },
          { href: "/content",       label: "📄 Content" },
          { href: "/qa",            label: "✅ QA" },
          { href: "/reports",       label: "📊 Reports" },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className="flex-shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-white"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
