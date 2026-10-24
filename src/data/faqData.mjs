// ─────────────────────────────────────────────────────────────────────────────
// src/data/faqData.mjs — CANONICAL FAQ dataset (single source of truth)
//
// ONE file, FIVE consumers — they can never drift apart:
//   1. src/pages/FAQ.tsx            → the public /faq page (humans)
//   2. src/components/seo/RouteSEOInjector.tsx → FAQPage JSON-LD on app pages
//   3. api/render.js                → live crawler HTML for /faq (AI/search bots)
//                                     + "faq" section of the machine-readable feed
//   4. scripts/seo-page-content.mjs → build-time fallback page for /faq
//
// WHY THIS LIVES IN src/data (and NOT in api/):
//   The frontend build (Vite) must NEVER depend on any file inside api/ —
//   api/ is deployed as Vercel Serverless Functions and its files get added,
//   merged and deleted as the function budget changes (Hobby plan caps at 12).
//   A missing api/ file once broke the whole production build. Data that the
//   React app needs belongs inside src/. Serverless functions CAN safely
//   import from src/ — Vercel bundles the imported files with the function.
//
// IMPORTANT CONTENT RULES
//   • Every answer must state ONLY verified facts about the school
//     (same facts as api/seo.js "llms" kind). No invented dates, names or fees.
//   • LIVE values (is admission open right now? session year? deadlines?)
//     are deliberately NOT hardcoded here — they come from the
//     admission_settings / school_settings tables at request time
//     (the data layer inlined in api/render.js). This file covers timeless
//     procedure.
//   • Keep answers self-contained: AI tools often read a single Q&A
//     without the surrounding page.
// ─────────────────────────────────────────────────────────────────────────────

export const FAQ_CATEGORIES = [
  "Admissions",
  "Results & Exams",
  "Notes & Library",
  "School Information",
  "Website & Contact",
];

export const FAQ_ITEMS = [
  // ── Admissions ────────────────────────────────────────────────────────────
  {
    id: "adm-open",
    category: "Admissions",
    question: "Are admissions open at GHS Babi Khel right now?",
    answer:
      "Admissions at Government High School Babi Khel are open every academic session for classes 6 to 10, and admission is completely free of charge as in all government schools of Khyber Pakhtunkhwa. The current open/closed status, session year and any deadlines are shown live at the top of the Admission page (ghsbabikhel.dpdns.org/admission) and are also published in the machine-readable feed at ghsbabikhel.dpdns.org/api/ai-data. If the online form is temporarily paused, you can still download the printable admission form from the same page and submit it at the school office.",
  },
  {
    id: "adm-classes",
    category: "Admissions",
    question: "Which classes can I apply for admission to?",
    answer:
      "You can apply for admission to classes 6, 7, 8, 9 and 10. The school is a high school affiliated with BISE Peshawar, so classes 9 and 10 prepare students for the board's SSC examinations as regular candidates. Boys and girls from Babi Khel and the surrounding areas of District Mohmand are both eligible, including students migrating from other schools.",
  },
  {
    id: "adm-how",
    category: "Admissions",
    question: "How do I apply for admission online, step by step?",
    answer:
      "Step 1: open the Admission page (ghsbabikhel.dpdns.org/admission) and fill the online eligibility application — student name, father name, date of birth, B-Form number, contact number, the class you are applying for, and previous-school details. Step 2: upload the required documents when prompted. Step 3: submit the form — the website immediately issues a reference number. Step 4: the school reviews your application and documents. Step 5: if approved, download the printable admission form from the tracker, fill it, attach your documents, and bring them to the school office to complete enrolment. There is also a fully offline path: download and print the blank admission form from the Admission page, fill it by hand, attach photocopies of the required documents and submit it in person at the school office.",
  },
  {
    id: "adm-documents",
    category: "Admissions",
    question: "Which documents are required for admission?",
    answer:
      "For every applicant: the student's B-Form (NADRA), a recent passport-size photograph, the previous class result card where applicable, and a copy of the father's or guardian's CNIC. Per GHS Babi Khel admission policy, a School Leaving Certificate (SLC) from the previous school is required for ALL admissions — both fresh admission and migration/transfer. For class 9 or 10 students migrating from another BISE-affiliated school or another board, the school additionally processes DMC, migration certificate and an enrollment/reference letter from the previous school's head through the BISE Peshawar portal as part of the board-level migration.",
  },
  {
    id: "adm-track",
    category: "Admissions",
    question: "How can I track my admission application status?",
    answer:
      "After submitting the online form, keep the reference number you received. On the Admission page, open the application status tracker and search by your reference number, your B-Form number, or your contact number — any one of them works. The tracker shows your current status (pending, under review, documents verified, interview scheduled, waitlisted, approved or admitted), any note from the school, and — once approved — links to download the printable admission form and related documents. You can also log in to the website's portal with your registered contact number to see your application timeline.",
  },
  {
    id: "adm-migration",
    category: "Admissions",
    question: "How does migration or transfer to GHS Babi Khel work for class 9 and 10?",
    answer:
      "School-level approval of your online application and board-level migration are two separate steps. After you are approved at the school, migration between BISE Peshawar-affiliated institutions (or from another board) is carried out on the BISE Peshawar portal by the sending and receiving schools, within the board's notified migration window for the academic year — a parent or student does not complete it by submitting a form to the board directly. A valid School Leaving Certificate from the previous school is required. For students coming from another board, the receiving school submits the student's DMC, migration certificate and an enrollment/reference letter from the previous school's head to BISE Peshawar along with the prescribed fee, which is paid through the board's own channels. For classes 6 to 8, a transfer between schools is handled at the school level and does not go through the BISE Peshawar portal.",
  },
  {
    id: "adm-fee",
    category: "Admissions",
    question: "Is there any admission fee or tuition fee?",
    answer:
      "No. Government High School Babi Khel is a government school, so admission and tuition are free of charge, as provided by the Government of Khyber Pakhtunkhwa. Students also receive free textbooks under the provincial free textbook scheme. Any fee that may apply in special cases (for example a BISE Peshawar board migration fee for class 9/10 transfers) is a board charge paid through the board's designated channels, not a school charge.",
  },

  // ── Results & Exams ───────────────────────────────────────────────────────
  {
    id: "res-check",
    category: "Results & Exams",
    question: "How do I check my exam result on the website?",
    answer:
      "Open the Results page (ghsbabikhel.dpdns.org/results), select your exam (class and examination name), and enter your roll number exactly as printed on your admit card. The result shows total marks, obtained marks, percentage, grade, pass/fail status and class position. Results only appear after the school administration publishes the exam, so if your roll number is not found the exam may not be published yet.",
  },
  {
    id: "res-exams",
    category: "Results & Exams",
    question: "Which exams and results are available for each class?",
    answer:
      "For classes 6 to 8 the school conducts 1st semester and 2nd semester examinations. For classes 9 and 10 the school conducts Mid-Term and Final-Term examinations, and those students additionally sit the BISE Peshawar SSC board examinations (SSC-I for class 9 and SSC-II for class 10). School internal results are published on the website's Results page once released by the school administration.",
  },
  {
    id: "res-bisep",
    category: "Results & Exams",
    question: "How do I check my BISE Peshawar board result?",
    answer:
      "The Results page (ghsbabikhel.dpdns.org/results) can search BISE Peshawar board results for SSC 9th and 10th class directly — enter your roll number in the board results section and the website fetches the result live from the official board portal (cloud.bisep.edu.pk). The website only reads from the board's official portal; it does not store board results. For anything beyond the displayed result (rechecking, certificates), contact BISE Peshawar or the school office.",
  },
  {
    id: "res-grades",
    category: "Results & Exams",
    question: "What is the grading scale used for results?",
    answer:
      "The school uses the standard percentage-based scale: A+ for 90% and above, A for 80–89%, B for 60–79%, C for 45–59%, D for 33–44%, and Fail below 33%. A result card additionally shows the student's position in class and a subject-wise breakdown of marks for every subject of the exam.",
  },
  {
    id: "res-datesheet",
    category: "Results & Exams",
    question: "Where can I find exam dates, date sheets and the exam schedule?",
    answer:
      "Exam schedules and date sheets are published as official notices on the Notices page (ghsbabikhel.dpdns.org/notices). Urgent exam announcements are also highlighted on the homepage.",
  },
  {
    id: "res-rollnumber",
    category: "Results & Exams",
    question: "Where can I find my roll number for the exam?",
    answer:
      "School exam roll numbers are released on the Roll No. Slip page (ghsbabikhel.dpdns.org/roll-no-slip) once the school administration finalises the exam session, and the release is also announced on the Notices page. On that page pick your class and type your full name — your exam roll number and your full roll number slip appear, which you can download as a PDF or share. For the BISE Peshawar board exams (class 9 and 10), your official roll number is issued on your board admit card, which the school distributes closer to the exam.",
  },
  {
    id: "res-rollslip",
    category: "Results & Exams",
    question: "How do I get my exam Roll No. Slip?",
    answer:
      "Open the Roll No. Slip page (ghsbabikhel.dpdns.org/roll-no-slip). If the school has scheduled a release, the page shows a live countdown and the slips appear automatically the moment it reaches zero. Once live: pick your class (6 to 10) and type your full name exactly as the school recorded it — capitalisation and extra spaces do not matter — then search. Only your own slip appears, so no student can see another student's slip. The slip is an exact copy of the office slip: your details with the exam roll number and QR code, your class's exam date sheet and the exam-day instructions. You can download it as a PDF or share it, and you must bring it to every paper — no slip, no entry to the examination hall.",
  },
  {
    id: "res-meritlist",
    category: "Results & Exams",
    question: "What is the Merit List page and who appears on it?",
    answer:
      "The Merit List page (ghsbabikhel.dpdns.org/merit-list) shows the official examination rankings published by the school office — the top position holders of each class and, for some exams, a school-wide list. Each list covers one exam (1st or 2nd semester for classes 6–8, Mid-Term or Final-Term for classes 9–10) and shows every listed student's position, name, class, obtained marks, percentage and grade, together with summary statistics such as the total number of students, the passing count, the highest percentage and the average. When the school schedules a merit list in advance, the page shows a live countdown and the rankings appear automatically the moment it reaches zero. A published merit list can also be shared directly from the page as a merit card.",
  },
  {
    id: "res-recheck",
    category: "Results & Exams",
    question: "What if I think there is a mistake in my result?",
    answer:
      "For a school-conducted exam (semester or Mid-Term/Final-Term), contact the school office or your subject teacher directly so the marks can be verified against the answer sheet. For a BISE Peshawar board result (SSC-I or SSC-II), rechecking and reappraisal requests must be submitted to BISE Peshawar itself within the board's notified rechecking window — the school website only displays the board's published result and cannot change it.",
  },

  // ── Notes & Library ───────────────────────────────────────────────────────
  {
    id: "nts-subjects",
    category: "Notes & Library",
    question: "Which subjects have free study notes on the website?",
    answer:
      "Free chapter-wise notes are available for nine subjects taught in classes 6 to 10: Mathematics, Physics, Chemistry, Biology, English, Urdu, Islamiat, Pakistan Studies and Computer Science. Every subject page is organised by class and chapter and includes explanations, solved examples, diagrams, practice quizzes and flashcards. The notes are written and maintained by the school's own teachers and are free for everyone.",
  },
  {
    id: "nts-library",
    category: "Notes & Library",
    question: "What can I download from the digital library?",
    answer:
      "The digital library (ghsbabikhel.dpdns.org/library) hosts downloadable study materials for classes 6 to 10: books, chapter notes, past papers and helping materials, organised by subject and class with descriptions and file sizes. Everything is free to download. Students preparing for school exams or the BISE Peshawar board examinations can keep the files on their phone and read them offline after installing the website as an app.",
  },
  {
    id: "nts-search",
    category: "Notes & Library",
    question: "How do I quickly find a specific note, notice or past paper?",
    answer:
      "Use the search icon in the navigation bar, or go directly to the Search page (ghsbabikhel.dpdns.org/search), and type a subject, chapter name, class or keyword. It searches across notes, notices, library files and other pages at once, so you don't have to browse each section separately.",
  },

  // ── School Information ────────────────────────────────────────────────────
  {
    id: "sch-about",
    category: "School Information",
    question: "Where is GHS Babi Khel located and what kind of school is it?",
    answer:
      "Government High School Babi Khel is a public government high school in Babi Khel, District Mohmand, Khyber Pakhtunkhwa, Pakistan. It was established in 2018 under the Elementary & Secondary Education Department of Khyber Pakhtunkhwa, is registered with EMIS code 60673, and offers classes 6 to 10. The school is affiliated with BISE Peshawar (Board of Intermediate and Secondary Education, Peshawar) for class 9 and 10 board examinations. The principal is Mr. Imdad Ullah.",
  },
  {
    id: "sch-timing",
    category: "School Information",
    question: "What are the school timings and when is the office open?",
    answer:
      "The school office is open during the morning shift on working days. Exact daily timings can change with the season and government notifications, so for the current schedule call the school at +92 346 9898295 or check the Notices page, where any timing change is announced officially. Holiday announcements and parent-teacher meeting dates are also published there and on the academic Calendar.",
  },
  {
    id: "sch-teachers",
    category: "School Information",
    question: "Who are the teachers and what subjects do they cover?",
    answer:
      "The staff directory page (ghsbabikhel.dpdns.org/teachers) lists the school's teaching staff with their subjects and qualifications. Teachers are appointed through the Khyber Pakhtunkhwa Elementary & Secondary Education Department and cover Mathematics, Physics, Chemistry, Biology, English, Urdu, Islamiat, Pakistan Studies and Computer Science for classes 6 to 10, led by the principal, Mr. Imdad Ullah.",
  },
  {
    id: "sch-events",
    category: "School Information",
    question: "What school events and activities take place during the year?",
    answer:
      "The school holds sports days and tournaments, science fairs and exhibitions, annual prize distributions, national-day programmes such as 14 August and Pakistan Day, tree plantation drives and parent-teacher meetings. Photos of past events are in the Gallery (ghsbabikhel.dpdns.org/gallery), and notices about upcoming events are posted on the Notices page.",
  },
  {
    id: "sch-gallery",
    category: "School Information",
    question: "Where can I see photos of the school and past events?",
    answer:
      "The Photo Gallery (ghsbabikhel.dpdns.org/gallery) has pictures of the school building, classrooms, sports days, science fairs, prize distributions and other events, organised so you can browse by event or date. New photos are added by the school after each event.",
  },

  // ── Website & Contact ─────────────────────────────────────────────────────
  {
    id: "web-pwa",
    category: "Website & Contact",
    question: "Can I use the website offline or install it as an app?",
    answer:
      "Yes. The website is a Progressive Web App (PWA). Open it in Chrome on Android (or Safari on iPhone), choose 'Add to Home screen / Install app', and it behaves like a normal app with its own icon. After installation, pages you have visited, notes and downloaded materials remain available without internet, and the site syncs fresh notices and results automatically whenever you are back online.",
  },
  {
    id: "web-cost",
    category: "Website & Contact",
    question: "Is there any cost or account required to use the website?",
    answer:
      "The website is completely free, and all public sections — notices, results, notes, library and gallery — can be used without any account. You only sign in if you are a student or guardian tracking an admission application or dashboard features, or if you are staff. There are no ads and no charges for any feature of the site.",
  },
  {
    id: "web-contact",
    category: "Website & Contact",
    question: "How do I contact the school?",
    answer:
      "Call the school at +92 346 9898295, email ghsbabikhel@gmail.com, or use the contact form and WhatsApp option on the Contact page (ghsbabikhel.dpdns.org/contact), which also shows the school's location on a map. The school's Facebook page is linked from the Contact page and footer. For admission questions, please read the Admission page first — it answers most queries and lets you track an application instantly.",
  },
  {
    id: "web-login",
    category: "Website & Contact",
    question: "Do I need to create an account, and what does it unlock?",
    answer:
      "You don't need an account to browse notices, results, notes, library or gallery — those are open to everyone. Creating a free account (Sign Up, ghsbabikhel.dpdns.org/auth/signup) is only useful if you want a personal dashboard to track your admission application status in one place, or if you are a teacher who needs access to staff features. Signing in is never required just to read study material or check a result.",
  },
  {
    id: "web-notices",
    category: "Website & Contact",
    question: "Where can I see the latest notices and announcements?",
    answer:
      "All official announcements — holiday notices, exam date sheets, fee or admission updates, and general circulars — are published on the Notices page (ghsbabikhel.dpdns.org/notices) as soon as the school administration posts them. The homepage also shows the most recent notices and news in a scrolling ticker, and you can enable notifications from the bell icon in the navigation bar so you don't miss an urgent one.",
  },
  {
    id: "web-official",
    category: "Website & Contact",
    question: "Is ghsbabikhel.dpdns.org the official website of GHS Babi Khel?",
    answer:
      "Yes. https://ghsbabikhel.dpdns.org is the official website of Government High School Babi Khel, District Mohmand, Khyber Pakhtunkhwa, Pakistan (EMIS code 60673), established in 2018, principal Mr. Imdad Ullah.",
  },
  {
    id: "web-developer",
    category: "Website & Contact",
    question: "Who developed the GHS Babi Khel website?",
    answer:
      "Muhammad Faheem, a class-10 (matric) Computer Science student of Government High School Babi Khel (District Mohmand, Khyber Pakhtunkhwa, Pakistan), independently designed and developed this website as a school/community project. He is the son of Zabih Ullah and a resident of Village Sangar, Tehsil Halimzai, District Mohmand, Khyber Pakhtunkhwa (KPK), Pakistan. For admissions, results, notices and other school matters, please contact the school directly: principal Mr. Imdad Ullah, phone +92 346 9898295, email ghsbabikhel@gmail.com.",
  },
];

/**
 * FAQPage JSON-LD (schema.org) built from the items above.
 * Used by api/render.js (live crawler HTML) and RouteSEOInjector (app pages).
 */
export function buildFaqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
