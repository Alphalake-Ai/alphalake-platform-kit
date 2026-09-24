import React from 'react';
import { X, Menu as MenuIcon } from 'lucide-react';
import { cn } from './utils';
import { useSidebar } from './sidebar-context';

export interface SidebarNavItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
  onClick: () => void;
}

export interface SidebarSection {
  /** Omit for an untitled section (e.g. a single top-level group). */
  title?: string;
  items: SidebarNavItem[];
}

export interface AppSidebarProps {
  sections: SidebarSection[];
}

// Collapsible dashboard sidebar (dark teal
// chrome, 225px/48px collapse widths, hover tooltips when collapsed). Nav
// items/sections/routing are entirely supplied by the consuming app — this
// component has no opinion on what a "page" is, only how the panel looks and
// collapses. Must be rendered under a SidebarProvider.
export const AppSidebar: React.FC<AppSidebarProps> = ({ sections }) => {
  const { open, toggle, close } = useSidebar();

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={close} />
      )}

      <aside
        className={cn(
          'fixed top-[63px] bottom-0 left-0 z-40 flex flex-col bg-sidebar border-r border-sidebar-border shadow-2xl transition-all duration-300 ease-in-out',
          open ? 'w-[225px] translate-x-0' : 'w-[48px] -translate-x-full md:translate-x-0'
        )}
        aria-label="App navigation"
      >
        {/* Header — only on mobile. Branding lives on the top bar (AppTopBar)
            only; this is just the collapse/expand toggle. */}
        <div className={cn(
          'flex items-center border-b border-sidebar-border h-16 shrink-0 transition-all duration-300 md:hidden',
          open ? 'justify-end px-5' : 'justify-center px-0'
        )}>
          {open ? (
            <button
              type="button"
              onClick={toggle}
              className="grid size-7 place-items-center rounded-full text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10 transition-colors"
              aria-label="Collapse sidebar"
            >
              <X className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={toggle}
              className="grid size-9 place-items-center rounded-full text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/10 transition-colors"
              aria-label="Expand sidebar"
            >
              <MenuIcon className="size-5" />
            </button>
          )}
        </div>

        <nav className={cn('flex-1 overflow-y-auto transition-all duration-300', open ? 'space-y-4 px-2 pt-5 pb-4' : 'space-y-2 px-0 pt-3 pb-4')}>
          {sections.map((section, idx) => (
            <div key={section.title ?? idx} className={open ? 'px-1 py-1' : 'px-0 py-0'}>
              {open ? (
                section.title && (
                  <p className="px-3 mb-2 text-[11px] font-semibold tracking-[0.08em] text-sidebar-foreground/50">{section.title}</p>
                )
              ) : (
                idx > 0 && <div className="w-6 h-px bg-white/10 my-1 mx-auto" />
              )}
              <ul className="space-y-0.5">
                {section.items.map(item => (
                  <li key={item.key} className="relative group">
                    <button
                      type="button"
                      onClick={item.onClick}
                      className={cn(
                        'flex items-center rounded-[10px] text-sm font-medium transition-colors text-left transition-all duration-300 p-0',
                        open ? 'w-full gap-2 px-3 h-11' : 'justify-center h-8 w-8 mx-auto',
                        item.isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/20 hover:text-sidebar-foreground'
                      )}
                    >
                      <item.icon className={cn('shrink-0 transition-all duration-300', open ? 'size-[14px]' : 'size-[16px]')} />
                      {open && <span className="truncate">{item.label}</span>}
                    </button>
                    {!open && (
                      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1.5 bg-[#0F1E1F] border border-sidebar-border text-white text-xs font-medium rounded-md opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 shadow-md whitespace-nowrap z-50">
                        {item.label}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
};
