import { NavBar } from "./components/NavBar";
import { HeroSection } from "./components/HeroSection";
import { FeatureShowcase } from "./components/FeatureShowcase";
import { FeatureGrid } from "./components/FeatureGrid";
import { Footer } from "./components/Footer";

export function WebsiteApp() {
  return (
    <>
      <NavBar />
      <main>
        <HeroSection />
        <FeatureShowcase />
        <FeatureGrid />
        <Footer />
      </main>
    </>
  );
}
