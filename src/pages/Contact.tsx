import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  MapPin, Phone, Mail, MessageCircle, Facebook,
  Send, CheckCircle2, Loader2, Clock, AlertTriangle, Shield,
  ArrowRight, Sparkles, GraduationCap,
} from "lucide-react";
import confetti from "canvas-confetti";
import PageLayout from "@/components/layout/PageLayout";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* ════════════════════════════════════════════════════════════════════
   CONTACT PAGE — premium redesign
   ONLY the presentation layer changed. Every security feature is
   preserved exactly: input sanitisation (XSS), email/name/message
   validation, client-side rate limiting, admin notification RPC and
   the mailto hand-off flow.
   ════════════════════════════════════════════════════════════════════ */

interface FormState {
  name: string;
  email: string;
  subject: string;
  message: string;
}

interface ValidationErrors {
  name?: string;
  email?: string;
  message?: string;
}

const INIT: FormState = { name: "", email: "", subject: "", message: "" };

// SECURITY FIX: Input sanitization to prevent XSS
const sanitizeInput = (str: string): string => {
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // Remove script tags
    .replace(/javascript:/gi, "") // Remove javascript protocol
    .replace(/on\w+\s*=/gi, "") // Remove event handlers
    .trim();
};

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Name validation - allow letters, spaces, hyphens, apostrophes
const NAME_REGEX = /^[a-zA-Z\s\-'\u0600-\u06FF]{2,100}$/;

/* Staggered entrance preset (one-shot, GPU-safe) */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.09, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const Contact = () => {
  const { data: settings } = useSchoolSettings();

  const displayEmail  = settings?.email  || "ghsbabikhel@gmail.com";
  const displayPhone  = settings?.phone?.trim().length > 5 ? settings.phone : null;
  const displayAddress = settings?.address || "Babi Khel, District Mohmand, KPK, Pakistan";

  const [form, setForm]       = useState<FormState>(INIT);
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [submitCount, setSubmitCount] = useState(0);

  // SECURITY FIX: Rate limiting (client-side tracking)
  const MAX_SUBMIT_ATTEMPTS = 5;
  const RATE_LIMIT_WINDOW = 60000; // 1 minute

  // Small gold/celebration burst when the message is successfully prepared
  useEffect(() => {
    if (!sent) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    confetti({
      particleCount: 90,
      spread: 75,
      startVelocity: 38,
      origin: { y: 0.65 },
      colors: ["#D4AF37", "#F1E3B6", "#0E5C46", "#1B7A5E", "#FFFFFF"],
      disableForReducedMotion: true,
    });
  }, [sent]);

  const set = (key: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      // Clear field-specific error when user starts typing
      if (validationErrors[key as keyof ValidationErrors]) {
        setValidationErrors(prev => ({ ...prev, [key]: undefined }));
      }
    };

  // SECURITY FIX: Comprehensive form validation
  const validateForm = (): boolean => {
    const errors: ValidationErrors = {};

    // Name validation
    if (!form.name.trim()) {
      errors.name = "Name is required";
    } else if (!NAME_REGEX.test(form.name.trim())) {
      errors.name = "Please enter a valid name (letters only)";
    }

    // Email validation
    if (!form.email.trim()) {
      errors.email = "Email is required";
    } else if (!EMAIL_REGEX.test(form.email.trim())) {
      errors.email = "Please enter a valid email address";
    }

    // Message validation
    if (!form.message.trim()) {
      errors.message = "Message is required";
    } else if (form.message.trim().length < 10) {
      errors.message = "Message must be at least 10 characters";
    } else if (form.message.trim().length > 2000) {
      errors.message = "Message must be less than 2000 characters";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // SECURITY FIX: Check rate limiting
  const checkRateLimit = (): boolean => {
    const now = Date.now();
    const attempts = JSON.parse(localStorage.getItem('contact_submit_attempts') || '[]');
    const recentAttempts = attempts.filter((time: number) => now - time < RATE_LIMIT_WINDOW);

    if (recentAttempts.length >= MAX_SUBMIT_ATTEMPTS) {
      setError(`Too many attempts. Please try again in ${Math.ceil((RATE_LIMIT_WINDOW - (now - recentAttempts[0])) / 1000)} seconds.`);
      return false;
    }

    return true;
  };

  // SECURITY FIX: Record submission attempt
  const recordSubmissionAttempt = () => {
    const attempts = JSON.parse(localStorage.getItem('contact_submit_attempts') || '[]');
    attempts.push(Date.now());
    localStorage.setItem('contact_submit_attempts', JSON.stringify(attempts));
  };

  const handleSubmit = async () => {
    setError("");
    setSubmitCount(prev => prev + 1);

    // SECURITY FIX: Validate form first
    if (!validateForm()) {
      setError("Please fix the errors below before submitting.");
      return;
    }

    // SECURITY FIX: Check rate limiting
    if (!checkRateLimit()) {
      return;
    }

    // SECURITY FIX: Sanitize all inputs
    const sanitizedForm = {
      name: sanitizeInput(form.name),
      email: sanitizeInput(form.email),
      subject: sanitizeInput(form.subject),
      message: sanitizeInput(form.message)
    };

    setSending(true);

    try {
      // Let admin know someone messaged — fire-and-forget, never blocks sending.
      const { error: rpcError } = await supabase.rpc("notify_admin_contact", {
        p_name: sanitizedForm.name,
        p_email: sanitizedForm.email,
        p_subject: sanitizedForm.subject || null,
      });

      if (rpcError) {
        console.warn("[Contact] notify_admin_contact failed:", rpcError.message);
        // Don't block user for notification failure
      }

      // Build mailto link so the message arrives at the school's inbox
      const body = `Name: ${sanitizedForm.name}\nEmail: ${sanitizedForm.email}\n\n${sanitizedForm.message}`;
      const mailto = `mailto:${displayEmail}?subject=${encodeURIComponent(
        sanitizedForm.subject || "Contact from website"
      )}&body=${encodeURIComponent(body)}`;

      // Small delay for UX feel, then open mail client
      setTimeout(() => {
        window.open(mailto, "_blank");
        setSending(false);
        setSent(true);
        setForm(INIT);
        setValidationErrors({});

        // SECURITY FIX: Record successful attempt
        recordSubmissionAttempt();
      }, 800);

    } catch (err) {
      console.error("[Contact] Error:", err);
      setError("An unexpected error occurred. Please try again.");
      setSending(false);
    }
  };

  const contactCards = [
    {
      icon: MapPin,
      label: "Address",
      value: displayAddress,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayAddress)}`,
      linkLabel: "View on map",
    },
    ...(displayPhone
      ? [{
          icon: Phone,
          label: "Phone",
          value: displayPhone,
          href: `tel:${displayPhone.replace(/\s/g, "")}`,
          linkLabel: "Call now",
        }]
      : []),
    {
      icon: Mail,
      label: "Email",
      value: displayEmail,
      href: `mailto:${displayEmail}`,
      linkLabel: "Send email",
    },
    {
      icon: Clock,
      label: "Office Hours",
      value: "Monday – Saturday, 8:00 AM – 2:00 PM",
      href: null,
      linkLabel: null,
    },
  ];

  return (
    <PageLayout>

      {/* ══════════ PREMIUM HERO ══════════ */}
      <section className="relative overflow-hidden gradient-hero">
        {/* Decorative layers — static, GPU-safe */}
        <div className="orb orb-gold w-[420px] h-[420px] -top-44 -left-24 opacity-70" />
        <div className="orb orb-light w-[320px] h-[320px] -bottom-32 -right-20" />
        <div className="absolute inset-0 dot-grid opacity-[0.12]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

        <div className="container mx-auto px-4 relative z-10 py-16 md:py-24 text-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-white/10 px-4 py-1.5 text-xs sm:text-sm font-semibold uppercase tracking-[0.18em] text-gold"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Get in touch
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.55 }}
            className="mt-6 text-4xl md:text-6xl font-display font-semibold leading-[1.08] text-on-hero"
          >
            Let's start a<br className="hidden sm:block" />
            <span className="italic text-gold"> conversation.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.55 }}
            className="mt-5 text-on-hero-soft text-sm md:text-lg max-w-2xl mx-auto leading-relaxed"
          >
            Questions about admission, results or anything else? Reach out any
            time — we usually reply within one working day.
          </motion.p>

          {/* Quick contact chips */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.55 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-2.5"
          >
            <a
              href={`mailto:${displayEmail}`}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-4 py-2 text-xs sm:text-sm font-medium text-on-hero hover:bg-white/15 transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-gold" /> {displayEmail}
            </a>
            {displayPhone && (
              <a
                href={`tel:${displayPhone.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-4 py-2 text-xs sm:text-sm font-medium text-on-hero hover:bg-white/15 transition-colors"
              >
                <Phone className="w-3.5 h-3.5 text-gold" /> {displayPhone}
              </a>
            )}
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/15 px-4 py-2 text-xs sm:text-sm font-medium text-on-hero">
              <Clock className="w-3.5 h-3.5 text-gold" /> Mon – Sat, 8 AM – 2 PM
            </span>
          </motion.div>
        </div>
      </section>

      <section className="section-y-sm">
        <div className="container mx-auto px-4 max-w-5xl">

          {/* ══ Contact cards — animated lift tiles ══ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-14">
            {contactCards.map(({ icon: Icon, label, value, href, linkLabel }, i) => (
              <motion.div
                key={label}
                variants={fadeUp}
                custom={i}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.3 }}
                className="group bg-card rounded-2xl p-5 shadow-card border border-border/70 card-lift flex flex-col gap-3 relative overflow-hidden"
              >
                {/* gold corner accent */}
                <div className="absolute top-0 right-0 w-14 h-14 bg-gradient-to-bl from-gold/15 to-transparent rounded-bl-[2rem]" />
                <div className="icon-tile w-10 h-10">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold mb-0.5">
                    {label}
                  </p>
                  <p className="text-sm text-foreground leading-snug">{value}</p>
                  {href && linkLabel && (
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-2 transition-all"
                    >
                      {linkLabel} <ArrowRight className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* ══ Two-column: form + social ══ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

            {/* ── Contact Form with Security ── */}
            <motion.div
              variants={fadeUp}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              className="lg:col-span-3 border-gradient-gold rounded-3xl shadow-card p-7 md:p-8 relative overflow-hidden"
            >
              {/* top gold hairline */}
              <div className="absolute top-0 inset-x-8 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

              <div className="flex items-center gap-2.5 mb-1">
                <div className="icon-tile w-9 h-9">
                  <Send className="w-4 h-4" />
                </div>
                <h2 className="text-xl font-heading font-bold text-foreground">Send a Message</h2>
                <span title="Secure form with validation" className="inline-flex">
                  <Shield className="w-5 h-5 text-green-600" />
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-6">
                Fill out the form below and we'll get back to you as soon as
                possible. All fields are validated for your security.
              </p>

              {/* Security notice — restyled, same trust message */}
              <div className="mb-6 p-3 rounded-xl bg-green-500/10 border border-green-500/25">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-green-800 dark:text-green-400 leading-relaxed">
                    Protected with input validation, XSS protection and rate
                    limiting — your message travels safely.
                  </p>
                </div>
              </div>

              {sent ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
                  className="flex flex-col items-center justify-center gap-3 py-12 text-center"
                >
                  <div className="relative">
                    <div className="absolute -inset-2 rounded-full bg-green-500/15" />
                    <CheckCircle2 className="relative w-14 h-14 text-green-500" />
                  </div>
                  <p className="font-heading font-bold text-lg text-foreground">Message ready to send!</p>
                  <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                    Your mail client opened with the message pre-filled. If
                    nothing opened,{" "}
                    <a href={`mailto:${displayEmail}`} className="text-primary font-medium hover:underline">
                      email us directly
                    </a>
                    .
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setSent(false)}
                    className="mt-2 rounded-xl border-gold/50 hover:border-gold hover:bg-gold/10"
                  >
                    Send another
                  </Button>
                </motion.div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Name Field - With Validation */}
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Your Name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="contact-name"
                        placeholder="Ahmad Khan"
                        value={form.name}
                        onChange={set("name")}
                        required
                        minLength={2}
                        maxLength={100}
                        autoComplete="name"
                        className={`h-11 rounded-xl bg-background transition-shadow focus:ring-2 focus:ring-gold/50 focus:border-gold/60 ${
                          validationErrors.name ? 'border-destructive' : ''
                        }`}
                        aria-invalid={!!validationErrors.name}
                        aria-describedby={validationErrors.name ? "name-error" : undefined}
                      />
                      {validationErrors.name && (
                        <p id="name-error" className="text-xs text-destructive flex items-center gap-1 mt-1">
                          <AlertTriangle className="w-3 h-3" />{validationErrors.name}
                        </p>
                      )}
                    </div>

                    {/* Email Field - With Validation */}
                    <div className="space-y-1.5">
                      <Label htmlFor="contact-email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Email Address <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="contact-email"
                        type="email"
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={set("email")}
                        required
                        maxLength={254}
                        autoComplete="email"
                        className={`h-11 rounded-xl bg-background transition-shadow focus:ring-2 focus:ring-gold/50 focus:border-gold/60 ${
                          validationErrors.email ? 'border-destructive' : ''
                        }`}
                        aria-invalid={!!validationErrors.email}
                        aria-describedby={validationErrors.email ? "email-error" : undefined}
                      />
                      {validationErrors.email && (
                        <p id="email-error" className="text-xs text-destructive flex items-center gap-1 mt-1">
                          <AlertTriangle className="w-3 h-3" />{validationErrors.email}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Subject Field - Optional but Sanitized */}
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-subject" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Subject
                    </Label>
                    <Input
                      id="contact-subject"
                      placeholder="e.g. Admission inquiry, Fee information…"
                      value={form.subject}
                      onChange={set("subject")}
                      maxLength={200}
                      autoComplete="off"
                      className="h-11 rounded-xl bg-background transition-shadow focus:ring-2 focus:ring-gold/50 focus:border-gold/60"
                    />
                  </div>

                  {/* Message Field - With Validation */}
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-message" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Message <span className="text-destructive">*</span>
                    </Label>
                    <textarea
                      id="contact-message"
                      rows={5}
                      placeholder="Write your message here… (minimum 10 characters)"
                      value={form.message}
                      onChange={set("message")}
                      required
                      minLength={10}
                      maxLength={2000}
                      className={`w-full rounded-xl border bg-background px-4 py-3 text-sm shadow-sm outline-none resize-none transition-shadow focus:ring-2 focus:ring-gold/50 focus:border-gold/60 ${
                        validationErrors.message ? 'border-destructive' : 'border-input'
                      }`}
                      aria-invalid={!!validationErrors.message}
                      aria-describedby={validationErrors.message ? "message-error" : undefined}
                    />
                    {validationErrors.message && (
                      <p id="message-error" className="text-xs text-destructive flex items-center gap-1 mt-1">
                        <AlertTriangle className="w-3 h-3" />{validationErrors.message}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">
                        {form.message.length}/2000 characters
                      </p>
                      <div className="h-1 w-24 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-gold to-gold-soft transition-all"
                          style={{ width: `${Math.min((form.message.length / 2000) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* General Error Message */}
                  {error && (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                      <p className="text-sm text-destructive flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />{error}
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={handleSubmit}
                    disabled={sending}
                    className="sheen w-full sm:w-auto h-12 px-8 rounded-xl font-semibold text-primary-foreground border-none bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--primary-glow)))] shadow-elevated hover:opacity-95 transition-opacity"
                    type="button"
                  >
                    {sending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Preparing…</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" /> Send Message</>
                    )}
                  </Button>
                </div>
              )}
            </motion.div>

            {/* ── Social / Quick Contact ── */}
            <motion.div
              variants={fadeUp}
              custom={1}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.1 }}
              className="lg:col-span-2 space-y-5"
            >
              <div className="bg-card rounded-3xl shadow-card border border-border/70 p-6">
                <h2 className="text-base font-heading font-bold text-foreground mb-1">
                  Connect With Us
                </h2>
                <p className="text-xs text-muted-foreground mb-4">
                  The fastest ways to reach our office.
                </p>
                <div className="space-y-3">
                  <a
                    href="https://wa.me/923469898295"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 w-full rounded-2xl border border-[#25D366]/25 bg-[#25D366]/10 hover:bg-[#25D366]/20 hover:border-[#25D366]/50 px-4 py-3 transition-all card-lift"
                  >
                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center shrink-0 shadow-md">
                      <MessageCircle className="w-5 h-5 text-white fill-white" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">WhatsApp</p>
                      <p className="text-xs text-muted-foreground">Quick reply, usually within hours</p>
                    </div>
                    <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-[#25D366] group-hover:translate-x-0.5 transition-all" />
                  </a>

                  <a
                    href="https://www.facebook.com/share/1EERTSk1W7/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 w-full rounded-2xl border border-[#1877F2]/25 bg-[#1877F2]/10 hover:bg-[#1877F2]/20 hover:border-[#1877F2]/50 px-4 py-3 transition-all card-lift"
                  >
                    <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1877F2] to-[#0C4A9E] flex items-center justify-center shrink-0 shadow-md">
                      <Facebook className="w-5 h-5 text-white" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">Facebook</p>
                      <p className="text-xs text-muted-foreground">Follow for news &amp; updates</p>
                    </div>
                    <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-[#1877F2] group-hover:translate-x-0.5 transition-all" />
                  </a>

                  {displayPhone && (
                    <a
                      href={`tel:${displayPhone.replace(/\s/g, "")}`}
                      className="group flex items-center gap-3 w-full rounded-2xl border border-primary/20 bg-primary/10 hover:bg-primary/20 hover:border-primary/50 px-4 py-3 transition-all card-lift"
                    >
                      <span className="icon-tile w-10 h-10 shadow-md">
                        <Phone className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Call Us</p>
                        <p className="text-xs text-muted-foreground">{displayPhone}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 ml-auto text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                    </a>
                  )}
                </div>
              </div>

              {/* Quick links — premium gold-accent panel */}
              <div className="relative border-gradient-gold rounded-3xl p-5 overflow-hidden">
                <div className="absolute top-0 inset-x-8 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent" />
                <div className="flex items-center gap-2 mb-3">
                  <GraduationCap className="w-4 h-4 text-gold" />
                  <p className="text-sm font-heading font-bold text-foreground">Looking for something specific?</p>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  For admission enquiries, visit the{" "}
                  {/* SPA links (NOT <a href>) — plain anchors reloaded the
                      entire page just to move to another internal page. */}
                  <Link to="/admission" className="text-primary font-semibold hover:underline decoration-gold/60 underline-offset-2">
                    Admission page
                  </Link>
                  . For results, visit the{" "}
                  <Link to="/results" className="text-primary font-semibold hover:underline decoration-gold/60 underline-offset-2">
                    Results page
                  </Link>.
                </p>
                <div className="mt-4 flex gap-2.5">
                  <Link
                    to="/admission"
                    className="sheen inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold px-4 py-2"
                  >
                    Admission <ArrowRight className="w-3 h-3" />
                  </Link>
                  <Link
                    to="/results"
                    className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 text-foreground text-xs font-semibold px-4 py-2 hover:bg-gold/20 transition-colors"
                  >
                    Results <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>
    </PageLayout>
  );
};

export default Contact;
