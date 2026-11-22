import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  GraduationCap, MapPin, Phone, Mail,
  Facebook, MessageCircle,
} from "lucide-react";
import { useSchoolSettings, safeMediaUrl, optimizedCloudinaryUrl } from "@/hooks/useSchoolSettings";

// ── SEO / crawlability: every PUBLIC page must have at least one real <a href>
// that is present in the DOM WITHOUT any click or hover. The Navbar dropdown
// panels only mount their links while open, so a crawler (Googlebot's renderer
// never opens menus) saw NO link to /merit-list, /roll-no-slip,
// /contact — they were "orphan" pages Google could only
// find through the sitemap, which is the slowest way to get indexed. The footer
// renders on every page, so listing every public route here gives each one a
// permanent internal link from every other page.
const footerLinks = {
  quickLinks: [
    { to: "/about",     label: "About Us" },
    { to: "/admission", label: "Admission" },
    { to: "/duties",    label: "Exam Duties" },
    { to: "/teachers",  label: "Our Teachers" },
    { to: "/notices",   label: "Notices" },
    { to: "/faq",       label: "FAQs" },
    { to: "/contact",   label: "Contact Us" },
  ],
  resources: [
    { to: "/results",       label: "Results" },
    { to: "/merit-list",    label: "Merit List" },
    { to: "/roll-no-slip",  label: "Roll No. Slip" },
  ],
};

const Footer = () => {
  const { data: settings } = useSchoolSettings();
  const [logoFailed, setLogoFailed] = useState(false);

  // Reset logo failed state when URL changes
  useEffect(() => { setLogoFailed(false); }, [settings?.logo_url]);

  const displayEmail = settings?.email || "ghsbabikhel@gmail.com";

  const displayPhone = settings?.phone && settings.phone.trim().length > 5
    ? settings.phone
    : null;

  const school = settings?.school_name || "GHS Babi Khel";
  const gold = "text-[hsl(43_74%_66%)]";

  const Heading = ({ children }: { children: string }) => (
    <h3 className={`mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] ${gold}`}>
      {children}
      <span aria-hidden className="h-px w-6 bg-gradient-to-r from-[hsl(43_74%_66%/0.6)] to-transparent" />
    </h3>
  );

  const linkCls = "block py-[3px] text-[12.5px] text-white/70 transition-colors hover:text-[hsl(43_74%_66%)]";

  const contactRow = "flex items-center gap-2.5 text-[12px] text-white/75";
  const chip = "grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.07] text-[hsl(43_74%_66%)]";

  return (
    <footer className="border-t border-white/10 bg-[hsl(144_62%_14%)] text-[#E8F5EC] dark:bg-[hsl(146_41%_7%)]">
      {/* Signature brand hairline — forest green flowing into heritage gold */}
      <div className="h-px bg-gradient-to-r from-primary via-gold to-primary" aria-hidden="true" />

      <div className="container mx-auto px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-7 lg:pb-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-12 md:gap-x-8">

          {/* ── Brand ── */}
          <div className="col-span-2 md:col-span-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {settings?.logo_url && !logoFailed ? (
                  <img
                    src={optimizedCloudinaryUrl(settings.logo_url, { width: 240, quality: "auto:best" }) || safeMediaUrl(settings.logo_url)!}
                    alt={`${school} logo`}
                    width={44}
                    height={44}
                    className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-[hsl(43_74%_66%/0.5)] ring-offset-2 ring-offset-[hsl(144_62%_14%)] dark:ring-offset-[hsl(146_41%_7%)]"
                    loading="lazy"
                    decoding="async"
                    onError={() => setLogoFailed(true)}
                  />
                ) : (
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                    <GraduationCap className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0 leading-tight">
                  <span className="block truncate font-heading text-[15px] font-bold">{school}</span>
                  <span className={`mt-0.5 block truncate text-[10px] font-medium uppercase tracking-[0.14em] ${gold}`}>
                    {settings?.tagline || "Excellence in Education"}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 md:hidden">
                <a href="https://www.facebook.com/share/1EERTSk1W7/" target="_blank" rel="noopener noreferrer" aria-label="Follow GHS Babi Khel on Facebook"
                  className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/85 transition-colors hover:border-[#1877F2] hover:bg-[#1877F2]">
                  <Facebook className="h-3.5 w-3.5" />
                </a>
                <a href="https://wa.me/923469898295" target="_blank" rel="noopener noreferrer" aria-label="Contact GHS Babi Khel on WhatsApp"
                  className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/85 transition-colors hover:border-[#25D366] hover:bg-[#25D366]">
                  <MessageCircle className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <p className="mt-3 hidden max-w-xs text-[12px] leading-relaxed text-white/60 md:block">
              {settings?.description || "Committed to quality education and nurturing the future leaders of Pakistan."}
            </p>
            <div className="mt-3 hidden items-center gap-1.5 md:flex">
              <a href="https://www.facebook.com/share/1EERTSk1W7/" target="_blank" rel="noopener noreferrer" aria-label="Follow GHS Babi Khel on Facebook"
                className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/85 transition-colors hover:border-[#1877F2] hover:bg-[#1877F2]">
                <Facebook className="h-3.5 w-3.5" />
              </a>
              <a href="https://wa.me/923469898295" target="_blank" rel="noopener noreferrer" aria-label="Contact GHS Babi Khel on WhatsApp"
                className="grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-white/[0.04] text-white/85 transition-colors hover:border-[#25D366] hover:bg-[#25D366]">
                <MessageCircle className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* ── Explore ── */}
          <nav aria-label="Quick links" className="md:col-span-2 md:col-start-6">
            <Heading>Explore</Heading>
            <ul>
              {footerLinks.quickLinks.map((l) => (
                <li key={l.to}><Link to={l.to} className={linkCls}>{l.label}</Link></li>
              ))}
            </ul>
          </nav>

          {/* ── Resources ── */}
          <nav aria-label="Resources" className="md:col-span-2">
            <Heading>Resources</Heading>
            <ul>
              {footerLinks.resources.map((l) => (
                <li key={l.to}><Link to={l.to} className={linkCls}>{l.label}</Link></li>
              ))}
            </ul>
          </nav>

          {/* ── Contact ── */}
          <div className="col-span-2 md:col-span-3">
            <Heading>Contact</Heading>
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className={contactRow}>
                <span className={chip}><MapPin className="h-3 w-3" /></span>
                <span className="min-w-0">{settings?.address || "Babi Khel, District Mohmand, KPK"}</span>
              </div>
              {displayPhone && (
                <a href={`tel:${displayPhone.replace(/\s/g, "")}`} className={`${contactRow} transition-colors hover:text-white`}>
                  <span className={chip}><Phone className="h-3 w-3" /></span>
                  {displayPhone}
                </a>
              )}
              <a href={`mailto:${displayEmail}`} className={`${contactRow} transition-colors hover:text-white`}>
                <span className={chip}><Mail className="h-3 w-3" /></span>
                <span className="min-w-0 break-all">{displayEmail}</span>
              </a>
            </div>
          </div>
        </div>

        {/* ── Bottom line ── */}
        <div className="mt-6 flex flex-col items-center justify-between gap-0.5 border-t border-white/10 pt-3 text-[10.5px] text-white/50 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} {school}. All rights reserved.</p>
          <p>EMIS: {settings?.emis_code || "60673"}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
