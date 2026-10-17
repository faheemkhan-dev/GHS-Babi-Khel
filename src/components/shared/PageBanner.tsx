import { motion } from "framer-motion";

interface PageBannerProps {
  title: string;
  subtitle?: string;
  /**
   * Optional content rendered INSIDE the banner, anchored to the banner's
   * bottom edge (horizontally centred). In the default variant it sits flush
   * with the bottom edge line; in the "premium" variant it floats half-way
   * over the edge like a premium action pill.
   */
  children?: React.ReactNode;
  /** "premium" = layered hero with orbs, dot-grid, icon badge & gold rule. */
  variant?: "default" | "premium";
  /** Small uppercase label above the title (premium variant only). */
  eyebrow?: string;
  /** Icon shown in the glass badge above the title (premium variant only). */
  icon?: React.ReactNode;
  /** Smaller banner (less padding, smaller icon/title) — premium variant only. */
  compact?: boolean;
}

const PageBanner = ({
  title,
  subtitle,
  children,
  variant = "default",
  eyebrow,
  icon,
  compact = false,
}: PageBannerProps) => {
  if (variant === "premium") {
    return (
      <div
        className={`gradient-hero relative overflow-visible ${
          children
            ? "pt-8 md:pt-12 pb-9 md:pb-12"
            : compact ? "py-6 md:py-8" : "py-10 md:py-14"
        }`}
      >
        {/* Layered decoration — static gradients only (cheap on mobile) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="orb orb-gold w-[420px] h-[420px] -top-44 -right-28 opacity-80" />
          <div className="orb orb-light w-[320px] h-[320px] -bottom-32 -left-20" />
          <div className="absolute inset-0 dot-grid opacity-[0.10]" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/20" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        <div className="container mx-auto px-4 text-center relative z-10">
          {icon && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className={`mx-auto ${compact ? "mb-2 w-10 h-10 md:w-11 md:h-11" : "mb-3 w-12 h-12 md:w-14 md:h-14"} rounded-2xl flex items-center justify-center text-gold bg-white/10 border border-white/20 backdrop-blur-sm shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.25)]`}
            >
              {icon}
            </motion.div>
          )}
          {eyebrow && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className={`text-[10px] md:text-xs font-bold uppercase tracking-[0.28em] text-gold ${compact ? "mb-1" : "mb-2"}`}
            >
              {eyebrow}
            </motion.p>
          )}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${compact ? "text-2xl md:text-4xl" : "text-[1.9rem] md:text-5xl"} leading-[1.1] font-heading font-bold text-on-hero tracking-tight`}
          >
            {title}
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 0.12 }}
            className={`${compact ? "mt-2.5" : "mt-4"} flex items-center justify-center gap-2`}
          >
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold" />
            <span className="w-1.5 h-1.5 rotate-45 bg-gold" />
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold" />
          </motion.div>
          {subtitle && (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className={`${compact ? "mt-2 text-xs md:text-sm" : "mt-3.5 text-sm md:text-base"} text-on-hero-soft max-w-md md:max-w-xl mx-auto leading-relaxed`}
            >
              {subtitle}
            </motion.p>
          )}
        </div>

        {children && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 translate-y-1/2"
          >
            {children}
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`gradient-hero relative overflow-visible ${
        // When children exist, the extra bottom padding (pb-10 md:pb-12)
        // reserves room for them BELOW the subtitle and ABOVE the banner's
        // bottom edge, so they can never overlap the subtitle text. The child
        // itself is anchored flush to the bottom edge (see the absolute
        // wrapper below), so its bottom edge touches the banner's edge line.
        children ? "pt-10 md:pt-12 pb-10 md:pb-12" : "py-10 md:py-12"
      }`}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/10 pointer-events-none" />
      <div className="container mx-auto px-4 text-center relative z-10">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl md:text-4xl font-heading font-bold text-on-hero tracking-tight"
        >
          {title}
        </motion.h1>
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.1 }}
          className="mx-auto mt-3 h-[3px] w-14 rounded-full bg-gold"
        />
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-3 text-on-hero-soft text-sm md:text-base max-w-xl mx-auto"
          >
            {subtitle}
          </motion.p>
        )}
      </div>

      {children && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-4"
        >
          {children}
        </motion.div>
      )}
    </div>
  );
};

export default PageBanner;
