import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { roleLabels, type Profile } from "@/lib/types";
import universityLogo from "../../../pic/Panpacific-University.png";
import { Icon } from "./icons";
import { SystemNavigation } from "./navigation";

export function UniversityBrand() {
  return <Link className="sys-brand" href="/" aria-label="Panpacific University home"><span className="sys-logo"><Image src={universityLogo} alt="Panpacific University" sizes="350px"/></span></Link>;
}

export function PublicHeader({ profile }: { profile?: Profile | null }) {
  return <header className="sys-public-header"><UniversityBrand/><nav aria-label="Portal navigation"><Link href="/">Home</Link><Link href="/dashboard" className="sys-button sys-button-small">{profile ? "My dashboard" : "Sign in"}<Icon name="arrow" size={16}/></Link></nav></header>;
}

export function SystemShell({ profile, children, action }: { profile: Profile; children: ReactNode; action: () => Promise<void> }) {
  const initials = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((name) => name[0]).join("").toUpperCase() || "PU";
  return <div className="system-shell">
    <a href="#system-main" className="sys-skip-link">Skip to content</a>
    <aside className="sys-sidebar">
      <UniversityBrand/>
      <div className="sys-sidebar-label">SUPPLIES OFFICE</div>
      <SystemNavigation role={profile.role}/>
      <div className="sys-sidebar-bottom"><div className="sys-sidebar-note"><Icon name="inventory" size={26}/><p>Everything you need.<br/><strong>One connected system.</strong></p></div><Link href="/" className="sys-home-link">University home <Icon name="arrow" size={16}/></Link></div>
    </aside>
    <div className="sys-workspace">
      <header className="sys-topbar"><div className="sys-topbar-title">SupplyHub <span>Panpacific University</span></div><div className="sys-profile"><span className="sys-avatar" aria-hidden="true">{initials}</span><div className="sys-profile-copy"><strong>{profile.full_name || profile.email}</strong><span>{roleLabels[profile.role]}</span></div><form action={action}><button type="submit" className="sys-signout" aria-label="Sign out" title="Sign out"><Icon name="signout"/></button></form></div></header>
      <main id="system-main" className="sys-main" tabIndex={-1}>{children}</main>
      <footer className="sys-footer">Panpacific University <span>SupplyHub</span></footer>
    </div>
  </div>;
}
