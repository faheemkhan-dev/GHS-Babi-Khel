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

  const allLinks = [...footerLinks.quickLinks, ...footerLinks.resources];
  const school = settings?.school_name || "GHS Babi Khel";

  return (
    <footer className="border-t border-white/10 bg-[hsl(144_62%_14%)] text-[#E8F5EC] dark:bg-[hsl(146_41%_7%)]">
      {/* Signature brand hairline — forest green flowing into heritage gold */}
      <div className="h-px bg-gradient-to-r from-primary via-gold to-primary" aria-hidden="true" />
      <div className="container mx-auto px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-5 lg:pb-4">

        {/* Brand row: small logo + name/tagline, socials on the right */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {settings?.logo_url && !logoFailed ? (
              <img
                src={optimizedCloudinaryUrl(settings.logo_url, { width: 64 }) || safeMediaUrl(settings.logo_url)!}
                alt={`${school} logo`}
                className="h-8 w-8 shrink-0 rounded-lg object-cover ring-1 ring-[hsl(43_74%_66%/0.45)]"
                loading="lazy"
                decoding="async"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <GraduationCap className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 leading-tight">
              <span className="block truncate font-heading text-[14px] font-bold">{school}</span>
              <span className="block truncate text-[10.5px] text-white/60">{settings?.tagline || "Excellence in Education"}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href="https://www.facebook.com/share/1EERTSk1W7/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Follow GHS Babi Khel on Facebook"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/15 text-white/80 transition-colors hover:border-[#1877F2] hover:bg-[#1877F2] hover:text-white"
            >
              <Facebook className="h-3.5 w-3.5" />
            </a>
            <a
              href="https://wa.me/923469898295"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Contact GHS Babi Khel on WhatsApp"
              className="grid h-7 w-7 place-items-center rounded-full border border-white/15 text-white/80 transition-colors hover:border-[#25D366] hover:bg-[#25D366] hover:text-white"
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* Links — one compact wrapping row (every public route stays crawlable) */}
        <nav aria-label="Footer" className="mt-4 flex flex-wrap justify-center gap-x-3.5 gap-y-1.5 border-t border-white/10 pt-3.5 text-[11.5px]">
          {allLinks.map((link) => (
            <Link key={link.to} to={link.to} className="text-white/70 transition-colors hover:text-[hsl(43_74%_66%)]">
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Contact — tiny single-line items */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-white/65">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3 w-3 shrink-0 text-[hsl(43_74%_66%)]" />
            {settings?.address || "Babi Khel, District Mohmand, KPK"}
          </span>
          {displayPhone && (
            <a href={`tel:${displayPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 transition-colors hover:text-white">
              <Phone className="h-3 w-3 shrink-0 text-[hsl(43_74%_66%)]" />
              {displayPhone}
            </a>
          )}
          <a href={`mailto:${displayEmail}`} className="inline-flex items-center gap-1.5 transition-colors hover:text-white">
            <Mail className="h-3 w-3 shrink-0 text-[hsl(43_74%_66%)]" />
            {displayEmail}
          </a>
        </div>

        {/* Bottom line */}
        <div className="mt-3.5 flex flex-col items-center justify-between gap-0.5 border-t border-white/10 pt-3 text-[10.5px] text-white/50 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} {school}. All rights reserved.</p>
          <p>EMIS: {settings?.emis_code || "60673"}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
