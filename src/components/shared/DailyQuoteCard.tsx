// src/components/shared/DailyQuoteCard.tsx
// Beautiful daily quote widget — matches admin panel style
// Enhanced with: Typography, category theming, animated reveal, author badges

import { useState, useEffect } from "react";
import { getTodayQuote } from "@/data/dailyQuotes";
import { Star, BookOpen, Sparkles } from "lucide-react";

// ─── CATEGORY CONFIGURATIONS ──────────────────────────────────────────────────

const QUOTE_CATEGORIES = {
  motivational: {
    emoji: "💡",
    icon: Sparkles,
    gradient: "from-amber-50 to-amber-50 dark:from-amber-950/30 dark:to-amber-950/20",
    borderLeft: "border-l-amber-500",
    border: "border-amber-200 dark:border-amber-700/30",
    accent: "text-amber-600 dark:text-amber-400",
    textClass: "text-amber-900 dark:text-amber-100",
    authorClass: "text-amber-700 dark:text-amber-300",
    watermarkColor: "text-amber-200 dark:text-amber-900/20",
  },
  islamic: {
    emoji: "🌙",
    icon: BookOpen,
    gradient: "from-teal-50 to-cyan-50 dark:from-teal-950/30 dark:to-cyan-950/20",
    borderLeft: "border-l-teal-500",
    border: "border-teal-200 dark:border-teal-700/30",
    accent: "text-teal-600 dark:text-teal-400",
    textClass: "text-teal-900 dark:text-teal-100",
    authorClass: "text-teal-700 dark:text-teal-300",
    watermarkColor: "text-teal-200 dark:text-teal-900/20",
  },
  educational: {
    emoji: "📚",
    icon: BookOpen,
    gradient: "from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/20",
    borderLeft: "border-l-blue-500",
    border: "border-blue-200 dark:border-blue-700/30",
    accent: "text-blue-600 dark:text-blue-400",
    textClass: "text-blue-900 dark:text-blue-100",
    authorClass: "text-blue-700 dark:text-blue-300",
    watermarkColor: "text-blue-200 dark:text-blue-900/20",
  },
};

// ─── AUTHOR BADGE HELPER ─────────────────────────────────────────────────────

function getAuthorBadge(author: string | null, category: string): { icon: React.ReactNode; show: boolean } {
  if (!author) return { icon: null, show: false };
  
  const lowerAuthor = author.toLowerCase();
  if (category === "islamic" && (lowerAuthor.includes("prophet") || lowerAuthor.includes("muhammad") || lowerAuthor.includes("pbuh"))) {
    return { 
      icon: <span className="text-base">ﷺ</span>, 
      show: true
    };
  }
  if (category === "educational") {
    return { 
      icon: <BookOpen className="w-3.5 h-3.5" />, 
      show: true
    };
  }
  if (category === "motivational") {
    return { 
      icon: <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />, 
      show: true
    };
  }
  return { icon: null, show: false };
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function DailyQuoteCard() {
  // Static, code-based quote — synchronous, no network round-trip, no
  // admin panel dependency. See src/data/dailyQuotes.ts.
  const [quote] = useState(getTodayQuote);
  const [isVisible, setIsVisible] = useState(false);

  // Animated reveal effect
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const categoryConfig = QUOTE_CATEGORIES[quote.category as keyof typeof QUOTE_CATEGORIES] || QUOTE_CATEGORIES.motivational;
  const authorBadge = getAuthorBadge(quote.author, quote.category);

  return (
    <div
      className={`
        transition-all duration-700 ease-out transform
        ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-6 scale-95'}
      `}
    >
      {/* Main Card Container */}
      <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-r ${categoryConfig.gradient} border ${categoryConfig.border} shadow-lg hover:shadow-xl transition-shadow duration-300`}>
        
        {/* Decorative Quotation Mark Watermark - Large & Faded */}
        <div className={`absolute -top-4 -right-4 text-[120px] font-serif select-none pointer-events-none opacity-[0.07] ${categoryConfig.watermarkColor} leading-none`}>
          ❝
        </div>
        
        {/* Subtle Pattern Overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `radial-gradient(circle at 20% 50%, currentColor 1px, transparent 1px)`,
          backgroundSize: '20px 20px'
        }} />

        {/* Card Content */}
        <div className="relative z-10 p-6 sm:p-8">
          
          {/* Category Badge */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">{categoryConfig.emoji}</span>
            <span className={`text-xs font-semibold uppercase tracking-wider ${categoryConfig.accent} bg-white/60 dark:bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm`}>
              {quote.category === 'islamic' ? 'Islamic Wisdom' : quote.category === 'educational' ? 'Knowledge' : 'Inspiration'}
            </span>
          </div>

          {/* Quote Text - Italic Serif */}
          <blockquote className="relative pl-4 border-l-4 border-current opacity-80">
            <p 
              className={`text-lg sm:text-xl leading-relaxed ${categoryConfig.textClass}`}
              style={{ fontFamily: 'Georgia, "Times New Roman", "Noto Serif", serif', fontStyle: 'italic' }}
            >
              "{quote.text}"
            </p>
          </blockquote>

          {/* Author Section */}
          {quote.author && (
            <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <cite 
                  className={`not-italic text-sm font-medium ${categoryConfig.authorClass}`}
                  style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                >
                  — {quote.author}
                </cite>
                {authorBadge.show && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-black/20 text-xs font-medium backdrop-blur-sm">
                    {authorBadge.icon}
                  </span>
                )}
              </div>
              
              {/* Source if available */}
              {quote.source && (
                <span className="text-xs text-muted-foreground bg-white/50 dark:bg-black/15 px-2 py-1 rounded-md">
                  📖 {quote.source}
                </span>
              )}
            </div>
          )}

          {/* Decorative Bottom Line */}
          <div className={`mt-6 pt-4 border-t ${categoryConfig.border}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className={`w-8 h-0.5 rounded-full bg-gradient-to-r from-transparent via-current to-transparent ${categoryConfig.accent.replace('text-', 'bg-').replace('-600', '-400')}`} />
              </div>
              <span className={`text-[10px] uppercase tracking-widest ${categoryConfig.accent} opacity-60`}>
                Daily Inspiration
              </span>
            </div>
          </div>

        </div>

        {/* Corner Accents */}
        <div className={`absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 ${categoryConfig.borderLeft} rounded-tl-2xl opacity-40`} />
        <div className={`absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 ${categoryConfig.borderLeft} rounded-br-2xl opacity-40`} />
        
      </div>
    </div>
  );
}

export default DailyQuoteCard;
