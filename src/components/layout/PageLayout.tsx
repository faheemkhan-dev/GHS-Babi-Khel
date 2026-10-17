import { ReactNode } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import ScrollToTop from "../shared/ScrollToTop";
import { PushContextBar } from "../shared/PushOptIn";

const PageLayout = ({ children }: { children: ReactNode }) => {
  return (
    // Dock clearance now lives INSIDE <Footer> (green padding) so no white
    // strip shows under the footer on mobile.
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <PushContextBar />
        {children}
      </main>
      <Footer />
      <ScrollToTop />
    </div>
  );
};

export default PageLayout;
