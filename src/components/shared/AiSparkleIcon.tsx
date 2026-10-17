// src/components/shared/AiSparkleIcon.tsx
// The single "AI glyph" used everywhere the site represents its AI Assistant:
// the homepage floating button, the homepage chat panel header, the Notes
// bottom-toolbar "AI" button, the Notes desktop stack button, and the Notes
// chat panel header. Keeping ONE component means the icon can never drift
// out of sync between these five places again.
//
// 12-ray sparkle burst, alternating long/short rays, flat angular cut ends —
// same glyph as the floating AI Assistant button on the homepage.

interface AiSparkleIconProps {
  size?: number;
  className?: string;
}

const AiSparkleIcon = ({ size = 24, className }: AiSparkleIconProps) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="currentColor" className={className}>
    <g>
      {Array.from({ length: 12 }).map((_, i) => (
        <path
          key={i}
          d={
            i % 2 === 0
              ? "M50 38 L42 4 L50 0 L58 4 L50 38 Z"
              : "M50 44 L45 18 L50 13 L55 18 L50 44 Z"
          }
          transform={`rotate(${i * 30} 50 50)`}
        />
      ))}
    </g>
  </svg>
);

export default AiSparkleIcon;
