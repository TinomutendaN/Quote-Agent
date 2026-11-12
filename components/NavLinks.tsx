"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/agent", label: "Agent run", icon: "agent" },
  { href: "/review", label: "Review queue", icon: "review" },
  { href: "/pricing", label: "Price lists", icon: "price" },
  { href: "/ask", label: "Ask", icon: "ask" },
];

export function NavLinks({ reviewBadge }: { reviewBadge: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] text-ink no-underline hover:text-ink ${
              active ? "bg-nav-active font-semibold" : "font-normal hover:bg-nav-active/60"
            }`}
          >
            <Icon name={item.icon} />
            <span className="flex-1">{item.label}</span>
            {item.href === "/review" && reviewBadge}
          </Link>
        );
      })}
    </>
  );
}
