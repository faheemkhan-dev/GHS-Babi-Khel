/**
 * HexagonLogoFrame — clips the school logo (image or fallback icon) into a
 * hexagon shape. No border, outline, or glow — just the hexagon crop.
 */
export function HexagonLogoFrame({
  size = 40,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  // Hexagon clip-path (flat-top hexagon).
  const clipPath = "polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)";

  return (
    <div
      className="relative shrink-0 overflow-hidden bg-primary flex items-center justify-center"
      style={{ width: size, height: size, clipPath }}
    >
      {children}
    </div>
  );
}

export default HexagonLogoFrame;
