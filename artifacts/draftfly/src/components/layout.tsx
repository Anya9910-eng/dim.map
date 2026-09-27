import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { TrialBanner } from "@/components/trial-banner";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Megaphone, Inbox, UserCircle, ClipboardCheck, Wrench, FlaskConical, History, Settings, Sun, Moon, LogOut, LifeBuoy } from "lucide-react";
import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useLang } from "@/hooks/use-lang";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api-base";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();
  const { tr } = useLang();
  const { isOperator, user } = useAuth();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = React.useState(false);

  // The session cookie is httpOnly, so only the server can end the session —
  // and the cached queries have to go with it, or the next person to sign in
  // on this browser sees the previous one's drafts before the refetch lands.
  // A full page load is the blunt, reliable way to drop every bit of state.
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // Network failure still means signing out locally is the right move;
      // an abandoned session is far better than a stuck one.
    }
    queryClient.clear();
    window.location.href = import.meta.env.BASE_URL;
  };

  // A client user gets their own drafts, history and configuration. The client
  // roster and every operator tool are left out — those routes reject them
  // server-side anyway, so showing the links would only offer dead ends.
  const mainNav = [
    { name: tr.overview, href: "/", icon: LayoutDashboard },
    ...(isOperator ? [{ name: tr.clients, href: "/clients", icon: Users }] : []),
    { name: tr.personas, href: "/personas", icon: UserCircle },
    { name: tr.campaigns, href: "/campaigns", icon: Megaphone },
    { name: tr.draftReplies, href: "/drafts", icon: Inbox },
    { name: tr.replyHistory, href: "/reply-history", icon: History },
    ...(isOperator ? [] : [{ name: tr.settings, href: "/settings", icon: Settings }]),
  ];

  const internalNav = isOperator
    ? [
        { name: tr.testFlow, href: "/test-flow", icon: FlaskConical },
        { name: tr.clientOnboarding, href: "/onboarding", icon: ClipboardCheck },
        { name: tr.internalSetup, href: "/internal-setup", icon: Wrench },
        { name: tr.settings, href: "/settings", icon: Settings },
      ]
    : [];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background font-sans text-foreground">
        {/* Always the brand's dark green, in either theme: `dark` scopes the
            dark palette to the sidebar alone. */}
        <Sidebar className="dark border-r border-border bg-sidebar text-sidebar-foreground">
          <SidebarHeader className="p-4 border-b border-border flex flex-row items-center gap-2">
            <img src="/logo-mark.svg" alt="" className="h-7 w-auto" />
            <span className="text-lg font-bold text-foreground tracking-tight">DIM <span className="text-primary">Convert</span></span>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {mainNav.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={location === item.href || (location.startsWith(item.href) && item.href !== "/")}
                        className="data-[active=true]:border-t data-[active=true]:border-primary/20 data-[active=true]:bg-accent data-[active=true]:text-primary transition-all"
                      >
                        <Link href={item.href} className="flex items-center gap-3" data-testid={`nav-${item.href.replace(/^\//, '') || 'overview'}`}>
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm font-medium">{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {internalNav.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs text-muted-foreground/50 uppercase tracking-widest px-2 pt-2">{tr.internal}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {internalNav.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={location === item.href || (location.startsWith(item.href) && item.href !== "/")}
                        className="data-[active=true]:border-t data-[active=true]:border-primary/20 data-[active=true]:bg-accent data-[active=true]:text-primary transition-all"
                      >
                        <Link href={item.href} className="flex items-center gap-3" data-testid={`nav-${item.href.replace(/^\//, '')}`}>
                          <item.icon className="h-4 w-4" />
                          <span className="text-sm font-medium">{item.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            )}

            {/* ─── Account + Theme ─────────────────────────────────────── */}
            <div className="mt-auto p-4 border-t border-border space-y-2">
              <div className="flex items-center gap-2 pb-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate" title={user?.email ?? ""}>
                    {user?.name || user?.email}
                  </div>
                  {user?.name && user.email !== user.name && (
                    <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
                  )}
                </div>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  title={tr.signOut}
                  data-testid="sign-out"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-all disabled:opacity-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>{signingOut ? tr.signingOut : tr.signOut}</span>
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setTheme("light")}
                  title="Light theme"
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                    theme === "light"
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent"
                  }`}
                >
                  <Sun className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  title="Dark theme"
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                    theme === "dark"
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent"
                  }`}
                >
                  <Moon className="h-3.5 w-3.5" />
                </button>
                {/* Clients only: the operator is support. */}
                {!isOperator && (
                  <>
                    <div className="flex-1" />
                    <a
                      href="mailto:outreach@dim.capital?subject=DIM%20Convert%20support"
                      data-testid="support-link"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-all"
                    >
                      <LifeBuoy className="h-3.5 w-3.5" />
                      Support
                    </a>
                  </>
                )}
              </div>
            </div>
          </SidebarContent>
        </Sidebar>
        <main className="flex-1 overflow-auto flex flex-col">
          <TrialBanner />
          <div className="flex-1 p-6 lg:p-8 max-w-6xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
