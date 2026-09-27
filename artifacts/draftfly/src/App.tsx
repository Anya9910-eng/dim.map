import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";
import { ThemeProvider } from "@/hooks/use-theme";
import { LangProvider } from "@/hooks/use-lang";
import Login from "@/pages/login";
import { ProtectedRoute } from "@/components/protected-route";
import { BillingGuard } from "@/components/billing-guard";

// Pages
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import ClientDetail from "@/pages/client-detail";
import Personas from "@/pages/personas";
import PersonaDetail from "@/pages/persona-detail";
import Campaigns from "@/pages/campaigns";
import CampaignDetail from "@/pages/campaign-detail";
import Drafts from "@/pages/drafts";
import DraftDetail from "@/pages/draft-detail";
import SlackAppSetup from "@/pages/slack-app-setup";
import TestFlow from "@/pages/test-flow";
import Onboarding from "@/pages/onboarding";
import InternalSetup from "@/pages/internal-setup";
import Logs from "@/pages/logs";
import ReplyHistory from "@/pages/reply-history";
import Settings from "@/pages/settings";
import ClientSettings from "@/pages/client-settings";
import { useAuth } from "@/hooks/use-auth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * One /settings route, two very different pages. The operator's is a panel of
 * server-wide integration status; a client's is their own connection details.
 * Sharing the path keeps a single "Settings" entry in the sidebar.
 */
function SettingsForRole() {
  const { isOperator } = useAuth();
  return isOperator ? <Settings /> : <ClientSettings />;
}

function SignIn() {
  return <Login mode="signin" />;
}

function Signup() {
  return <Login mode="signup" />;
}

function ProtectedRouter() {
  return (
    <ProtectedRoute>
      <BillingGuard>
      <AppLayout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/clients" component={Clients} />
          <Route path="/clients/:id" component={ClientDetail} />
          <Route path="/personas" component={Personas} />
          <Route path="/personas/:id" component={PersonaDetail} />
          <Route path="/campaigns" component={Campaigns} />
          <Route path="/campaigns/:id" component={CampaignDetail} />
          <Route path="/drafts" component={Drafts} />
          <Route path="/drafts/:id" component={DraftDetail} />
          <Route path="/slack-app-setup" component={SlackAppSetup} />
          <Route path="/test-flow" component={TestFlow} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/internal-setup" component={InternalSetup} />
          <Route path="/logs" component={Logs} />
          <Route path="/reply-history" component={ReplyHistory} />
          <Route path="/settings" component={SettingsForRole} />
          <Route component={NotFound} />
        </Switch>
      </AppLayout>
      </BillingGuard>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LangProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Switch>
              <Route path="/login" component={SignIn} />
              <Route path="/signup" component={Signup} />
              <Route component={ProtectedRouter} />
            </Switch>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
      </LangProvider>
    </ThemeProvider>
  );
}

export default App;
