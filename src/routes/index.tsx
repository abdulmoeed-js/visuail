import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { WhyNotMiro } from "@/components/Marketing";
import { Workbench } from "@/components/Workbench";
import { Pricing, Footer } from "@/components/Pricing";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero />
        <ProductStrip />
        <Workbench />
        <WhyNotMiro />
        <Pricing />
      </main>
      <Footer />
    </div>
  );
}
