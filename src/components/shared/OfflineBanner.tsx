import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const OfflineBanner = () => {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {offline && (
        // pointer-events-none: this banner is purely informational and sits
        // fixed on top of the navbar — without it, when offline it swallows
        // every tap on the nav links / mobile menu button underneath, making
        // the app impossible to navigate while offline.
        <motion.div
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          className="fixed top-0 left-0 right-0 z-[60] bg-destructive text-destructive-foreground text-center py-2 text-sm font-medium flex items-center justify-center gap-2 pointer-events-none"
        >
          <WifiOff className="w-4 h-4" />
          You are offline. Some features may not work.
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default OfflineBanner;
