import { NavBar } from "./components/NavBar";
import { HeroSection } from "./components/HeroSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { AppPreview } from "./components/AppPreview";
import { Footer } from "./components/Footer";

export function WebsiteApp() {
  return (
    <>
      <NavBar />
      <main>
        <HeroSection />
        <FeatureGrid />
        <AppPreview />
        <Footer />
      </main>
    </>
  );
}
