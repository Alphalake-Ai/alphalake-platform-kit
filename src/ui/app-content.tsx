import React from 'react';
import { cn } from './utils';
import { useSidebar, contentOffsetClass } from './sidebar-context';

export interface AppContentProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

// Main content area beside AppTopBar/AppSidebar: clears the fixed 64px top
// bar and offsets by the sidebar's current width (none on mobile, where the
// sidebar is an overlay drawer). Must be rendered under a SidebarProvider.
export const AppContent: React.FC<AppContentProps> = ({ children, className, ...props }) => {
  const { open } = useSidebar();
  return (
    <main
      className={cn(
        'min-h-svh min-w-0 pt-16 transition-[margin] duration-300 ease-in-out',
        open ? contentOffsetClass.open : contentOffsetClass.collapsed,
        className
      )}
      {...props}
    >
      {children}
    </main>
  );
};
