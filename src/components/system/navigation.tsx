"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { isManager, type Role } from "@/lib/types";
import { Icon, type IconName } from "./icons";

function NavigationStatus({ active }: { active: boolean }) {
  const { pending } = useLinkStatus();
  return <span className="sys-nav-status">
    {pending ? <span role="status" aria-label="Loading page" className="sys-spinner"/> : active ? <span className="sys-nav-indicator"/> : null}
  </span>;
}

function NavigationLink({ href, label, icon, active }: { href: string; label: string; icon: IconName; active: boolean }) {
  const [prefetch, setPrefetch] = useState(false);
  const prepareNavigation = () => setPrefetch(true);

  return <Link
    href={href}
    prefetch={prefetch && !active}
    onMouseEnter={prepareNavigation}
    onFocus={prepareNavigation}
    onTouchStart={prepareNavigation}
    className={`sys-nav-link${active ? " sys-nav-link-active" : ""}`}
    aria-current={active ? "page" : undefined}
  ><Icon name={icon}/><span>{label}</span><NavigationStatus active={active}/></Link>;
}

export function SystemNavigation({ role }: { role: Role }) {
  const pathname = usePathname();
  const links: { href: string; label: string; icon: IconName }[] = [
    { href: "/dashboard", label: "Overview", icon: "dashboard" },
    { href: "/inventory", label: "Inventory", icon: "inventory" },
  ];
  links.push({ href: "/requisitions", label: "Requisitions", icon: "requests" });
  if (isManager(role)) links.push({ href: "/vip-queue", label: "VIP Queue", icon: "clock" });
  links.push({ href: "/student-logs", label: "Student stock-out log", icon: "requests" });
  if (role === "staff" || isManager(role)) links.push({ href: "/scan", label: "Barcode stock out", icon: "scan" });
  if (isManager(role)) links.push({ href: "/reports", label: "Reports", icon: "reports" });
  links.push({ href: "/account", label: "My account", icon: "lock" });
  if (role === "super_admin") links.push({ href: "/users", label: "User access", icon: "users" });

  return <nav className="sys-navigation" aria-label="Supplies management">{links.map(({ href, label, icon }) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return <NavigationLink key={href} href={href} label={label} icon={icon} active={active}/>;
  })}</nav>;
}
