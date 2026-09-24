import React, { useState } from 'react';
import { Menu as HamburgerIcon, ChevronDown, Bell, LogOut } from 'lucide-react';
import { cn, getAvatarColor, getInitials } from './utils';
import { useSidebar } from './sidebar-context';
import { ALPHALAKE_LOGO_WHITE } from './assets/alphalake-logo-white';

export interface TopBarUser {
  name?: string | null;
  email: string;
  imageUrl?: string | null;
  /** Shown in the dropdown's role chip, e.g. "Admin". */
  roleLabel: string;
  orgName?: string | null;
  orgLogoUrl?: string | null;
}

export interface TopBarMenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  /** Optional trailing badge, e.g. "v1.0.0" on a "What's New" item. */
  badge?: string;
}

export interface AppTopBarProps {
  /** Two-line app label next to the Alphalake logo — differs per app (e.g. ["Ops Cloud", "Workspace"]). */
  titleLines: [string, string];
  user: TopBarUser;
  /** Dropdown menu items, above the fixed Logout row. */
  menuItems: TopBarMenuItem[];
  onLogout: () => void;
  /** Omit to hide the notification bell entirely. */
  notifications?: { count: number; onClick: () => void };
}

// Fixed dashboard header (dark teal, the
// Alphalake wordmark, a two-line app label, and the user menu). The label
// text, menu items, and notification bell are all supplied by the consuming
// app; only the container styling and the Alphalake branding are fixed.
// Must be rendered under a SidebarProvider (drives the hamburger toggle).
export const AppTopBar: React.FC<AppTopBarProps> = ({ titleLines, user, menuItems, onLogout, notifications }) => {
  const { toggle } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const displayName = user.name || user.email;

  return (
    <header className="fixed top-0 inset-x-0 z-50 flex h-16 items-center justify-between gap-2 sm:gap-4 border-b border-sidebar-accent/40 bg-topbar pr-4 sm:pr-6 text-topbar-foreground shadow-[0_1px_0_rgba(0,0,0,0.18)]">
      {/* Left: logo + app label */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex w-10 sm:w-[50px] justify-center shrink-0">
          <button
            type="button"
            onClick={toggle}
            className="grid size-9 place-items-center bg-transparent hover:bg-transparent text-topbar-foreground transition shrink-0"
            aria-label="Toggle sidebar"
          >
            <HamburgerIcon className="size-5" />
          </button>
        </div>

        <img src={ALPHALAKE_LOGO_WHITE} alt="Alphalake Ai" className="h-8 sm:h-9 w-auto max-w-[7rem] sm:max-w-[10rem] shrink-0" />

        <span className="hidden sm:block h-5 w-px bg-topbar-foreground/20" />
        <div className="hidden sm:flex flex-col leading-tight">
          <span className="text-xs font-semibold text-topbar-foreground tracking-wide">{titleLines[0]}</span>
          <span className="text-[11px] font-normal text-topbar-foreground/65 mt-0.5">{titleLines[1]}</span>
        </div>
      </div>

      {/* Right: notifications + user menu + org logo */}
      <div className="flex items-center gap-2 sm:gap-4">
        {notifications && (
          <button
            type="button"
            onClick={notifications.onClick}
            className="relative grid size-9 place-items-center rounded-full border border-white/10 bg-white/5 text-white/85 transition hover:bg-white/10 cursor-pointer"
            aria-label="Notifications"
          >
            <Bell className="size-5" />
            {notifications.count > 0 && (
              <span className="absolute top-[-4px] right-[-4px] flex min-w-4 h-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white px-1">
                {notifications.count}
              </span>
            )}
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 h-9 rounded-full border border-white/15 bg-white/5 py-1 pl-2 pr-[10px] text-left text-topbar-foreground/90 transition hover:bg-white/10"
            aria-label="User menu"
          >
            <span className={cn('relative grid size-7 place-items-center rounded-full text-white text-xs font-bold shrink-0', user.imageUrl ? 'bg-muted' : getAvatarColor(user.email))}>
              {user.imageUrl ? (
                <img src={user.imageUrl} alt={displayName} className="size-7 rounded-full object-cover" />
              ) : (
                <span className="text-[11px]">{getInitials(user.name, user.email)}</span>
              )}
              <span className="absolute bottom-0 right-0 z-10 size-2.5 rounded-full border-2 border-topbar bg-emerald-500" />
            </span>
            <ChevronDown className="size-3.5 text-topbar-foreground/70" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-[290px] rounded-[16px] border border-border bg-popover py-1 shadow-xl text-popover-foreground">
                <div className="px-5 py-4 border-b border-border">
                  <p className="text-[16px] font-bold text-foreground truncate">{displayName}</p>
                  <p className="text-[13px] text-muted-foreground truncate mt-0.5">{user.email}</p>
                  <div className="flex flex-col gap-1.5 mt-3">
                    <div className="rounded-[8px] border border-[#a5f3fc] bg-[#ecfeff]/60 px-3 py-1 text-[10px] font-bold text-[#0e7490] tracking-wide w-fit leading-none">
                      {user.roleLabel}
                      {user.orgName && <span className="font-normal text-[#0891b2]/80 normal-case ml-1">({user.orgName})</span>}
                    </div>
                  </div>
                </div>

                <div className="py-1">
                  {menuItems.map(item => (
                    <a
                      key={item.key}
                      href={item.href ?? '#'}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noreferrer' : undefined}
                      onClick={e => {
                        setMenuOpen(false);
                        if (!item.href) e.preventDefault();
                        item.onClick?.();
                      }}
                      className={cn(
                        'flex w-full items-center px-5 py-2.5 text-left text-[14.5px] font-medium text-foreground hover:bg-accent transition-colors cursor-pointer',
                        item.badge ? 'justify-between' : 'gap-3'
                      )}
                    >
                      {item.badge ? (
                        <>
                          <span className="flex items-center gap-3">
                            <item.icon className="size-[18px] text-muted-foreground" />
                            <span>{item.label}</span>
                          </span>
                          <span className="rounded-full bg-[#fff1f2] border border-[#ffe4e6] px-2 py-0.5 text-[10px] font-bold text-[#e11d48] leading-none">{item.badge}</span>
                        </>
                      ) : (
                        <>
                          <item.icon className="size-[18px] text-muted-foreground" />
                          <span>{item.label}</span>
                        </>
                      )}
                    </a>
                  ))}
                </div>

                <div className="border-t border-border py-1">
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); onLogout(); }}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-[14.5px] font-bold text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  >
                    <LogOut className="size-[18px] text-destructive" />
                    Log Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {user.orgLogoUrl && (
          <>
            <span className="hidden sm:block h-5 w-px bg-white/20" />
            <img
              src={user.orgLogoUrl}
              alt={user.orgName || 'Organisation'}
              className="h-7 max-w-[56px] sm:h-10 sm:max-w-[192px] w-auto object-contain rounded-lg bg-white p-1"
            />
          </>
        )}
      </div>
    </header>
  );
};
