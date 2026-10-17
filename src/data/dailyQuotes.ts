// src/data/dailyQuotes.ts
// Static, code-based quote list for the homepage "Thought of the Day"
// section. No database, no admin panel — this file IS the source of
// truth. To add/edit quotes, just edit this array and redeploy.
//
// One quote is shown per calendar day (deterministic — same quote for
// everyone, all day, no network round-trip). Rotation is based on the
// day of the year, so it cycles through the whole list roughly every
// 20-25 days, then repeats.

export interface StaticQuote {
  text: string;
  author: string | null;
  category: "motivational" | "islamic" | "educational";
  source?: string;
}

export const DAILY_QUOTES: StaticQuote[] = [
  { text: "The best of people are those who are most beneficial to people.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "Seek knowledge from the cradle to the grave.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "Education is the most powerful weapon which you can use to change the world.", author: "Nelson Mandela", category: "motivational" },
  { text: "The beautiful thing about learning is that no one can take it away from you.", author: "B.B. King", category: "educational" },
  { text: "Whoever treads a path in search of knowledge, Allah makes easy for him a path to Paradise.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin", category: "educational" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill", category: "motivational" },
  { text: "The pursuit of knowledge is an obligation upon every Muslim.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt", category: "motivational" },
  { text: "Education is not the filling of a pail, but the lighting of a fire.", author: "William Butler Yeats", category: "educational" },
  { text: "The ink of the scholar is more sacred than the blood of the martyr.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela", category: "motivational" },
  { text: "Knowledge is power. Information is liberating.", author: "Kofi Annan", category: "educational" },
  { text: "The best among you are those who learn the Qur'an and teach it.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson", category: "motivational" },
  { text: "Live as if you were to die tomorrow. Learn as if you were to live forever.", author: "Mahatma Gandhi", category: "educational" },
  { text: "Verily, with hardship comes ease.", author: "Qur'an 94:6", category: "islamic" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs", category: "motivational" },
  { text: "Develop a passion for learning. If you do, you will never cease to grow.", author: "Anthony J. D'Angelo", category: "educational" },
  { text: "God does not burden a soul beyond what it can bear.", author: "Qur'an 2:286", category: "islamic" },
  { text: "Hardships often prepare ordinary people for an extraordinary destiny.", author: "C.S. Lewis", category: "motivational" },
  { text: "Change is the end result of all true learning.", author: "Leo Buscaglia", category: "educational" },
  { text: "The strong person is not the one who overcomes people by strength, but the one who controls himself while in anger.", author: "Prophet Muhammad ﷺ", category: "islamic" },
  { text: "Your limitation—it's only your imagination.", author: null, category: "motivational" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn", category: "educational" },
];

/** Deterministic day-of-year index, same quote all day, no network call. */
export function getTodayQuote(): StaticQuote {
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  );
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
}
