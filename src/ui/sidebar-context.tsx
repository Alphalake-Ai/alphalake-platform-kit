import React, { createContext, useContext, useEffect, useState } from 'react';

export interface SidebarContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  open: true,
  toggle: () => {},
  close: () => {},
});

export interface SidebarProviderProps {
  children: React.ReactNode;
  /** localStorage key the collapse state persists under. Default 'sidebarOpen'. */
  storageKey?: string;
  defaultOpen?: boolean;
}

// Shared collapse state for AppTopBar's hamburger toggle and AppSidebar's
// panel — both read this via useSidebar() rather than passing the state
// through props.
export const SidebarProvider: React.FC<SidebarProviderProps> = ({ children, storageKey = 'sidebarOpen', defaultOpen = true }) => {
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? defaultOpen : stored === 'true';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(storageKey, String(open));
  }, [open, storageKey]);
  const toggle = () => setOpen(v => !v);
  const close = () => setOpen(false);
  return (
    <SidebarContext.Provider value={{ open, toggle, close }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const useSidebar = () => useContext(SidebarContext);
