import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  /** Aspect ratio class e.g. "aspect-video" or "aspect-square" — prevents layout shift */
  aspectClass?: string;
  /** Extra wrapper className */
  wrapperClassName?: string;
  /** Priority = true means load eagerly (hero images, above-fold) */
  priority?: boolean;
}

/**
 * LazyImage — drop-in replacement for <img>.
 *
 * What it does:
 * 1. Shows a shimmer skeleton INSTANTLY — zero blank white space
 * 2. Loads the real image in the background (lazy by default)
 * 3. Fades it in smoothly when loaded — no layout jump
 * 4. On slow internet: shimmer shows for as long as needed, never blank
 */
const LazyImage = ({
  src,
  alt,
  aspectClass = "",
  wrapperClassName = "",
  priority = false,
  className = "",
  ...props
}: LazyImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // If image is already cached, mark it loaded immediately
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return (
    <div className={cn("relative overflow-hidden bg-muted", aspectClass, wrapperClassName)}>
      {/* Shimmer skeleton — visible until image loads */}
      {!loaded && !error && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-muted via-muted-foreground/10 to-muted bg-[length:200%_100%]" />
      )}

      {/* Error fallback */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-xs">
          ⚠ Image unavailable
        </div>
      )}

      {/* The actual image */}
      {!error && (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
            className
          )}
          {...props}
        />
      )}
    </div>
  );
};

export default LazyImage;
