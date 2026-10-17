import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp } from "lucide-react";

// Behavior:
//  - Hidden while the page is stationary (no scrolling happening).
//  - Appears the moment the user scrolls, and auto-hides ~900ms after
//    scrolling stops.
//  - It stays in a reserved bottom-right lane above the AI assistant,
//    avoiding overlap on both mobile and desktop.
//  - Clicking it always scrolls all the way back to the top.
//  - Only shows at all once scrolled past 400px (no point near the top).
const ScrollToTop = () => {
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;

      if (y > 400) {
        setVisible(true);
      } else {
        setVisible(false);
      }

      // Reset the auto-hide timer on every scroll event
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 900);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          key="scroll-to-top"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-5 sm:right-6 z-50 w-10 h-10 rounded-full gradient-accent text-primary-foreground shadow-elevated ring-2 ring-background/80 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform bottom-[calc(5.5rem+48px+0.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-[calc(1.5rem+48px+0.75rem)]"
          aria-label="Scroll to top"
        >
          <ArrowUp className="w-5 h-5" />
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default ScrollToTop;
