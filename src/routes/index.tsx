import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { WhyNotMiro } from "@/components/Marketing";
import { Workbench } from "@/components/Workbench";
import { Pricing, Footer } from "@/components/Pricing";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session.loading && session.signedIn) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [session.loading, session.signedIn, navigate]);

  // Signed-in visitors land on their dashboard, not the marketing page --
  // this covers both the brief auth-resolving window and the redirect
  // itself, so there's no flash of landing-page content for them.
  if (session.loading || session.signedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero />

        <Workbench />
        <WhyNotMiro />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}
