import type { ReactNode } from "react";
import { AdminNav } from "../admin/_components/admin-nav";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#0a0a0a]">
      <aside className="hidden w-52 flex-shrink-0 border-r border-neutral-800 md:block lg:w-56">
        <div className="sticky top-0 h-screen">
          <AdminNav />
        </div>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
