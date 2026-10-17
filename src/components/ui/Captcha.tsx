// components/ui/Captcha.tsx
// SECURITY FIX: Problem 24 - Advanced Anti-Bot CAPTCHA System
// Multi-layer CAPTCHA: Math + Logic + Pattern + Behavior Analysis
// 100% FREE, No external services required

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';

// CAPTCHA Types for variety and increased difficulty
type CaptchaType = 'math' | 'logic' | 'pattern' | 'word' | 'calculation';

interface CaptchaChallenge {
  type: CaptchaType;
  question: string;
  answer: string | number;
  hint?: string;
  options?: string[]; // For multiple choice
  imageData?: string; // For pattern/image based
}

interface CaptchaProps {
  onVerify: (isValid: boolean, token: string) => void;
  onError?: (error: string) => void;
  className?: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'extreme';
}

// Generate random number in range
const randomInt = (min: number, max: number): number => 
  Math.floor(Math.random() * (max - min + 1)) + min;

// Shuffle array
const shuffleArray = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Obfuscate text for display (prevent OCR bots)
const obfuscateText = (text: string): string => {
  // Add random spaces, use unicode lookalikes, rotate characters visually via CSS
  return text.split('').map((char, i) => {
    if (Math.random() > 0.7 && char !== ' ') {
      // Randomly add zero-width characters or use similar unicode
      const variations = [
        char,
        // Unicode confusables for numbers
        '₀','₁','₂','₃','₄','₅','₆','₇','₈','₉',
        // Full-width characters
      ];
      if (/^[0-9]$/.test(char) && Math.random() > 0.5) {
        return ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'][parseInt(char)];
      }
    }
    return char;
  }).join('');
};

// CAPTCHA Challenge Generators
const generateMathChallenge = (difficulty: string): CaptchaChallenge => {
  const ops = ['+', '-', '×'];
  
  switch(difficulty) {
    case 'easy': {
      const a = randomInt(1, 10);
      const b = randomInt(1, 10);
      const op = ops[randomInt(0, 1)]; // Only + or -
      let answer: number;
      switch(op) {
        case '+': answer = a + b; break;
        case '-': answer = a - b; break;
        default: answer = a + b;
      }
      return {
        type: 'math',
        question: `${a} ${op} ${b} = ?`,
        answer: answer.toString()
      };
    }
    
    case 'medium': {
      const a = randomInt(10, 50);
      const b = randomInt(2, 20);
      const op = ops[randomInt(0, 2)];
      let answer: number;
      switch(op) {
        case '+': answer = a + b; break;
        case '-': answer = a - b; break;
        case '×': answer = a * b; break;
        default: answer = a + b;
      }
      return {
        type: 'math',
        question: `${a} ${op} ${b} = ?`,
        answer: answer.toString(),
        hint: 'Calculate the result'
      };
    }
    
    case 'hard': {
      const a = randomInt(20, 100);
      const b = randomInt(5, 30);
      const c = randomInt(2, 10);
      const operations = [
        () => ({ q: `(${a} + ${b}) × ${c}`, a: (a + b) * c }),
        () => ({ q: `${a} × ${b} + ${c}`, a: a * b + c }),
        () => ({ q: `${a} - ${b} × ${c}`, a: a - b * c }),
      ];
      const selected = operations[randomInt(0, operations.length - 1)]();
      return {
        type: 'math',
        question: `${selected.q} = ?`,
        answer: selected.a.toString(),
        hint: 'Remember order of operations'
      };
    }
    
    case 'extreme': {
      const a = randomInt(50, 200);
      const b = randomInt(20, 80);
      const c = randomInt(3, 15);
      const d = randomInt(2, 8);
      const operations = [
        () => ({ q: `(${a} ÷ ${c}) + (${b} × ${d})`, a: Math.round(a / c) + b * d }),
        () => ({ q: `${a} - (${b} + ${c}) × ${d}`, a: a - (b + c) * d }),
        () => ({ q: `((${a} + ${b}) × ${c}) ÷ ${d}`, a: ((a + b) * c) / d }),
      ];
      const selected = operations[randomInt(0, operations.length - 1)]();
      return {
        type: 'math',
        question: `${selected.q} = ? (round to nearest integer)`,
        answer: Math.round(selected.a).toString(),
        hint: 'PEMDAS: Parentheses, Exponents, Multiplication/Division, Addition/Subtraction'
      };
    }
    
    default:
      return generateMathChallenge('easy');
  }
};

const generateLogicChallenge = (difficulty: string): CaptchaChallenge => {
  const logicPuzzles = {
    easy: [
      { q: 'What comes next? A, C, E, G, ?', a: 'I', hint: 'Every other letter of alphabet' },
      { q: 'If 2 cats catch 2 mice in 2 minutes, how many cats catch 8 mice in 8 minutes?', a: '2', hint: 'Same rate' },
      { q: 'What is 3 × 3 + 3?', a: '12', hint: 'Order matters' },
    ],
    medium: [
      { q: 'A farmer has 17 sheep. All but 9 die. How many are left?', a: '9', hint: '"All but 9"' },
      { q: 'Month has 28 days. How many have 28?', a: '12', hint: 'All months!' },
      { q: 'If you have 3 apples and take away 2, how many do you have?', a: '2', hint: 'You TOOK them' },
    ],
    hard: [
      { q: 'What is the next number? 1, 1, 2, 3, 5, 8, ?', a: '13', hint: 'Fibonacci sequence' },
      { q: 'How many squares on a chessboard?', a: '64', hint: '8×8 grid' },
      { q: 'If it takes 5 machines 5 mins to make 5 widgets, how long for 100 machines to make 100 widgets?', a: '5', hint: 'Same time per widget' },
    ],
    extreme: [
      { q: 'A bat and ball cost $1.10. Bat costs $1.00 more than ball. Ball costs?', a: '0.05', hint: 'Set up equation' },
      { q: 'If you fold a paper 42 times (if possible), how thick? Assume 0.1mm per sheet.', a: '439804km', hint: 'Doubles each fold' },
      { q: 'How many ways to arrange letters in "SECURITY"?', a: '40320', hint: '8! permutations' },
    ]
  };
  
  const puzzles = logicPuzzles[difficulty as keyof typeof logicPuzzles] || logicPuzzles.easy;
  const puzzle = puzzles[randomInt(0, puzzles.length - 1)];
  
  return {
    type: 'logic',
    question: puzzle.q,
    answer: puzzle.a,
    hint: puzzle.hint,
    options: shuffleArray([puzzle.a, ...Array.from({length: 3}, () => 
      (parseFloat(puzzle.a) + randomInt(-10, 10)).toString()
    )]).slice(0, 4)
  };
};

const generatePatternChallenge = (difficulty: string): CaptchaChallenge => {
  const patterns = {
    easy: [
      { seq: '▲, ●, ▲, ●, ▲, ?', a: '●', hint: 'Alternating shapes' },
      { seq: '1, 2, 3, 4, 5, ?', a: '6', hint: 'Count up by 1' },
      { seq: '○ ○ ● ● ○ ○ ?', a: '●', hint: 'Pattern repeats' },
    ],
    medium: [
      { seq: '2, 6, 18, 54, ?', a: '162', hint: 'Multiply by 3' },
      { seq: 'A, C, F, J, O, ?', a: 'U', hint: '+2, +3, +4, +5, +6' },
      { seq: '↑ → ↓ ← ↑ → ?', a: '↓', hint: 'Clockwise direction' },
    ],
    hard: [
      { seq: '1, 4, 9, 16, 25, ?', a: '36', hint: 'Perfect squares' },
      { seq: '🌑 🌒 🌓 🌔 🌕 ?', a: '🌖', hint: 'Moon phases' },
      { seq: '♣ ♠ ♥ ♦ ♣ ♠ ?', a: '♥', hint: 'Suit cycle' },
    ],
    extreme: [
      { seq: '1, 11, 21, 1211, 111221, ?', a: '312211', hint: 'Look-and-say sequence' },
      { seq: 'M, T, W, T, F, S, ?', a: 'S', hint: 'Days of week' },
      { seq: 'α β γ δ ε ζ η ?', a: 'θ', hint: 'Greek alphabet' },
    ]
  };
  
  const patternList = patterns[difficulty as keyof typeof patterns] || patterns.easy;
  const pattern = patternList[randomInt(0, patternList.length - 1)];
  
  return {
    type: 'pattern',
    question: `Complete the pattern:\n${pattern.seq}`,
    answer: pattern.a,
    hint: pattern.hint,
    options: shuffleArray([pattern.a, ...Array.from({length: 3}, () => 
      (randomInt(1, 999)).toString()
    )]).slice(0, 4)
  };
};

const generateWordChallenge = (difficulty: string): CaptchaChallenge => {
  const words = {
    easy: [
      { scrambled: 'HLELO', answer: 'HELLO', hint: 'Greeting' },
      { scrambled: 'TREES', answer: 'TREE', hint: 'Plant' },
      { scrambled: 'OBOK', answer: 'BOOK', hint: 'You read this' },
    ],
    medium: [
      { scrambled: 'HCOSOL', answer: 'SCHOOL', hint: 'Place of learning' },
      { scrambled: 'TEMAH', answer: 'MATH', hint: 'Subject with numbers' },
      { scrambled: 'NOCITA', answer: 'ACTION', hint: 'Doing something' },
    ],
    hard: [
      { scrambled: 'YRSECUIT', answer: 'SECURITY', hint: 'Protection' },
      { scrambled: 'PTACHA', answer: 'CAPTCHA', hint: 'This puzzle!' },
      { scrambled: 'VIRFIEON', answer: 'VERIFICATION', hint: 'Proving identity' },
    ],
    extreme: [
      { scrambled: 'YPHROGRAPHING', answer: 'Cryptography', hint: 'Secret codes' },
      { scrambled: 'THUENACITIOIN', answer: 'AUTHENTICATION', hint: 'Login process' },
    ]
  };
  
  const wordList = words[difficulty as keyof typeof words] || words.easy;
  const word = wordList[randomInt(0, wordList.length - 1)];
  
  return {
    type: 'word',
    question: `Unscramble: ${word.scrambled}`,
    answer: word.answer,
    hint: word.hint
  };
};

// Main CAPTCHA Component
export const Captcha: React.FC<CaptchaProps> = ({
  onVerify,
  onError,
  className = '',
  difficulty = 'hard'
}) => {
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [timeStarted, setTimeStarted] = useState<number>(Date.now());
  const [token, setToken] = useState('');
  const [lastVerificationResult, setLastVerificationResult] = useState<boolean | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);

  // Keep refs current to avoid stale closures
  useEffect(() => {
    onVerifyRef.current = onVerify;
  }, [onVerify]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Generate secure token
  const generateToken = useCallback(() => {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }, []);

  // Generate new challenge. `autoFocus` defaults to true so an explicit
  // user action (clicking refresh, or a wrong-answer retry) still focuses
  // the input for convenience — but the initial page-load mount passes
  // false, so the CAPTCHA doesn't yank the page's scroll position down to
  // itself the instant the signup form appears (mobile browsers
  // auto-scroll to a newly focused input).
  const generateNewChallenge = useCallback((autoFocus: boolean = true) => {
    setIsVerified(false);
    setUserAnswer('');
    setShowHint(false);
    setTimeStarted(Date.now());
    setToken(generateToken());
    setLastVerificationResult(null);
    
    const generators = [
      generateMathChallenge,
      generateLogicChallenge,
      generatePatternChallenge,
      generateWordChallenge,
    ];
    
    // Pick random generator with weighted probability
    const weights = [0.35, 0.25, 0.25, 0.15]; // Math most common
    const random = Math.random();
    let cumulative = 0;
    let selectedIndex = 0;
    
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (random <= cumulative) {
        selectedIndex = i;
        break;
      }
    }
    
    const generator = generators[selectedIndex];
    setChallenge(generator(difficulty));
    setAttempts(0);
    
    if (autoFocus) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [difficulty, generateToken]);

  // Initialize challenge on mount — no auto-focus, so the signup page
  // doesn't jump/scroll to the CAPTCHA the moment it loads.
  useEffect(() => {
    generateNewChallenge(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bot detection: Check solving time (too fast = bot)
  const checkBotBehavior = (): boolean => {
    const timeTaken = Date.now() - timeStarted;
    
    // If solved in less than 1.5 seconds, likely a bot
    if (timeTaken < 1500) {
      console.warn('[CAPTCHA] Suspicious: Solved too fast');
      return true;
    }
    
    // Check for automation indicators
    if (navigator.webdriver) {
      console.warn('[CAPTCHA] WebDriver detected');
      return true;
    }
    
    return false;
  };

  // Verify answer — accepts an optional override so callers (like the
  // multiple-choice buttons) can verify the value they just picked
  // immediately, instead of relying on `userAnswer` state having
  // propagated yet.
  const verifyAnswer = useCallback((answerOverride?: string) => {
    const answerToCheck = answerOverride ?? userAnswer;
    
    if (!challenge || !answerToCheck.trim()) {
      onErrorRef.current?.('Please enter an answer');
      return;
    }

    setIsLoading(true);
    
    // Simulate small delay to prevent timing attacks
    setTimeout(() => {
      const normalizedAnswer = answerToCheck.trim().toUpperCase();
      const correctAnswer = challenge.answer.toString().toUpperCase();
      const isCorrect = normalizedAnswer === correctAnswer;
      
      // Bot behavior check
      const isSuspicious = checkBotBehavior();
      
      if (isCorrect && !isSuspicious) {
        setIsVerified(true);
        setLastVerificationResult(true);
        // Use ref to call latest onVerify to avoid stale closure issues
        onVerifyRef.current(true, token);
        
        // Auto-refresh after successful verification (optional)
        // Uncomment if you want fresh CAPTCHA each time:
        // setTimeout(generateNewChallenge, 5000);
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        setLastVerificationResult(false);
        
        if (newAttempts >= 3) {
          // After 3 failed attempts, generate new challenge
          onErrorRef.current?.('Too many incorrect attempts. New challenge generated.');
          generateNewChallenge();
        } else if (isSuspicious) {
          onErrorRef.current?.('Suspicious activity detected. Please try again.');
          generateNewChallenge();
        } else {
          onErrorRef.current?.(`Incorrect. ${3 - newAttempts} attempts remaining.`);
          setUserAnswer('');
          setShowHint(true); // Show hint after first wrong attempt
          inputRef.current?.focus();
        }
        
        onVerifyRef.current(false, '');
      }
      
      setIsLoading(false);
    }, 300 + Math.random() * 200); // Random delay 300-500ms
  }, [challenge, userAnswer, attempts, token, checkBotBehavior, generateNewChallenge]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isVerified) {
      e.preventDefault();
      verifyAnswer();
    }
  };

  // Handle option click (for multiple choice)
  const handleOptionClick = (option: string) => {
    setUserAnswer(option);
    verifyAnswer(option); // pass the value directly — no stale-closure race
  };

  if (!challenge) {
    return (
      <div className={`captcha-loading ${className}`}>
        <RefreshCw className="animate-spin w-6 h-6" />
        <span>Loading security verification...</span>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className={`captcha-container bg-card border-2 rounded-xl p-4 shadow-sm ${
        isVerified ? 'border-green-300 dark:border-green-700' : 'border-border'
      } ${className}`}
      data-captcha-type={challenge.type}
      data-captcha-difficulty={difficulty}
      data-captcha-verified={isVerified}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`w-5 h-5 ${isVerified ? 'text-green-600' : 'text-primary'}`} />
          <span className="text-sm font-semibold text-foreground">
            Security Verification
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isVerified && (
            <button
              onClick={() => generateNewChallenge(true)}
              className="p-1 hover:bg-secondary rounded transition-colors"
              title="Get new challenge"
              aria-label="Refresh CAPTCHA"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          )}
          {isVerified && (
            <span className="text-xs font-medium text-green-600 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Verified
            </span>
          )}
        </div>
      </div>

      {/* Difficulty Badge */}
      <div className="mb-3">
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
          difficulty === 'easy' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
          difficulty === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
          difficulty === 'hard' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' :
          'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        }`}>
          {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
        </span>
        <span className="text-xs text-muted-foreground ml-2">
          Type: {challenge.type.charAt(0).toUpperCase() + challenge.type.slice(1)}
        </span>
      </div>

      {/* Question Display */}
      <div 
        className="captcha-question bg-secondary/50 rounded-lg p-4 mb-4 text-center"
        style={{
          fontFamily: "'Courier New', monospace",
          fontSize: difficulty === 'extreme' ? '1.1rem' : '1rem',
          fontWeight: 'bold',
          letterSpacing: '2px',
          userSelect: 'none',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Background noise lines to prevent OCR */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage: `repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(0,0,0,.05) 2px,
              rgba(0,0,0,.05) 4px
            ), repeating-linear-gradient(
              90deg,
              transparent,
              transparent 2px,
              rgba(0,0,0,.05) 2px,
              rgba(0,0,0,.05) 4px
            )`
          }}
        />
        
        <pre className="relative z-10 whitespace-pre-wrap font-mono">
          {challenge.question}
        </pre>
      </div>

      {/* Hint (shown after wrong attempt or on demand) */}
      {(showHint || challenge.hint) && (
        <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>💡 Hint: {challenge.hint}</span>
        </div>
      )}

      {/* Answer Input / Options */}
      {!isVerified && (
        <div className="space-y-3">
          {/* Multiple Choice Options (if available) */}
          {challenge.options ? (
            <div className="grid grid-cols-2 gap-2">
              {challenge.options.map((option, index) => (
                <button
                  key={index}
                  onClick={() => handleOptionClick(option)}
                  disabled={isLoading}
                  className={`p-3 border-2 rounded-lg transition-all text-sm font-mono font-semibold disabled:opacity-50 ${
                    lastVerificationResult === false && userAnswer === option
                      ? 'border-destructive bg-destructive/10 text-destructive'
                      : 'border-border hover:border-primary hover:bg-primary/5'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            /* Text Input */
            <div className="space-y-2">
              <input
                ref={inputRef}
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your answer..."
                disabled={isLoading || isVerified}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={`w-full px-4 py-3 border-2 rounded-lg text-center text-lg font-mono
                         focus:border-primary focus:ring-2 focus:ring-ring outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed
                         ${
                           lastVerificationResult === false
                             ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                             : 'border-border'
                         }`}
                aria-label="CAPTCHA answer input"
                aria-invalid={lastVerificationResult === false}
              />
              
              {/* Submit Button */}
              <button
                onClick={() => verifyAnswer()}
                disabled={isLoading || !userAnswer.trim()}
                className="w-full py-2.5 gradient-accent text-primary-foreground font-semibold rounded-lg
                         hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify Answer'
                )}
              </button>
            </div>
          )}

          {/* Attempts Counter */}
          {attempts > 0 && (
            <p className="text-xs text-center text-muted-foreground">
              Attempts: {attempts}/3
            </p>
          )}
        </div>
      )}

      {/* Verified State */}
      {isVerified && (
        <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <p className="text-sm font-medium text-green-700 dark:text-green-300 flex items-center justify-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            Human verified successfully!
          </p>
          <button
            onClick={() => generateNewChallenge(true)}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Refresh CAPTCHA
          </button>
        </div>
      )}

      {/* Hidden fields for bot detection */}
      <div className="hidden" aria-hidden="true">
        <input type="hidden" name="captcha_token" value={token} />
        <input 
          type="text" 
          name="website" 
          tabIndex={-1}
          autoComplete="off"
          onChange={() => {}} 
          // Honeypot field - bots will fill this
        />
      </div>

      {/* Security Info */}
      <div className="mt-3 pt-3 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          🔒 Protected by Advanced CAPTCHA System • No data stored
        </p>
      </div>
    </div>
  );
};

// Hook for using CAPTCHA in forms
export function useCaptcha(difficulty: 'easy' | 'medium' | 'hard' | 'extreme' = 'hard') {
  const [isVerified, setIsVerified] = useState(false);
  const [token, setToken] = useState('');

  const handleVerify = useCallback((valid: boolean, newToken: string) => {
    setIsVerified(valid);
    setToken(valid ? newToken : '');
    // Debug logging to help trace state propagation issues
    console.log('[useCaptcha] Verification state updated:', { valid, hasToken: !!newToken });
  }, []);

  const reset = useCallback(() => {
    setIsVerified(false);
    setToken('');
  }, []);

  // ROOT CAUSE FIX: previously this returned a brand-new inline arrow
  // function on every call to useCaptcha() — and since useCaptcha() runs
  // inside SignUp's render, that meant a NEW component identity every time
  // SignUp re-rendered (e.g. on every keystroke in the name/email/password
  // fields). React treats a changed component identity as "different
  // component type" and unmounts the old <Captcha> + mounts a new one,
  // which re-ran <Captcha>'s mount effect (generateNewChallenge) and its
  // auto-focus call — yanking focus into the CAPTCHA box on every keystroke
  // anywhere else on the page. Wrapping it in useMemo (deps: difficulty,
  // handleVerify — both stable) keeps the same component reference across
  // renders, so <Captcha> only mounts once and only re-focuses when the
  // user actually clicks "refresh" or gets an answer wrong.
  const CaptchaComponent = useMemo(() => {
    const Component = (props: Partial<CaptchaProps>) => (
      <Captcha 
        {...props} 
        difficulty={difficulty}
        onVerify={handleVerify}
      />
    );
    Component.displayName = 'CaptchaComponent';
    return Component;
  }, [difficulty, handleVerify]);

  return {
    isVerified,
    token,
    handleVerify,
    reset,
    CaptchaComponent,
  };
}

export default Captcha;
