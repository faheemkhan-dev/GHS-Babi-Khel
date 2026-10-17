import { useState, useEffect } from "react";
import { useWeeklyLeaderboard, useLeaderboard, useGamification, useMyHouse, useHouses, useJoinHouse, getRankOf, BADGES, type BadgeTier } from "@/hooks/useNotes";
import { useAuth } from "@/hooks/useAuth";
import { 
  Trophy, Medal, Star, Flame, Crown, Zap, Target, BookOpen, Award, Home, Users,
  Lock, TrendingUp, Calendar, Gem, Swords, Sparkles, Shield, ChevronRight
} from "lucide-react";

type LeaderboardTab = "weekly" | "alltime" | "houses" | "badges";

function getMotivationalMessage(rank: number | null): { emoji: string; message: string; color: string } {
  if (rank === 1) return { emoji: "👑", message: "You're the Champion!", color: "text-yellow-500" };
  if (rank === 2) return { emoji: "🥈", message: "So close to the top!", color: "text-gray-400" };
  if (rank === 3) return { emoji: "🥉", message: "You're on the podium!", color: "text-amber-600" };
  if (rank && rank <= 10) return { emoji: "🔥", message: "You're in the elite!", color: "text-orange-500" };
  if (rank && rank <= 25) return { emoji: "⭐", message: "Great progress! Keep going!", color: "text-blue-500" };
  return { emoji: "💪", message: "Keep studying to climb the ranks!", color: "text-green-500" };
}

function AnimatedFire({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-block animate-pulse">
      <Flame size={size} className="text-orange-500 fill-orange-500" />
    </span>
  );
}

function PodiumDisplay({ data, currentUserId }: { data: any[]; currentUserId?: string }) {
  const top3 = data.slice(0, 3);
  const positions = [
    { pos: 2, data: top3[1], emoji: "🥈", colors: "from-gray-300 to-gray-400 text-gray-800", ring: "ring-gray-300", height: "h-24 sm:h-28" },
    { pos: 1, data: top3[0], emoji: "🥇", colors: "from-yellow-300 to-amber-400 text-yellow-900", ring: "ring-yellow-300", height: "h-32 sm:h-36 glow-gold" },
    { pos: 3, data: top3[2], emoji: "🥉", colors: "from-amber-400 to-orange-500 text-amber-900", ring: "ring-amber-400", height: "h-16 sm:h-20" },
  ];
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-4 py-6 px-2">
      {positions.map(({ pos, data: entry, emoji, colors, ring, height }) => (
        <div key={pos} className="flex flex-col items-center flex-1 max-w-[120px]">
          <div className={`relative mb-2 ${pos === 1 ? 'order-first' : ''}`}>
            <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center text-2xl font-bold bg-gradient-to-br ${colors} ring-4 ${ring} shadow-lg ${entry?.user_id === currentUserId ? 'ring-4 ring-blue-400 ring-offset-2 ring-offset-background' : ''} ${pos === 1 ? 'animate-bounce-slow' : ''}`}>
              {emoji}
            </div>
            {pos === 1 && <Crown className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 text-yellow-400 drop-shadow-lg animate-pulse" />}
          </div>
          <p className="text-xs sm:text-sm font-semibold text-center truncate w-full px-1">{entry?.full_name || "—"}</p>
          <p className="text-sm font-bold text-primary">{entry ? (entry.total_points ?? entry.weekly_points ?? 0) : 0} pts</p>
          {entry?.badges?.length > 0 && <div className="flex items-center gap-1 mt-0.5 text-[10px] text-purple-600 dark:text-purple-400"><Award size={10} /> {entry.badges.length}</div>}
          {entry?.streak_days > 0 && <div className="flex items-center gap-1 mt-0.5"><AnimatedFire size={12} /><span className="text-xs text-orange-600 dark:text-orange-400">{entry.streak_days}</span></div>}
          <div className={`w-full rounded-t-lg bg-gradient-to-t ${colors} flex items-center justify-center ${height} mt-2 shadow-md transition-all duration-300 hover:shadow-lg`}>
            <span className="text-lg sm:text-xl font-black opacity-80">#{pos}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MyRankStrip({ rank, myHouse }: { rank: number | null; myHouse: any }) {
  if (!rank) return null;
  const motivational = getMotivationalMessage(rank);
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/50 dark:border-blue-800/30 text-sm">
      <span className={`font-bold ${motivational.color}`}>{motivational.emoji}</span>
      <span className="font-semibold">You're ranked #{rank}</span>
      <span className="text-muted-foreground hidden sm:inline">— {motivational.message}</span>
      {myHouse?.houses && (
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Home className="w-3.5 h-3.5" style={{ color: myHouse.houses.color }} />
          {myHouse.houses.emoji} {myHouse.houses.name}
        </span>
      )}
    </div>
  );
}

function LeaderboardRow({ entry, index, isCurrentUser }: { entry: any; index: number; isCurrentUser: boolean }) {
  const rank = index + 1;
  const getRankStyle = () => {
    if (rank === 1) return "bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20 border-l-4 border-yellow-500";
    if (rank === 2) return "bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-900/20 dark:to-slate-900/20 border-l-4 border-gray-400";
    if (rank === 3) return "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border-l-4 border-amber-600";
    if (isCurrentUser) return "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border-l-4 border-blue-500";
    return "hover:bg-muted/50";
  };
  const getRankBadge = () => {
    if (rank === 1) return <Medal className="w-5 h-5 text-yellow-500 fill-yellow-500" />;
    if (rank === 2) return <Medal className="w-5 h-5 text-gray-400 fill-gray-400" />;
    if (rank === 3) return <Medal className="w-5 h-5 text-amber-600 fill-amber-600" />;
    return <span className="text-sm font-mono text-muted-foreground w-5 text-center">{rank}</span>;
  };
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${getRankStyle()}`}>
      <div className="w-8 flex justify-center">{getRankBadge()}</div>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${rank <= 3 ? 'bg-gradient-to-br from-primary to-primary/70 text-white' : 'bg-muted'}`}>
        {entry.full_name?.charAt(0)?.toUpperCase() || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold truncate ${isCurrentUser ? 'text-primary' : ''}`}>
          {entry.full_name || 'Anonymous'}{isCurrentUser && <span className="text-xs ml-1 text-muted-foreground">(you)</span>}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {entry.streak_days > 0 && <span className="flex items-center gap-0.5"><Flame size={10} className="text-orange-500 fill-orange-500" />{entry.streak_days}</span>}
          <span>{entry.badges?.length || 0} badges</span>
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-primary">{entry.total_points ?? entry.weekly_points ?? 0}</p>
        <p className="text-xs text-muted-foreground">pts</p>
      </div>
    </div>
  );
}

// ─── Houses Tab Content — beautiful, no name truncation ────────────────────────
function HousesContent() {
  const { user } = useAuth();
  const { data: houses, isLoading } = useHouses();
  const { data: myHouse } = useMyHouse(user?.id);
  const joinHouse = useJoinHouse();
  const [joiningId, setJoiningId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl" />)}
      </div>
    );
  }
  if (!houses || houses.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Home className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No houses set up yet.</p>
      </div>
    );
  }

  const handleJoin = async (houseId: string) => {
    if (!user) return;
    setJoiningId(houseId);
    try { await joinHouse.mutateAsync({ houseId, userId: user.id }); } finally { setJoiningId(null); }
  };

  return (
    <div className="space-y-3">
      {!myHouse && user && (
        <p className="text-xs text-center text-muted-foreground pb-1">
          Pick a house below to join — you can switch anytime.
        </p>
      )}
      {houses.map((house, i) => {
        const isMine = myHouse?.house_id === house.id;
        return (
          <div key={house.id} className={`
            flex items-center gap-3 p-4 rounded-2xl bg-card border shadow-sm
            hover:shadow-lg transition-all duration-300
            ${isMine ? "ring-2 ring-primary border-primary/30" : ""}
          `}>
            {/* Emoji avatar — bigger, more vibrant */}
            <div className="flex items-center justify-center w-14 h-14 rounded-xl text-3xl shrink-0 shadow-inner"
                 style={{ backgroundColor: house.color + '18', border: `2px solid ${house.color}30` }}>
              {house.emoji}
            </div>
            {/* Name + info — NO truncate, allow full name */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base">{house.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                      style={{ backgroundColor: house.color + '20', color: house.color }}>#{i + 1}</span>
                {isMine && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-semibold shrink-0">Your House</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{house.member_count ?? 0} members</p>
            </div>
            {/* Points */}
            <div className="text-right shrink-0">
              <p className="font-black text-xl" style={{ color: house.color }}>{house.total_points.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">points</p>
            </div>
            {user && !isMine && (
              <button onClick={() => handleJoin(house.id)} disabled={joiningId === house.id}
                className="ml-1 shrink-0 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors shadow-sm">
                {joiningId === house.id ? "…" : "Join"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Badges Grid — 5 tiers ────────────────────────────────────────────────────
const TIER_META: Record<BadgeTier, { label: string; color: string; icon: React.ReactNode; glow: string }> = {
  easy:      { label: "Easy",      color: "text-green-600 dark:text-green-400",       icon: <Star className="w-4 h-4" />,     glow: "from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30" },
  normal:    { label: "Normal",    color: "text-blue-600 dark:text-blue-400",         icon: <Zap className="w-4 h-4" />,     glow: "from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30" },
  hard:      { label: "Hard",      color: "text-red-600 dark:text-red-400",          icon: <Flame className="w-4 h-4" />,   glow: "from-red-100 to-rose-100 dark:from-red-900/30 dark:to-rose-900/30" },
  epic:      { label: "Epic",      color: "text-purple-600 dark:text-purple-400",    icon: <Swords className="w-4 h-4" />,  glow: "from-purple-100 to-fuchsia-100 dark:from-purple-900/30 dark:to-fuchsia-900/30" },
  legendary: { label: "Legendary", color: "text-yellow-600 dark:text-yellow-400",    icon: <Crown className="w-4 h-4" />,   glow: "from-yellow-100 to-amber-100 dark:from-yellow-900/30 dark:to-amber-900/30" },
};

function BadgesGrid({ earnedBadges }: { earnedBadges: string[] }) {
  const tiers: BadgeTier[] = ["easy", "normal", "hard", "epic", "legendary"];
  return (
    <div className="space-y-8">
      {tiers.map((tier) => {
        const tierBadges = BADGES.filter((b) => b.tier === tier);
        if (tierBadges.length === 0) return null;
        const earnedCount = tierBadges.filter((b) => earnedBadges.includes(b.id)).length;
        const meta = TIER_META[tier];
        return (
          <div key={tier}>
            {/* Tier header */}
            <div className="flex items-center gap-2 mb-3 px-1">
              <span className={meta.color}>{meta.icon}</span>
              <span className={`text-sm font-black ${meta.color}`}>{meta.label}</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">{earnedCount}/{tierBadges.length}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {tierBadges.map((badge) => {
                const earned = earnedBadges.includes(badge.id);
                return (
                  <div key={badge.id} className={`
                    relative p-4 rounded-xl border text-center transition-all duration-300
                    ${earned 
                      ? `bg-gradient-to-br ${meta.glow} border-yellow-200 dark:border-yellow-800/50 shadow-md` 
                      : 'bg-muted/50 border-border opacity-50 grayscale'
                    }
                    hover:scale-105 hover:shadow-lg
                  `}>
                    {!earned && <Lock className="absolute top-2 right-2 w-3.5 h-3.5 text-muted-foreground/50" />}
                    <div className={`text-3xl mb-2 ${!earned && 'grayscale opacity-40'}`}>{badge.emoji}</div>
                    <p className={`font-bold text-sm ${earned ? '' : 'text-muted-foreground'}`}>{badge.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{badge.desc}</p>
                    {earned && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow-sm">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Study Session Card (moved here from chapter top) ──────────────────────────
function ProgressRing({ progress, size = 40, strokeWidth = 4 }: { progress: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/30" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        className="text-primary transition-all duration-500 ease-out" />
      <text x="50%" y="50%" textAnchor="middle" dy=".3em" className="fill-current text-xs font-bold" transform={`rotate(90 ${size / 2} ${size / 2})`}>
        {Math.round(progress)}%
      </text>
    </svg>
  );
}

function StatPill({ icon, value, label, highlight = false, color = "blue" }: { icon: React.ReactNode; value: string; label: string; highlight?: boolean; color?: string }) {
  const colorClasses: Record<string, string> = {
    orange: highlight ? 'bg-orange-100 dark:bg-orange-900/50 ring-2 ring-orange-300 dark:ring-orange-700' : 'bg-white/50 dark:bg-white/5',
    green: highlight ? 'bg-green-100 dark:bg-green-900/50 ring-2 ring-green-300 dark:ring-green-700' : 'bg-white/50 dark:bg-white/5',
    yellow: 'bg-white/50 dark:bg-white/5',
    blue: 'bg-white/50 dark:bg-white/5',
  };
  return (
    <div className={`flex flex-col items-center p-1.5 rounded-lg transition-all duration-300 ${colorClasses[color]} ${highlight ? 'animate-pulse-slow' : ''}`}>
      <div className="flex items-center gap-1">{icon}</div>
      <span className="text-xs font-semibold leading-tight">{value}</span>
      <span className="text-[9px] text-muted-foreground leading-tight text-center">{label}</span>
    </div>
  );
}

function StudySessionCard({ sessionPoints = 0, chaptersCompleted = 0 }: { sessionPoints?: number; chaptersCompleted?: number }) {
  const { user } = useAuth();
  const { data: gamification } = useGamification(user?.id);
  const [showDetails, setShowDetails] = useState(false);
  const [startTime] = useState(() => new Date());
  const [sessionDuration, setSessionDuration] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSessionDuration(Math.floor((Date.now() - startTime.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentPoints = gamification?.total_points || 0;
  const nextMilestone = Math.ceil(currentPoints / 100) * 100;
  const progressToNextRank = ((currentPoints % 100) / 100) * 100;

  return (
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
        <StatPill icon={<Flame size={13} className="text-orange-500 fill-orange-500" />} value={`${gamification?.streak_days || 0}`} label="Streak" highlight={(gamification?.streak_days || 0) >= 7} color="orange" />
        <StatPill icon={<Star size={13} className="text-green-500 fill-green-500" />} value={`+${sessionPoints}`} label="Session" highlight={sessionPoints >= 50} color="green" />
        <StatPill icon={<Trophy size={13} className="text-yellow-500" />} value={currentPoints.toLocaleString()} label="Total" color="yellow" />
        <StatPill icon={<Target size={13} className="text-blue-500" />} value={chaptersCompleted.toString()} label="Chapters" color="blue" />
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
              <div className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full transition-all duration-500" style={{ width: `${progressToNextRank}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Expanded Details */}
      {showDetails && (
        <div className="mt-2 pt-2 border-t border-white/20 dark:border-white/10 space-y-2 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white/30 dark:bg-black/10">
            <Award size={13} className="text-purple-500 shrink-0" />
            <span className="text-[10px] text-muted-foreground flex-1">Badges: {gamification?.badges?.length || 0} earned</span>
            <div className="flex -space-x-1">
              {(gamification?.badges || []).slice(0, 4).map((badge: string, i: number) => (
                <div key={i} className="w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/50 flex items-center justify-center text-[10px] border-2 border-background">🏆</div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-slow { 0%, 100% { opacity: 1; } 50% { opacity: 0.8; } }
        .animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ─── Main NotesLeaderboard Component ────────────────────────────────────────────
interface NotesLeaderboardProps {
  /** Points earned in current chapter-viewing session (external) */
  sessionPoints?: number;
  /** Chapters completed in this session */
  chaptersCompleted?: number;
}

export default function NotesLeaderboard({ sessionPoints = 0, chaptersCompleted = 0 }: NotesLeaderboardProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<LeaderboardTab>("weekly");
  
  const { data: weeklyData, isLoading: weeklyLoading } = useWeeklyLeaderboard();
  const { data: allTimeData, isLoading: allTimeLoading } = useLeaderboard();
  const { data: gamification } = useGamification(user?.id);
  const { data: myHouse } = useMyHouse(user?.id);

  const isLoading = activeTab === "weekly" ? weeklyLoading : allTimeLoading;
  const currentData = activeTab === "weekly" ? weeklyData : allTimeData;
  const myRank = getRankOf(currentData, user?.id);

  const tabs: { id: LeaderboardTab; label: string; icon: React.ReactNode }[] = [
    { id: "weekly", label: "Weekly", icon: <Calendar className="w-4 h-4" /> },
    { id: "alltime", label: "All Time", icon: <Trophy className="w-4 h-4" /> },
    { id: "houses", label: "Houses", icon: <Home className="w-4 h-4" /> },
    { id: "badges", label: "My Badges", icon: <Gem className="w-4 h-4" /> },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Study Session — moved here from chapter top */}
      {user && <StudySessionCard sessionPoints={sessionPoints} chaptersCompleted={chaptersCompleted} />}

      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-100 to-amber-100 
                        dark:from-yellow-900/30 dark:to-amber-900/30 rounded-full">
          <Trophy className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
          <span className="font-bold text-yellow-800 dark:text-yellow-200">Notes Leaderboard</span>
        </div>
        <p className="text-sm text-muted-foreground">Compete with classmates and earn rewards!</p>
      </div>

      {/* My Rank strip */}
      {(activeTab === "weekly" || activeTab === "alltime") && <MyRankStrip rank={myRank} myHouse={myHouse} />}

      {/* Tab Navigation */}
      <div className="flex flex-wrap justify-center gap-2 p-1 bg-muted/50 rounded-xl">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${activeTab === tab.id ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[300px]">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}</div>
        ) : activeTab === "houses" ? (
          <HousesContent />
        ) : activeTab === "badges" ? (
          <BadgesGrid earnedBadges={gamification?.badges || []} />
        ) : (
          <>
            {currentData && currentData.length >= 3 && <PodiumDisplay data={currentData} currentUserId={user?.id} />}
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {(currentData || []).map((entry, index) => (
                <LeaderboardRow key={entry.user_id} entry={entry} index={index} isCurrentUser={entry.user_id === user?.id} />
              ))}
              {(!currentData || currentData.length === 0) && (
                <div className="text-center py-12 text-muted-foreground">
                  <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No one has earned points yet. Be the first — start studying now!</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes bounce-slow { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        .animate-bounce-slow { animation: bounce-slow 2s ease-in-out infinite; }
        .glow-gold { box-shadow: 0 0 20px rgba(234, 179, 8, 0.4), 0 0 40px rgba(234, 179, 8, 0.2); }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--muted)); border-radius: 3px; }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      `}</style>
    </div>
  );
}
