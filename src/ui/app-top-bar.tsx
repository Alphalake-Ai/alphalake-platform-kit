import React, { useState } from 'react';
import { Menu as HamburgerIcon, ChevronDown, Bell, LogOut, Moon, Sun } from 'lucide-react';
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

export interface TopBarOrgAction {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  /** Filled button (e.g. "View Workspaces"); the rest are outlined. */
  primary?: boolean;
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
  /** Omit to hide the light/dark toggle. The app owns the theme state and applies it. */
  theme?: { dark: boolean; onToggle: () => void };
  /**
   * Card shown when the org logo is hovered (or tapped): the org name, this
   * subtitle (usually the workspace name), then the actions. Omit for a plain
   * logo. With it set, an org with no logo gets its name in the logo's place.
   */
  orgMenu?: { subtitle: string; actions: TopBarOrgAction[] };
}

// Fixed dashboard header (dark teal, the
// Alphalake wordmark, a two-line app label, and the user menu). The label
// text, menu items, and notification bell are all supplied by the consuming
// app; only the container styling and the Alphalake branding are fixed.
// Must be rendered under a SidebarProvider (drives the hamburger toggle).
export const AppTopBar: React.FC<AppTopBarProps> = ({ titleLines, user, menuItems, onLogout, notifications, theme, orgMenu }) => {
  const { toggle } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  // Hover opens the org card on desktop; a click pins it open, for touch.
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);
  const showOrgBadge = Boolean(user.orgLogoUrl || (orgMenu && user.orgName));
  const displayName = user.name || user.email;

  return (
    <header className="fixed top-0 inset-x-0 z-50 flex h-16 items-center justify-between gap-2 sm:gap-4 border-b border-topbar-foreground/10 bg-topbar pr-4 sm:pr-6 text-topbar-foreground shadow-[0_1px_0_rgba(0,0,0,0.18)]">
      {/* Left: logo + app label */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex w-10 sm:w-12 justify-center shrink-0">
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

      {/* Right: theme toggle + notifications + user menu + org logo */}
      <div className="flex items-center gap-2 sm:gap-4">
        {theme && (
          <button
            type="button"
            onClick={theme.onToggle}
            className="grid size-9 place-items-center rounded-xl border border-topbar-foreground/10 bg-topbar-foreground/5 text-topbar-foreground/85 transition hover:bg-topbar-foreground/10 cursor-pointer"
            aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme.dark ? 'Light mode' : 'Dark mode'}
          >
            {theme.dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        )}

        {notifications && (
          <button
            type="button"
            onClick={notifications.onClick}
            className="relative grid size-9 place-items-center rounded-xl border border-topbar-foreground/10 bg-topbar-foreground/5 text-topbar-foreground/85 transition hover:bg-topbar-foreground/10 cursor-pointer"
            aria-label="Notifications"
          >
            <Bell className="size-5" />
            {notifications.count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {notifications.count > 99 ? '99+' : notifications.count}
              </span>
            )}
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 h-9 rounded-full border border-topbar-foreground/15 bg-topbar-foreground/5 py-1 pl-2 pr-2.5 text-left text-topbar-foreground/90 transition hover:bg-topbar-foreground/10"
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
              <div className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-[14px] border border-border bg-popover py-1 shadow-lg text-popover-foreground">
                <div className="px-5 py-4 border-b border-border">
                  <p className="text-[15px] font-bold text-foreground truncate">{displayName}</p>
                  <p className="text-[12.5px] text-muted-foreground truncate mt-0.5">{user.email}</p>
                  {user.orgName && <p className="text-[12px] font-semibold text-muted-foreground truncate mt-1">{user.orgName}</p>}
                  <div className="flex flex-col gap-1.5 mt-3 items-start">
                    <div className="rounded-full border border-teal-300 bg-teal-50/90 px-2.5 py-1 text-[10px] font-semibold text-teal-900 leading-none">
                      {user.roleLabel}
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
                        'flex w-full items-center px-5 py-2.5 text-left text-sm font-medium text-foreground hover:bg-muted transition-colors cursor-pointer',
                        item.badge ? 'justify-between' : 'gap-3'
                      )}
                    >
                      {item.badge ? (
                        <>
                          <span className="flex items-center gap-3">
                            <item.icon className="size-4 text-muted-foreground" />
                            <span>{item.label}</span>
                          </span>
                          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-500">{item.badge}</span>
                        </>
                      ) : (
                        <>
                          <item.icon className="size-4 text-muted-foreground" />
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
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm font-bold text-destructive hover:bg-destructive/5 transition-colors cursor-pointer"
                  >
                    <LogOut className="size-4 text-destructive" />
                    Log Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {showOrgBadge && (
          <>
            <span className="hidden sm:block h-5 w-px bg-topbar-foreground/20" />
            <div
              className={cn('group relative shrink-0', orgMenu && 'cursor-pointer')}
              onClick={orgMenu ? () => setOrgMenuOpen(v => !v) : undefined}
            >
              <div className="flex h-9 sm:h-12 items-center justify-center rounded-lg border border-white/5 bg-white px-1.5 sm:px-2.5 py-1 shadow-sm">
                {user.orgLogoUrl ? (
                  <img
                    src={user.orgLogoUrl}
                    alt={user.orgName || 'Organisation'}
                    className={cn('h-6 max-w-[56px] sm:h-9 sm:max-w-[10rem] w-auto object-contain', orgMenu && 'transition-opacity group-hover:opacity-90')}
                  />
                ) : (
                  <span className="max-w-[7rem] sm:max-w-[10rem] truncate px-1 text-xs font-bold text-gray-800">{user.orgName}</span>
                )}
              </div>

              {orgMenu && (
                <>
                  {orgMenuOpen && (
                    <div className="fixed inset-0 z-40" onClick={e => { e.stopPropagation(); setOrgMenuOpen(false); }} />
                  )}
                  {/* pt-2 rather than mt-2, so the pointer can cross the gap without the hover dropping */}
                  <div
                    onClick={e => e.stopPropagation()}
                    className={cn('absolute right-0 top-full z-50 pt-2', orgMenuOpen ? 'block' : 'hidden group-hover:block')}
                  >
                    <div className="w-[240px] rounded-2xl border border-gray-100 bg-white p-5 text-left shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                      {user.orgName && <div className="truncate text-xs font-extrabold text-gray-700">{user.orgName}</div>}
                      <div className="mt-1 truncate text-xs font-extrabold text-gray-700/50">{orgMenu.subtitle}</div>
                      {orgMenu.actions.length > 0 && (
                        <div className="mt-4 flex flex-col gap-2">
                          {orgMenu.actions.map(action => (
                            <a
                              key={action.key}
                              href={action.href ?? '#'}
                              target={action.external ? '_blank' : undefined}
                              rel={action.external ? 'noreferrer' : undefined}
                              onClick={e => {
                                setOrgMenuOpen(false);
                                if (!action.href) e.preventDefault();
                                action.onClick?.();
                              }}
                              className={cn(
                                'flex w-full items-center justify-start gap-3 rounded-xl px-5 py-2.5 text-xs font-bold shadow-sm transition cursor-pointer',
                                action.primary
                                  ? 'bg-topbar text-topbar-foreground hover:bg-topbar/90 hover:shadow-md'
                                  : 'border border-topbar/20 bg-white text-topbar hover:border-topbar hover:bg-topbar/5'
                              )}
                            >
                              <action.icon className="size-3.5" />
                              {action.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
};
