import { Clock, MessageSquare, Sliders, Cpu } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@renderer/components/ui/sidebar";
import markLight from "@renderer/assets/mark-light.svg";
import markDark from "@renderer/assets/mark-dark.svg";

const navItems = [
  { to: "/settings/general", label: "General", icon: Sliders },
  { to: "/settings/models", label: "Models", icon: Cpu },
  { to: "/settings/history", label: "History", icon: Clock },
  { to: "/settings/feedback", label: "Feedback", icon: MessageSquare },
];

export default function SettingsLayout(): React.JSX.Element {
  return (
    <SidebarProvider className="bg-background h-screen">
      <Sidebar collapsible="none" className="border-sidebar-border border-r">
        {/* Drag region for macOS traffic lights */}
        <div className="h-9 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
        <SidebarHeader className="flex flex-row items-center gap-2 px-4 py-2">
          <img src={markLight} alt="Freestyle" className="block dark:hidden h-5 w-5" />
          <img src={markDark} alt="Freestyle" className="hidden dark:block h-5 w-5" />
          <span className="serif text-base font-semibold tracking-tight">
            Settings
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Preferences</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.to}>
                        {({ isActive }) => (
                          <>
                            <item.icon
                              className={isActive ? "text-primary" : ""}
                            />
                            <span
                              className={isActive ? "font-medium" : ""}
                            >
                              {item.label}
                            </span>
                          </>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex-1 overflow-auto">
        {/* Drag region for the content area */}
        <div className="h-9 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
        <div className="px-6 pb-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
