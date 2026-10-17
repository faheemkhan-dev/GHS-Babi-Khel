import { motion } from "framer-motion";
import { lazy, Suspense } from "react";
import {
  GraduationCap, Target, Eye, MapPin, Calendar, Users, Award,
  History, ArrowRight, ShieldCheck, HeartHandshake,
  BookOpen, Quote, ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import PageLayout from "@/components/layout/PageLayout";
import ParticleManifesto from "@/components/about/ParticleManifesto";
import { useSchoolSettings, optimizedCloudinaryUrl } from "@/hooks/useSchoolSettings";
import { useCountUp } from "@/hooks/useCountUp";
import { Skeleton } from "@/components/ui/skeleton";
const SchoolMap = lazy(() => import("@/components/SchoolMap"));

/* ════════════════════════════════════════════════════════════════════
   ABOUT PAGE — premium redesign
   Visual language matches the homepage: emerald + antique gold, serif
   display headings, soft cards, one-shot framer-motion entrances.
   All data hooks / fallbacks / SEO content are preserved 1:1.
   ════════════════════════════════════════════════════════════════════ */

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.09, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/* Count-up stat tile used inside the gradient stats band */
const BandStat = ({ value, label, suffix = "" }: { value: number; label: string; suffix?: string }) => {
  const { count, ref } = useCountUp(value);
  return (
    <div
      ref={ref}
      className="rounded-2xl bg-white/10 border border-white/15 px-4 py-6 text-center shadow-sm"
    >
      <div className="text-3xl md:text-4xl font-heading font-bold text-gradient-gold">
        {count}{suffix}
      </div>
      <div className="text-xs md:text-sm font-medium text-white/75 mt-1.5 uppercase tracking-[0.14em]">
        {label}
      </div>
    </div>
  );
};

const About = () => {
  const { data: settings, isLoading } = useSchoolSettings();

  const pillars = [
    {
      icon: Award,
      title: "Academic Excellence",
      text: "A proven track record of board results and disciplined study culture.",
    },
    {
      icon: HeartHandshake,
      title: "Character First",
      text: "Respect, honesty and responsibility are taught beside every lesson.",
    },
    {
      icon: Users,
      title: "Caring Faculty",
      text: "Qualified teachers who know every student by name and by need.",
    },
    {
      icon: ShieldCheck,
      title: "Safe Campus",
      text: "A secure, supportive environment where students can truly focus.",
    },
  ];

  return (
    <PageLayout>

      {/* ══════════ HERO — Particle Manifesto ══════════
          The school's mission, drawn in drifting gold dust instead of a
          static headline. Quick facts + intro copy live just beneath it,
          so search engines and screen readers still get the plain text. */}
      <ParticleManifesto />

      <section className="relative overflow-hidden gradient-hero">
        <div className="orb orb-gold w-[420px] h-[420px] -top-40 -right-24 opacity-70" />
        <div className="orb orb-light w-[300px] h-[300px] -bottom-28 -left-16" />
        <div className="absolute inset-0 dot-grid opacity-[0.12]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="container mx-auto px-4 relative z-10 py-14 md:py-20 text-center">
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55 }}
            className="text-on-hero-soft text-sm md:text-lg max-w-2xl mx-auto leading-relaxed"
          >
            {settings?.school_name || "GHS Babi Khel"} — a government high school in
            District Mohmand, KPK, serving students from Class 6 to Class 10 with
            quality education and strong values.
          </motion.p>

          {/* Quick facts chips */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.55 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-2.5"
          >
            {[
              { icon: Calendar, label: `Est. ${settings?.established_year || 2018}` },
              { icon: GraduationCap, label: `EMIS ${settings?.emis_code || "60673"}` },
              { icon: MapPin, label: settings?.address || "District Mohmand, KPK" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-4 py-2 text-xs sm:text-sm font-medium text-on-hero"
              >
                <Icon className="w-3.5 h-3.5 text-gold" />
                {label}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══════════ STORY + PILLARS (bento) ══════════ */}
      <section className="section-y-sm">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-12 gap-6 items-start">

            {/* Our story — gradient-bordered feature card */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              className="lg:col-span-7 border-gradient-gold card-lift rounded-3xl p-7 md:p-10 shadow-card"
            >
              <span className="eyebrow">Who we are</span>
              <h2 className="section-title !mt-2 text-3xl md:text-4xl">
                A beacon of learning in{" "}
                <span className="text-gradient-primary">Babi Khel</span>
              </h2>

              {isLoading ? (
                <div className="space-y-3 mt-6">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : (
                <>
                  <p className="mt-6 text-muted-foreground leading-relaxed">
                    {settings?.about_text || settings?.description ||
                      "Established in 2018, GHS Babi Khel is a government high school located in Babi Khel, District Mohmand, Khyber Pakhtunkhwa, Pakistan. The school serves as a beacon of education in the region, providing quality education from Class 6 to Class 10."}
                  </p>
                  <p className="mt-4 text-muted-foreground leading-relaxed">
                    With an EMIS Code of {settings?.emis_code || "60673"}, our school is
                    officially registered with the Education Management Information
                    System of KPK. We are committed to academic excellence with a
                    remarkable {settings?.pass_percentage || 95}% pass rate.
                  </p>

                  <div className="mt-7 flex flex-wrap gap-2.5">
                    {[
                      { icon: MapPin, label: settings?.address || "District Mohmand" },
                      { icon: Calendar, label: `Est. ${settings?.established_year || 2018}` },
                      { icon: GraduationCap, label: `EMIS: ${settings?.emis_code || "60673"}` },
                    ].map(({ icon: Icon, label }) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded-full text-sm"
                      >
                        <Icon className="w-4 h-4 text-primary" /> {label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </motion.div>

            {/* History / Mission / Vision — stacked lift cards */}
            <div className="lg:col-span-5 space-y-4">
              {[
                {
                  icon: History,
                  title: "Our History",
                  text: `Founded in ${settings?.established_year || 2018}, GHS Babi Khel was established to bring quality education to the youth of Babi Khel and surrounding areas in District Mohmand. Since then, we have been steadily growing and producing excellent results.`,
                },
                {
                  icon: Target,
                  title: "Our Mission",
                  text: "To provide accessible, quality education that empowers students with knowledge, skills, and values to become responsible citizens and future leaders of Pakistan.",
                },
                {
                  icon: Eye,
                  title: "Our Vision",
                  text: "To be a model government school that sets the standard for academic excellence and character development in District Mohmand.",
                },
              ].map((item, i) => (
                <motion.div
                  key={item.title}
                  variants={fadeUp}
                  custom={i}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, amount: 0.3 }}
                  className="group bg-card rounded-2xl p-5 md:p-6 shadow-card border border-border/70 card-lift relative overflow-hidden"
                >
                  {/* gold corner accent */}
                  <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-gold/15 to-transparent rounded-bl-[2.5rem]" />
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="icon-tile w-10 h-10">
                      <item.icon className="w-5 h-5" />
                    </div>
                    <h3 className="font-heading font-semibold text-foreground text-lg">
                      {item.title}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.text}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ GRADIENT STATS BAND ══════════ */}
      <section className="relative gradient-hero overflow-hidden">
        <div className="orb orb-gold w-72 h-72 -top-24 left-[12%] opacity-50" />
        <div className="orb orb-light w-64 h-64 -bottom-24 right-[8%]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="container mx-auto px-4 py-14 md:py-16 relative z-10">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="text-center mb-9"
          >
            <span className="text-xs sm:text-sm font-semibold uppercase tracking-[0.2em] text-gold">
              By the numbers
            </span>
            <h2 className="mt-2 text-2xl md:text-3xl font-heading font-bold text-on-hero">
              Our school in figures
            </h2>
          </motion.div>

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-white/10 border border-white/15 p-6 text-center">
                  <Skeleton className="h-9 w-20 mx-auto mb-2 bg-white/20" />
                  <Skeleton className="h-4 w-16 mx-auto bg-white/20" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <BandStat value={settings?.total_students || 180} suffix="+" label="Students" />
              <BandStat value={settings?.total_teachers || 8} suffix="+" label="Teachers" />
              <BandStat value={settings?.pass_percentage || 95} suffix="%" label="Pass Rate" />
              <BandStat
                value={new Date().getFullYear() - (settings?.established_year || 2018)}
                suffix="+"
                label="Years of Service"
              />
            </div>
          )}
        </div>
      </section>

      {/* ══════════ PRINCIPAL'S MESSAGE — quote card ══════════ */}
      {!isLoading && (settings?.principal_message || settings?.principal_photo_url) && (
        <section className="section-y-sm bg-secondary/50">
          <div className="container mx-auto px-4">
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.2 }}
              className="text-center mb-10"
            >
              <span className="eyebrow">Leadership</span>
              <h2 className="section-title !mt-2 text-3xl md:text-4xl">
                Principal's <span className="text-gradient-primary">Message</span>
              </h2>
            </motion.div>

            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.15 }}
              className="border-gradient-gold card-lift rounded-3xl shadow-elevated p-7 md:p-10 max-w-4xl mx-auto grid md:grid-cols-[190px_1fr] gap-8 items-start"
            >
              {/* Photo with gold ring */}
              <div className="flex flex-col items-center md:items-start">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-[1.4rem] bg-gradient-to-br from-gold/70 via-gold/20 to-gold/60" />
                  <div className="relative w-36 h-36 rounded-[1.25rem] overflow-hidden bg-secondary shadow-elevated">
                    {settings?.principal_photo_url ? (
                      <img
                        src={optimizedCloudinaryUrl(settings.principal_photo_url, { width: 400 }) || settings.principal_photo_url}
                        alt={settings?.principal_name || "Principal"}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Users className="w-12 h-12" />
                      </div>
                    )}
                  </div>
                </div>
                {settings?.principal_name && (
                  <p className="mt-4 font-heading font-semibold text-foreground text-center md:text-left">
                    {settings.principal_name}
                  </p>
                )}
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold mt-0.5 text-center md:text-left">
                  Principal
                </p>
              </div>

              {/* Quote body */}
              <div className="relative">
                <Quote className="absolute -top-1 -left-1 w-10 h-10 text-gold/25 rotate-180" />
                <p className="relative pl-8 text-muted-foreground leading-relaxed whitespace-pre-line">
                  {settings?.principal_message}
                </p>
                <div className="mt-5 pl-8 h-[3px] w-14 rounded-full bg-gradient-to-r from-gold to-gold-soft" />
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* ══════════ WHAT WE STAND FOR — pillar chips ══════════ */}
      <section className="section-y-sm">
        <div className="container mx-auto px-4">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="text-center mb-10"
          >
            <span className="eyebrow">Our values</span>
            <h2 className="section-title !mt-2 text-3xl md:text-4xl">
              What we <span className="text-gradient-primary">stand for</span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {pillars.map((p, i) => (
              <motion.div
                key={p.title}
                variants={fadeUp}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
                className="group bg-card rounded-2xl p-6 shadow-card border border-border/70 card-lift text-center"
              >
                <div className="icon-tile w-12 h-12 mx-auto mb-4">
                  <p.icon className="w-6 h-6" />
                </div>
                <h3 className="font-heading font-semibold text-foreground">{p.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                  {p.text}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ LOCATION ══════════ */}
      <section className="section-y-sm bg-secondary/50">
        <div className="container mx-auto px-4">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="text-center mb-8"
          >
            <span className="eyebrow">Find us</span>
            <h2 className="section-title !mt-2 text-3xl md:text-4xl">Our <span className="text-gradient-primary">Location</span></h2>
            <p className="section-subtitle">
              {settings?.address || "Babi Khel, District Mohmand, KPK, Pakistan"}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
              {settings?.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-primary" /> Phone: {settings.phone}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-primary" />
                Email: {settings?.email || "ghsbabikhel@gmail.com"}
              </span>
            </div>
          </motion.div>

          {settings?.location_lat && settings?.location_lng ? (
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.15 }}
              className="border-gradient-gold rounded-3xl overflow-hidden shadow-elevated"
            >
              <Suspense fallback={
                <div className="h-[360px] bg-secondary/30 flex items-center justify-center text-sm text-muted-foreground">
                  Loading map…
                </div>
              }>
                <SchoolMap
                  lat={settings.location_lat}
                  lng={settings.location_lng}
                  label={settings.school_name || "School Location"}
                  height={360}
                  zoom={16}
                />
              </Suspense>
              <div className="bg-card px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="w-4 h-4 text-primary shrink-0" />
                  <span>{settings.address || "Babi Khel, District Mohmand, KPK"}</span>
                </div>
                <div className="flex gap-2.5">
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${settings.location_lat}&mlon=${settings.location_lng}#map=16/${settings.location_lat}/${settings.location_lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="sheen inline-flex items-center gap-1.5 text-xs font-semibold rounded-full border border-border bg-secondary px-3.5 py-1.5 text-foreground hover:border-gold/60 transition-colors"
                  >
                    OpenStreetMap <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href={`https://www.google.com/maps?q=${settings.location_lat},${settings.location_lng}`}
                    target="_blank" rel="noopener noreferrer"
                    className="sheen inline-flex items-center gap-1.5 text-xs font-semibold rounded-full border border-border bg-secondary px-3.5 py-1.5 text-foreground hover:border-gold/60 transition-colors"
                  >
                    Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </motion.div>
          ) : null}
        </div>
      </section>

      {/* ══════════ CLOSING CTA ══════════ */}
      <section className="section-y-sm">
        <div className="container mx-auto px-4">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="relative gradient-hero rounded-3xl overflow-hidden px-6 py-12 md:px-14 md:py-16 text-center shadow-elevated"
          >
            <div className="orb orb-gold w-80 h-80 -top-32 right-10 opacity-60" />
            <div className="orb orb-light w-56 h-56 -bottom-20 left-6" />
            <div className="relative z-10">
              <h2 className="text-2xl md:text-4xl font-display font-semibold text-on-hero leading-tight">
                Ready to become part of<br className="hidden sm:block" />
                <span className="italic text-gold"> our story?</span>
              </h2>
              <p className="mt-4 text-on-hero-soft text-sm md:text-base max-w-xl mx-auto leading-relaxed">
                Whether you are a parent exploring admission or a visitor with a
                question — we would love to hear from you.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
                <Link to="/admission">
                  <motion.span
                    whileHover={{ y: -2 }}
                    whileTap={{ y: 0 }}
                    className="sheen inline-flex items-center gap-2 rounded-xl bg-accent text-accent-foreground font-semibold px-7 py-3.5 shadow-elevated cursor-pointer"
                  >
                    Apply for Admission <ArrowRight className="w-4 h-4" />
                  </motion.span>
                </Link>
                <Link to="/contact">
                  <motion.span
                    whileHover={{ y: -2 }}
                    whileTap={{ y: 0 }}
                    className="inline-flex items-center gap-2 rounded-xl border border-gold/50 bg-white/10 text-on-hero font-semibold px-7 py-3.5 hover:bg-white/15 transition-colors cursor-pointer"
                  >
                    Contact Us
                  </motion.span>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </PageLayout>
  );
};

export default About;
