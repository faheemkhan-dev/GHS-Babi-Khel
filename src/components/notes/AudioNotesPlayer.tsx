/**
 * AudioNotesPlayer.tsx
 *
 * Feature 1.7: Audio Notes & Podcast Mode
 *
 * - Plays pre-recorded audio for each chapter (audio_url from admin upload)
 * - Speed control (0.75x – 2x)
 * - Background playback on mobile (uses Media Session API)
 * - Offline caching via Cache API
 * - Podcast Mode: plays all chapter audios sequentially
 * - Full mobile-friendly design with bottom sheet player
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  X, ListMusic, Download, WifiOff, ChevronUp, ChevronDown,
  Headphones, Radio, Loader2
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AudioChapter {
  id: string;
  title: string;
  audio_url: string | null;
  /** Free-text chapter label ("1", "1-12", "All chapters") — display only. */
  chapter_number: string;
}

interface AudioNotesPlayerProps {
  /** Current chapter's audio URL */
  audioUrl: string | null;
  /** Current chapter title */
  chapterTitle: string;
  /** All chapters in this subject (for podcast mode) */
  chapters: AudioChapter[];
  /** Subject color for theming */
  subjectColor: string;
  /** Subject emoji */
  subjectEmoji: string;
  /** Callback when audio finishes */
  onAudioEnd?: () => void;
  /** Compact trigger style for use inside a horizontal bottom action row
   *  (icon + tiny label, no background pill) instead of the default
   *  floating round button. Only affects the closed/trigger state. */
  compact?: boolean;
}

// ─── Offline Cache Manager ────────────────────────────────────────────────────

const AUDIO_CACHE_NAME = "ocean-audio-cache-v1";

async function getCachedAudioUrl(url: string): Promise<string | null> {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = await cache.match(url);
    if (response) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch { /* intentional */ }
  return null;
}

async function cacheAudioFile(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = await fetch(url);
    if (response.ok) {
      await cache.put(url, response.clone());
      return true;
    }
  } catch { /* intentional */ }
  return false;
}

async function isAudioCached(url: string): Promise<boolean> {
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const response = await cache.match(url);
    return !!response;
  } catch { /* intentional */ }
  return false;
}

// ─── Format time helper ──────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Speed Options ────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

// ─── Mini Player (bottom bar) ────────────────────────────────────────────────

const MiniPlayer = ({
  isPlaying, chapterTitle, subjectColor, currentTime, duration,
  onPlayPause, onExpand,
}: {
  isPlaying: boolean; chapterTitle: string; subjectColor: string;
  currentTime: number; duration: number;
  onPlayPause: () => void; onExpand: () => void;
}) => {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <motion.div
      initial={{ y: 80 }}
      animate={{ y: 0 }}
      exit={{ y: 80 }}
      className="fixed bottom-14 lg:bottom-4 left-0 right-0 z-40 px-3 lg:px-0 lg:left-auto lg:right-4 lg:w-96"
    >
      <div
        className="bg-card/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={onExpand}
        style={{ cursor: "pointer" }}
      >
        {/* Progress bar at top */}
        <div className="h-0.5 bg-muted">
          <div className="h-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: subjectColor }} />
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={(e) => { e.stopPropagation(); onPlayPause(); }}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-white"
            style={{ backgroundColor: subjectColor }}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{chapterTitle}</p>
            <p className="text-[10px] text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(duration)}
            </p>
          </div>
          <Headphones className="w-4 h-4 text-muted-foreground shrink-0" />
        </div>
      </div>
    </motion.div>
  );
};

// ─── Full Player (expanded) ──────────────────────────────────────────────────

const FullPlayer = ({
  isPlaying, chapterTitle, currentTime, duration, speed, isMuted,
  subjectColor, subjectEmoji, audioUrl, cached, podcastMode,
  chapters, currentChapterIdx, downloading,
  onPlayPause, onSeek, onSpeedChange, onMuteToggle,
  onClose, onSkipBack, onSkipForward, onPodcastToggle,
  onChapterSelect, onDownload, onMini,
}: {
  isPlaying: boolean; chapterTitle: string; currentTime: number; duration: number;
  speed: number; isMuted: boolean; subjectColor: string; subjectEmoji: string;
  audioUrl: string | null; cached: boolean; podcastMode: boolean;
  chapters: AudioChapter[]; currentChapterIdx: number; downloading: boolean;
  onPlayPause: () => void; onSeek: (pct: number) => void; onSpeedChange: (s: number) => void;
  onMuteToggle: () => void; onClose: () => void; onSkipBack: () => void;
  onSkipForward: () => void; onPodcastToggle: () => void;
  onChapterSelect: (idx: number) => void; onDownload: () => void; onMini: () => void;
}) => {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const playableChapters = chapters.filter(c => c.audio_url);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center"
      onClick={onMini}
    >
      <motion.div
        initial={{ y: typeof window !== "undefined" && window.innerWidth < 640 ? "100%" : 0, scale: 0.9, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: typeof window !== "undefined" && window.innerWidth < 640 ? "100%" : 0, scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="bg-card border border-border rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg"
              style={{ backgroundColor: `${subjectColor}20` }}>
              {podcastMode ? <Radio className="w-4 h-4" style={{ color: subjectColor }} /> : subjectEmoji}
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {podcastMode ? "Podcast Mode" : "Audio Notes"}
              </h3>
              <p className="text-[10px] text-muted-foreground">
                {podcastMode ? `${playableChapters.length} chapters queued` : "Listen while you read"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onMini} className="p-1.5 hover:bg-secondary rounded-lg" title="Minimize">
              <ChevronDown className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-secondary rounded-lg" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Chapter info */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="w-20 h-20 rounded-2xl mx-auto mb-3 flex items-center justify-center text-4xl shadow-inner"
            style={{ backgroundColor: `${subjectColor}15` }}>
            {podcastMode ? "🎧" : subjectEmoji}
          </div>
          <p className="text-base font-bold text-foreground truncate">{chapterTitle}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Chapter {currentChapterIdx + 1} of {playableChapters.length} • {formatTime(duration)}
          </p>
        </div>

        {/* Progress / Seek */}
        <div className="px-5 py-2">
          <input
            type="range"
            min={0}
            max={100}
            value={progress}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary"
            style={{ accentColor: subjectColor }}
          />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">{formatTime(currentTime)}</span>
            <span className="text-[10px] text-muted-foreground">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 px-5 py-2">
          <button onClick={onSkipBack}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-secondary transition-colors"
            title="Previous chapter">
            <SkipBack className="w-5 h-5" />
          </button>
          <button onClick={onPlayPause}
            className="w-14 h-14 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105"
            style={{ backgroundColor: subjectColor }}>
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
          <button onClick={onSkipForward}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-secondary transition-colors"
            title="Next chapter">
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        {/* Speed + Mute + Download row */}
        <div className="flex items-center justify-center gap-2 px-5 py-2 flex-wrap">
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                speed === s
                  ? "text-white shadow-sm"
                  : "bg-secondary text-muted-foreground hover:bg-secondary/70"
              }`}
              style={speed === s ? { backgroundColor: subjectColor } : {}}
            >
              {s}x
            </button>
          ))}
          <button onClick={onMuteToggle} className="p-1.5 rounded-lg hover:bg-secondary ml-1" title={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? <VolumeX className="w-4 h-4 text-muted-foreground" /> : <Volume2 className="w-4 h-4" />}
          </button>
          {audioUrl && (
            <button onClick={onDownload} disabled={downloading || cached}
              className={`p-1.5 rounded-lg hover:bg-secondary ml-1 ${cached ? "text-green-500" : ""}`}
              title={cached ? "Cached for offline" : "Download for offline"}>
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : cached ? <WifiOff className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            </button>
          )}
        </div>

        {/* Podcast Mode Toggle */}
        <div className="px-5 py-2">
          <button
            onClick={onPodcastToggle}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              podcastMode
                ? "text-white shadow-sm"
                : "bg-secondary text-muted-foreground hover:bg-secondary/70"
            }`}
            style={podcastMode ? { backgroundColor: subjectColor } : {}}
          >
            {podcastMode ? <Radio className="w-4 h-4" /> : <ListMusic className="w-4 h-4" />}
            {podcastMode ? "Podcast Mode ON" : "Start Podcast Mode"}
          </button>
        </div>

        {/* Podcast playlist */}
        {podcastMode && playableChapters.length > 0 && (
          <div className="flex-1 overflow-y-auto px-3 pb-4 max-h-48">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-2 py-2">Up Next</p>
            {playableChapters.map((ch, i) => {
              const globalIdx = chapters.indexOf(ch);
              const isCurrent = globalIdx === currentChapterIdx;
              return (
                <button
                  key={ch.id}
                  onClick={() => onChapterSelect(globalIdx)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all ${
                    isCurrent ? "bg-primary/10 border border-primary/30" : "hover:bg-secondary"
                  }`}
                >
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={isCurrent ? { backgroundColor: subjectColor, color: "white" } : { backgroundColor: "var(--muted)" }}>
                    {isCurrent ? <Play className="w-3 h-3" /> : ch.chapter_number}
                  </span>
                  <span className={`text-xs truncate ${isCurrent ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                    {ch.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

// ─── Main AudioNotesPlayer Component ─────────────────────────────────────────

const AudioNotesPlayer: React.FC<AudioNotesPlayerProps> = ({
  audioUrl,
  chapterTitle,
  chapters,
  subjectColor,
  subjectEmoji,
  onAudioEnd,
  compact = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSessionRef = useRef<boolean>(false);

  const [showPlayer, setShowPlayer] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [podcastMode, setPodcastMode] = useState(false);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(() =>
    chapters.findIndex(c => c.audio_url === audioUrl)
  );
  const [cached, setCached] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  const playableChapters = chapters.filter(c => c.audio_url);
  const currentChapter = chapters[currentChapterIdx];
  const currentAudioUrl = currentChapter?.audio_url || audioUrl;

  // Resolve URL (use cached version if available)
  useEffect(() => {
    if (!currentAudioUrl) { setResolvedUrl(null); return; }
    getCachedAudioUrl(currentAudioUrl).then((cachedUrl) => {
      if (cachedUrl) {
        setResolvedUrl(cachedUrl);
        setCached(true);
      } else {
        setResolvedUrl(currentAudioUrl);
        setCached(false);
      }
    });
  }, [currentAudioUrl]);

  // Check cache status
  useEffect(() => {
    if (!currentAudioUrl) return;
    isAudioCached(currentAudioUrl).then(setCached);
  }, [currentAudioUrl]);

  // Initialize audio element
  useEffect(() => {
    if (!resolvedUrl) return;

    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = resolvedUrl;
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration);
    });

    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
    });

    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      if (podcastMode) {
        // Auto-play next chapter in podcast mode
        const nextIdx = findNextPlayableChapter(currentChapterIdx);
        if (nextIdx !== -1) {
          setCurrentChapterIdx(nextIdx);
        } else {
          setPodcastMode(false);
          onAudioEnd?.();
        }
      } else {
        onAudioEnd?.();
      }
    });

    audio.addEventListener("play", () => setIsPlaying(true));
    audio.addEventListener("pause", () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedUrl]);

  // Apply speed changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed]);

  // Apply mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Media Session API for background playback on mobile
  useEffect(() => {
    if (!audioRef.current || !currentChapter) return;

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentChapter.title,
        artist: `${subjectEmoji} Ocean School Hub`,
        album: "Audio Notes",
      });

      navigator.mediaSession.setActionHandler("play", () => {
        audioRef.current?.play();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audioRef.current?.pause();
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        handleSkipBack();
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        handleSkipForward();
      });

      mediaSessionRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChapterIdx, currentChapter, subjectEmoji]);

  const findNextPlayableChapter = useCallback((fromIdx: number): number => {
    for (let i = fromIdx + 1; i < chapters.length; i++) {
      if (chapters[i].audio_url) return i;
    }
    return -1;
  }, [chapters]);

  const findPrevPlayableChapter = useCallback((fromIdx: number): number => {
    for (let i = fromIdx - 1; i >= 0; i--) {
      if (chapters[i].audio_url) return i;
    }
    return -1;
  }, [chapters]);

  const handlePlayPause = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  }, [isPlaying]);

  const handleSeek = useCallback((pct: number) => {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = (pct / 100) * duration;
  }, [duration]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s);
  }, []);

  const handleMuteToggle = useCallback(() => {
    setIsMuted(m => !m);
  }, []);

  const handleSkipBack = useCallback(() => {
    const prevIdx = findPrevPlayableChapter(currentChapterIdx);
    if (prevIdx !== -1) setCurrentChapterIdx(prevIdx);
  }, [currentChapterIdx, findPrevPlayableChapter]);

  const handleSkipForward = useCallback(() => {
    const nextIdx = findNextPlayableChapter(currentChapterIdx);
    if (nextIdx !== -1) setCurrentChapterIdx(nextIdx);
  }, [currentChapterIdx, findNextPlayableChapter]);

  const handleDownload = useCallback(async () => {
    if (!currentAudioUrl || downloading) return;
    setDownloading(true);
    const ok = await cacheAudioFile(currentAudioUrl);
    if (ok) setCached(true);
    setDownloading(false);
  }, [currentAudioUrl, downloading]);

  const handleChapterSelect = useCallback((idx: number) => {
    if (chapters[idx]?.audio_url) {
      const wasPlaying = isPlaying;
      if (audioRef.current) audioRef.current.pause();
      setCurrentChapterIdx(idx);
      setIsPlaying(false);
      // Auto-play after chapter switch
      setTimeout(() => {
        if (audioRef.current && wasPlaying) {
          audioRef.current.play().catch(() => {});
        }
      }, 300);
    }
  }, [chapters, isPlaying]);

  const handleClose = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setShowPlayer(false);
    setExpanded(false);
    setPodcastMode(false);
    setCurrentTime(0);
  }, []);

  // No audio URL available
  if (!currentAudioUrl) return null;

  return (
    <>
      {/* Floating audio button (replaces the old read aloud button) */}
      {!showPlayer && (
        compact ? (
          <button
            onClick={() => { setShowPlayer(true); setExpanded(false); }}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 w-full"
            title="Audio Notes"
          >
            <Volume2 className="w-5 h-5 text-blue-600" />
          </button>
        ) : (
          <button
            onClick={() => { setShowPlayer(true); setExpanded(false); }}
            className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors bg-primary text-primary-foreground hover:opacity-90"
            title="Audio Notes"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        )
      )}

      <AnimatePresence>
        {/* Mini player (bottom bar) */}
        {showPlayer && !expanded && (
          <MiniPlayer
            isPlaying={isPlaying}
            chapterTitle={currentChapter?.title || chapterTitle}
            subjectColor={subjectColor}
            currentTime={currentTime}
            duration={duration}
            onPlayPause={handlePlayPause}
            onExpand={() => setExpanded(true)}
          />
        )}

        {/* Full player */}
        {showPlayer && expanded && (
          <FullPlayer
            isPlaying={isPlaying}
            chapterTitle={currentChapter?.title || chapterTitle}
            currentTime={currentTime}
            duration={duration}
            speed={speed}
            isMuted={isMuted}
            subjectColor={subjectColor}
            subjectEmoji={subjectEmoji}
            audioUrl={currentAudioUrl}
            cached={cached}
            podcastMode={podcastMode}
            chapters={chapters}
            currentChapterIdx={currentChapterIdx}
            downloading={downloading}
            onPlayPause={handlePlayPause}
            onSeek={handleSeek}
            onSpeedChange={handleSpeedChange}
            onMuteToggle={handleMuteToggle}
            onClose={handleClose}
            onSkipBack={handleSkipBack}
            onSkipForward={handleSkipForward}
            onPodcastToggle={() => setPodcastMode(p => !p)}
            onChapterSelect={handleChapterSelect}
            onDownload={handleDownload}
            onMini={() => setExpanded(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
};

export default AudioNotesPlayer;
