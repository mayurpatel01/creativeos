"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  badge?: string;
  group?: string;
};

const NAV: NavItem[] = [
  // Design pipeline
  { href: "/admin/master",  label: "Master Approval", icon: "⭐", group: "Design Pipeline" },
  { href: "/admin/review",  label: "Review Queue",    icon: "🎨", group: "Design Pipeline" },
  { href: "/admin/mockups", label: "Mockup Review",   icon: "👕", group: "Design Pipeline" },

  // Content & social
  { href: "/social",        label: "Social Captions", icon: "📱", group: "Content" },
  { href: "/content",       label: "Content Library", icon: "📄", group: "Content" },
  { href: "/reports",       label: "Priya's Reports", icon: "📊", group: "Content" },

  // Operations
  { href: "/admin/orders",  label: "Orders",          icon: "📦", group: "Operations" },
  { href: "/admin",         label: "Design Database", icon: "🗂",  group: "Operations" },
  { href: "/qa",            label: "QA",              icon: "✅", group: "Operations" },

  // Tools
  { href: "/agents",        label: "Agents",          icon: "🤖", group: "Tools" },
  { href: "/rani",          label: "Rani (Chat)",     icon: "💬", group: "Tools" },
];

const GROUPS = ["Design Pipeline", "Content", "Operations", "Tools"];

export function AdminNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex h-full flex-col overflow-y-auto bg-[#0d0d0d] py-4">
      {/* Logo */}
      <div className="mb-6 px-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#c9a84c]">HinduTee.com</p>
        <p className="text-[11px] text-neutral-600">CreativeOS Admin</p>
      </div>

      {GROUPS.map((group) => {
        const items = NAV.filter((n) => n.group === group);
        return (
          <div key={group} className="mb-4">
            <p className="mb-1 px-5 text-[9px] font-bold uppercase tracking-widest text-neutral-600">
              {group}
            </p>
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-5 py-2 text-sm transition ${
                  isActive(item.href)
                    ? "bg-[#c9a84c]/10 text-[#c9a84c] font-medium border-r-2 border-[#c9a84c]"
                    : "text-neutral-400 hover:bg-neutral-800/60 hover:text-white"
                }`}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && (
                  <span className="ml-auto rounded-full bg-[#c9a84c] px-1.5 py-0.5 text-[10px] font-bold text-black">
                    {item.badge}
                  </span>
                )}
              </Link>
            ))}
          </div>
        );
      })}

      {/* Store link */}
      <div className="mt-auto border-t border-neutral-800 px-5 pt-4">
        <a
          href="https://hindutee.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-neutral-600 hover:text-neutral-400"
        >
          <span>🛍</span>
          <span>Visit Store ↗</span>
        </a>
      </div>
    </nav>
  );
}
