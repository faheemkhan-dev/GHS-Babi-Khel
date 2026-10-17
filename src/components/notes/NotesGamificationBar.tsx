import { useState, useEffect, useCallback } from "react";
import { useGamification } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { 
  Flame, Star, Zap, Trophy, Award, TrendingUp, ChevronRight,
  Sparkles, Target, Gift
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────────
interface SessionStats {
  pointsEarned: number;
  chaptersRead: number;
  quizzesPassed: number;
  startTime: Date;
}

interface BadgeNotification {
  id: string;
  badgeId: string;
  badgeName: string;
  badgeEmoji: string;
  timestamp: Date;
}

// ─── Props ──────────────────────────────────────────────────────────────────────
interface NotesGamificationBarProps {
  /** Points earned in current session (external) */
  sessionPoints?: number;
  /** Chapters completed in this session */
  chaptersCompleted?: number;
  /** Callback when user clicks to see more */
  onShowLeaderboard?: () => void;
  /** Compact mode for smaller screens */
  compact?: boolean;
  /** Custom class names */
  className?: string;
}

// ─── Animated Counter Component ─────────────────────────────────────────────────
function AnimatedCounter({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(value);
  
  useEffect(() => {
    const duration = 500;
    const steps = 20;
    const increment = (value - displayValue) / steps;
    let current = displayValue;
    
    const timer = setInterval(() => {
      current += increment;
      if ((increment > 0 && current >= value) || (increment < 0 && current <= value)) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.round(current));
      }
    }, duration / steps);
    
    return () => clearInterval(timer);
  }, [value]);

  return <span>{prefix}{displayValue}{suffix}</span>;
}

// ─── Progress Ring for Rank Up Indicator ────────────────────────────────────────
function ProgressRing({ progress, size = 40, strokeWidth = 4 }: { progress: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted/30"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="text-primary transition-all duration-500 ease-out"
      />
      {/* Center text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dy=".3em"
        className="fill-current text-xs font-bold"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
      >
        {Math.round(progress)}%
      </text>
    </svg>
  );
}

// ─── Badge Unlock Notification Toast ────────────────────────────────────────────
function BadgeUnlockToast({ notification, onDismiss }: { notification: BadgeNotification; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => setIsVisible(true));
    
    // Auto dismiss after 5 seconds
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`
      flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-yellow-50 to-amber-50 
      dark:from-yellow-950/50 dark:to-amber-950/50 border border-yellow-200 dark:border-yellow-800
      shadow-lg transition-all duration-300 transform
      ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
    `}>
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center text-xl animate-bounce">
          {notification.badgeEmoji}
        </div>
        <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-yellow-500" />
      </div>
      <div className="flex-1">
        <p className="font-semibold text-sm text-yellow-800 dark:text-yellow-200">Badge Unlocked!</p>
        <p className="text-xs text-muted-foreground">{notification.badgeName}</p>
      </div>
      <button onClick={onDismiss} className="p-1 hover:bg-muted rounded-full transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ─── Main NotesGamificationBar Component ───────────────────────────────────────
export default function NotesGamificationBar({
  sessionPoints = 0,
  chaptersCompleted = 0,
  onShowLeaderboard,
  compact = false,
  className = "",
}: NotesGamificationBarProps) {
  const { user } = useAuth();
  const { data: gamification } = useGamification(user?.id);
  
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    pointsEarned: sessionPoints,
    chaptersRead: chaptersCompleted,
    quizzesPassed: 0,
    startTime: new Date(),
  });
  
  const [badgeNotifications, setBadgeNotifications] = useState<BadgeNotification[]>([]);
  const [showDetails, setShowDetails] = useState(false);

  // Update session stats when props change
  useEffect(() => {
    setSessionStats(prev => ({
      ...prev,
      pointsEarned: sessionPoints,
      chaptersRead: chaptersCompleted,
    }));
  }, [sessionPoints, chaptersCompleted]);

  // Simulate badge unlock notification (in real app, this would come from awardPoints callback)
  const triggerBadgeNotification = useCallback((badgeId: string, badgeName: string, badgeEmoji: string) => {
    const newNotification: BadgeNotification = {
      id: Date.now().toString(),
      badgeId,
      badgeName,
      badgeEmoji,
      timestamp: new Date(),
    };
    setBadgeNotifications(prev => [...prev.slice(-2), newNotification]); // Keep max 3 notifications
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setBadgeNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Calculate rank-up progress (example: next rank at every 100 points)
  const currentPoints = gamification?.total_points || 0;
  const nextMilestone = Math.ceil(currentPoints / 100) * 100;
  const progressToNextRank = ((currentPoints % 100) / 100) * 100;

  // Session duration
  const [sessionDuration, setSessionDuration] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setSessionDuration(Math.floor((Date.now() - sessionStats.startTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStats.startTime]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Compact mode - minimal display
  if (compact) {
    return (
      <div className={`flex items-center gap-3 px-3 py-2 rounded-xl bg-card border shadow-sm ${className}`}>
        {/* Streak */}
        {(gamification?.streak_days || 0) > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30">
            <Flame size={14} className="text-orange-500 fill-orange-500 animate-pulse" />
            <span className="text-xs font-bold text-orange-700 dark:text-orange-300">{gamification.streak_days}</span>
          </div>
        )}
        
        {/* Points earned this session */}
        {sessionStats.pointsEarned > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30">
            <Star size={14} className="text-green-600 fill-green-600" />
            <span className="text-xs font-bold text-green-700 dark:text-green-300">+{sessionStats.pointsEarned}</span>
          </div>
        )}
        
        {/* Session timer */}
        <span className="text-xs text-muted-foreground ml-auto">{formatDuration(sessionDuration)}</span>
        
        {/* Expand button */}
        {onShowLeaderboard && (
          <button 
            onClick={onShowLeaderboard}
            className="p-1 hover:bg-muted rounded-full transition-colors"
          >
            <Trophy size={14} className="text-primary" />
          </button>
        )}
      </div>
    );
  }

  // Full mode - expanded bar with all stats (compact/mobile-friendly sizing)
  return (
    <div className={`space-y-2 ${className}`}>
      {/* Main Bar */}
      <div className="
        p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 
        dark:from-indigo-950/40 dark:via-purple-950/40 dark:to-pink-950/40
        border border-indigo-100 dark:border-indigo-900/30 shadow-sm
      ">
        {/* Header Row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shrink-0">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <div>
              <p className="font-bold text-xs leading-tight">Study Session</p>
              <p className="text-[10px] text-muted-foreground leading-tight">{formatDuration(sessionDuration)} elapsed</p>
            </div>
          </div>
          
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-0.5 px-2 py-1 rounded-full bg-white/50 dark:bg-white/10 
                       hover:bg-white/80 dark:hover:bg-white/20 transition-colors text-[11px] font-medium shrink-0"
          >
            {showDetails ? 'Hide' : 'Details'}
            <ChevronRight className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-1.5">
          {/* Streak */}
          <StatPill
            icon={<Flame size={13} className="text-orange-500 fill-orange-500" />}
            value={`${gamification?.streak_days || 0}`}
            label="Streak"
            highlight={(gamification?.streak_days || 0) >= 7}
            color="orange"
          />
          
          {/* Session Points */}
          <StatPill
            icon={<Star size={13} className="text-green-500 fill-green-500" />}
            value={`+${sessionStats.pointsEarned}`}
            label="Session"
            highlight={sessionStats.pointsEarned >= 50}
            color="green"
          />
          
          {/* Total Points */}
          <StatPill
            icon={<Trophy size={13} className="text-yellow-500" />}
            value={currentPoints.toLocaleString()}
            label="Total"
            color="yellow"
          />
          
          {/* Chapters Read */}
          <StatPill
            icon={<Target size={13} className="text-blue-500" />}
            value={sessionStats.chaptersRead.toString()}
            label="Chapters"
            color="blue"
          />
        </div>

        {/* Progress Bar to Next Milestone */}
        <div className="mt-2 pt-2 border-t border-white/20 dark:border-white/10">
          <div className="flex items-center gap-2">
            <ProgressRing progress={progressToNextRank} size={28} strokeWidth={3} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[10px] mb-0.5">
                <span className="text-muted-foreground truncate">Next milestone</span>
                <span className="font-medium shrink-0 ml-1">{currentPoints}/{nextMilestone}</span>
              </div>
              <div className="h-1.5 bg-white/30 dark:bg-black/20 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressToNextRank}%` }}
                />
              </div>
            </div>
            
            {onShowLeaderboard && (
              <button
                onClick={onShowLeaderboard}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary text-primary-foreground 
                           hover:bg-primary/90 transition-colors text-[10px] font-medium shrink-0"
              >
                <TrendingUp size={10} />
                Ranks
              </button>
            )}
          </div>
        </div>

        {/* Expanded Details */}
        {showDetails && (
          <div className="mt-2 pt-2 border-t border-white/20 dark:border-white/10 space-y-2 animate-in slide-in-from-top-2">
            {/* Badges Earned This Session placeholder */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white/30 dark:bg-black/10">
              <Award size={13} className="text-purple-500 shrink-0" />
              <span className="text-[10px] text-muted-foreground flex-1">
                Badges: {gamification?.badges?.length || 0} earned
              </span>
              <div className="flex -space-x-1">
                {(gamification?.badges || []).slice(0, 4).map((badge: string, i: number) => (
                  <div key={i} className="w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/50 
                                      flex items-center justify-center text-[10px] border-2 border-background">
                    🏆
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Badge Unlock Notifications */}
      <div className="space-y-2 fixed bottom-4 right-4 z-50 max-w-sm">
        {badgeNotifications.map(notification => (
          <BadgeUnlockToast
            key={notification.id}
            notification={notification}
            onDismiss={() => dismissNotification(notification.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Stat Pill Helper ───────────────────────────────────────────────────────────
function StatPill({ 
  icon, 
  value, 
  label, 
  highlight = false,
  color = "blue"
}: { 
  icon: React.ReactNode; 
  value: string; 
  label: string; 
  highlight?: boolean;
  color?: string;
}) {
  const colorClasses: Record<string, string> = {
    orange: highlight ? 'bg-orange-100 dark:bg-orange-900/50 ring-2 ring-orange-300 dark:ring-orange-700' : 'bg-white/50 dark:bg-white/5',
    green: highlight ? 'bg-green-100 dark:bg-green-900/50 ring-2 ring-green-300 dark:ring-green-700' : 'bg-white/50 dark:bg-white/5',
    yellow: 'bg-white/50 dark:bg-white/5',
    blue: 'bg-white/50 dark:bg-white/5',
  };

  return (
    <div className={`
      flex flex-col items-center p-1.5 rounded-lg transition-all duration-300
      ${colorClasses[color]}
      ${highlight ? 'animate-pulse-slow' : ''}
    `}>
      <div className="flex items-center gap-1">{icon}</div>
      <span className="text-xs font-semibold leading-tight">
        <AnimatedCounter value={parseInt(value.replace(/[^0-9]/g, '')) || 0} 
                          prefix={value.startsWith('+') ? '+' : ''} />
      </span>
      <span className="text-[9px] text-muted-foreground leading-tight text-center">{label}</span>
    </div>
  );
}

// ─── Custom Styles ─────────────────────────────────────────────────────────────
const customStyles = `
  @keyframes pulse-slow {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
  .animate-pulse-slow {
    animation: pulse-slow 2s ease-in-out infinite;
  }
`;

// Inject styles if not already present
if (typeof document !== 'undefined' && !document.getElementById('notes-gamification-bar-styles')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'notes-gamification-bar-styles';
  styleEl.textContent = customStyles;
  document.head.appendChild(styleEl);
}

// Export hook for triggering badge notifications externally
export function useGamificationBar() {
  return {
    triggerBadgeNotification: (badgeId: string, badgeName: string, badgeEmoji: string) => {
      // This would be used by parent components to trigger notifications
      console.log('Badge unlocked:', badgeId, badgeName);
    },
  };
}
