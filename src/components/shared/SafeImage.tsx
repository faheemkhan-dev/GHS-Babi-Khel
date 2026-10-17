/**
 * SafeImage.tsx — Reusable Image Component with Error Handling
 * -----------------------------------------------------------------------------
 * Handles broken Cloudinary URLs gracefully by:
 * 1. VALIDATING URLs before rendering (prevents broken image icons)
 * 2. Showing image with loading state
 * 3. On error → Falls back to initials/avatar placeholder with gradient
 * 4. Supports different shapes (circle, rounded, square)
 * 5. Different sizes (sm, md, lg, xl)
 * 6. Gradient background for fallback
 * 7. Accessible alt text
 * 8. Optional onClick handler
 * 9. Retry mechanism for transient failures
 */

import { useState, useEffect } from "react";
import { safeCloudinaryUrl } from "@/lib/cloudinaryValidator";

interface SafeImageProps {
  src: string | null | undefined;
  alt?: string;
  fallbackText?: string; // For initials (e.g., "SA" for "Storm Eagle")
  className?: string;
  shape?: "circle" | "rounded" | "square";
  size?: "sm" | "md" | "lg" | "xl";
  onClick?: () => void;
}

// Size configurations mapping
const sizeConfig = {
  sm: { container: "w-8 h-8", text: "text-xs" },
  md: { container: "w-10 h-10", text: "text-sm" },
  lg: { container: "w-12 h-12", text: "text-base" },
  xl: { container: "w-16 h-16", text: "text-lg" },
};

// Shape class mapping
const shapeClass = {
  circle: "rounded-full",
  rounded: "rounded-lg",
  square: "rounded-none",
};

// Generate initials from a name string
function generateInitials(name?: string): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

// Gradient combinations for visual variety based on name
function getGradientColors(text: string): string {
  const gradients = [
    "from-blue-500 to-purple-600",
    "from-teal-500 to-cyan-600",
    "from-orange-500 to-red-500",
    "from-pink-500 to-rose-600",
    "from-indigo-500 to-blue-600",
    "from-amber-500 to-orange-600",
    "from-cyan-500 to-blue-500",
    "from-violet-500 to-purple-600",
  ];
  
  // Use the text to pick a consistent gradient
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}

export function SafeImage({
  src,
  alt = "",
  fallbackText,
  className = "",
  shape = "circle",
  size = "md",
  onClick,
}: SafeImageProps) {
  const [imgError, setImgError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  
  // Validate and sanitize the URL BEFORE passing it to img tag
  // This prevents broken Cloudinary URLs from ever reaching the browser
  const validatedSrc = safeCloudinaryUrl(src);
  const [currentSrc, setCurrentSrc] = useState<string | null | undefined>(validatedSrc);

  // Reset error state when src changes
  useEffect(() => {
    // Validate the new source
    const newValidatedSrc = safeCloudinaryUrl(src);
    setImgError(false);
    setIsLoading(true);
    setRetryCount(0);
    setCurrentSrc(newValidatedSrc);
    
    // Log if URL was invalid (helps diagnose Cloudinary issues) — only in
    // development so production consoles stay clean (Lighthouse "browser
    // errors logged to console" audit).
    if (import.meta.env.DEV && src && !newValidatedSrc) {
      console.warn('[SafeImage] Invalid or broken URL prevented from rendering:', {
        originalSrc: src,
        alt: alt,
        willShow: 'fallback (initials/placeholder)'
      });
    }
  }, [src, alt]);

  // Determine display text for fallback
  const displayText = fallbackText || generateInitials(alt);
  const gradientClass = getGradientColors(displayText);
  const sizeClasses = sizeConfig[size];
  const shapeClasses = shapeClass[shape];

  // Combined container classes
  const containerClassName = `
    ${sizeClasses.container}
    ${shapeClasses}
    flex items-center justify-center
    font-bold text-white
    bg-gradient-to-br ${gradientClass}
    shrink-0
    overflow-hidden
    ${onClick ? "cursor-pointer" : ""}
    ${className}
  `.trim().replace(/\s+/g, " ");

  // If no valid src or there was an error, show fallback
  // Also show fallback if validation failed (currentSrc is null but original src existed)
  const shouldShowFallback = !currentSrc || imgError || (src && !validatedSrc && retryCount >= 2);
  
  if (shouldShowFallback) {
    return (
      <div
        className={containerClassName}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
        aria-label={alt || "User avatar"}
      >
        <span className={`${sizeClasses.text} leading-none select-none`}>
          {displayText}
        </span>
      </div>
    );
  }

  return (
    <div className={`relative ${sizeClasses.container} ${shapeClasses} shrink-0 overflow-hidden ${className}`}>
      {/* Loading skeleton */}
      {isLoading && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}
      
      {/* Actual image */}
      <img
        src={currentSrc}
        alt={alt}
        className={`
          w-full h-full object-cover
          ${isLoading ? "opacity-0" : "opacity-100"}
          transition-opacity duration-200
          ${onClick ? "cursor-pointer" : ""}
        `.trim().replace(/\s+/g, " ")}
        onError={() => {
          // Retry up to 2 times before giving up (handles transient network issues)
          if (retryCount < 2) {
            if (import.meta.env.DEV) {
              console.log(`[SafeImage] Image load failed, retry ${retryCount + 1}/2...`, {
                src: currentSrc,
                alt: alt
              });
            }
            setRetryCount(prev => prev + 1);
            // Force re-render by toggling loading state
            setIsLoading(false);
            setTimeout(() => setIsLoading(true), 100 * (retryCount + 1));
          } else {
            if (import.meta.env.DEV) {
              console.warn('[SafeImage] Image failed to load after retries, showing fallback:', {
                src: currentSrc,
                alt: alt
              });
            }
            setImgError(true);
            setIsLoading(false);
          }
        }}
        onLoad={() => {
          setIsLoading(false);
          // Reset retry count on successful load
          if (retryCount > 0) {
            setRetryCount(0);
          }
        }}
        loading="lazy"
        decoding="async"
        onClick={onClick}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
      />
    </div>
  );
}

/**
 * Hook-based version for inline usage in existing components.
 * Returns { imgError, setImgError, isLoading } state and a helper function
 * to render either an img or fallback div.
 */
export function useSafeImage(src: string | null | undefined) {
  const [imgError, setImgError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Reset when src changes
  useEffect(() => {
    setImgError(false);
    setIsLoading(true);
  }, [src]);

  return {
    imgError,
    setImgError,
    isLoading,
    hasError: !src || imgError,
    shouldShowImage: src && !imgError,
  };
}

/**
 * Helper function to generate initials from a full name.
 * Can be used independently of the SafeImage component.
 */
export { generateInitials };

export default SafeImage;
