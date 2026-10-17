import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Browsers do NOT reset scroll position on client-side route pushes by
// default — the new page simply renders at whatever pixel offset the old
// page was scrolled to. On a shorter page that offset can land past the
// content entirely, which is what looked like "jumping to the footer"
// (navigating forward into a shorter page) or "jumping to the top"
// (navigating back into a page where the old offset no longer makes sense).
//
// Fix: explicitly scroll to top whenever the pathname changes via PUSH
// (forward navigation, e.g. clicking a subject/chapter link). On POP
// (browser/back-button navigation) we leave scroll alone so the browser's
// native back-forward scroll memory can restore the position the user was
// previously at on that page, which is the expected, less jarring behavior.
const ScrollToTopOnNavigate = () => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (navigationType === "PUSH") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }, [pathname, navigationType]);

  return null;
};

export default ScrollToTopOnNavigate;
