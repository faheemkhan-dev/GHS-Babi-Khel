import { Helmet } from "react-helmet-async";

export const SITE_URL  = "https://ghsbabikhel.dpdns.org";
export const SITE_NAME = "GHS Babi Khel";

// ✅ OG image: actual file is 1200×630 px (public/og-image.jpg)
const DEFAULT_IMAGE        = `${SITE_URL}/og-image.jpg`;
const DEFAULT_IMAGE_WIDTH  = "1200";
const DEFAULT_IMAGE_HEIGHT = "630";

// ✅ Twitter handle — update to your real @handle or set to "" to omit
const TWITTER_SITE = "@GHSBabiKhel";

export interface SEOProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
  imageWidth?: string;
  imageHeight?: string;
  keywords?: string;
  type?: "website" | "article" | "profile";
  noIndex?: boolean;
  jsonLd?: Record<string, any> | Record<string, any>[];
  breadcrumbs?: { name: string; path: string }[];
  /** Pass true on pages that have Urdu content — adds ur hreflang */
  hasUrdu?: boolean;
  /** ISO 8601 date string for article:published_time OG tag */
  publishedTime?: string;
  /** ISO 8601 date string for article:modified_time OG tag */
  modifiedTime?: string;
}

/**
 * SEO component — additive only. Uses react-helmet-async to inject
 * meta tags, Open Graph, Twitter cards, canonical, hreflang, and JSON-LD.
 */
const SEO = ({
  title,
  description,
  path = "",
  image = DEFAULT_IMAGE,
  imageWidth = DEFAULT_IMAGE_WIDTH,
  imageHeight = DEFAULT_IMAGE_HEIGHT,
  keywords,
  type = "website",
  noIndex = false,
  jsonLd,
  breadcrumbs,
  hasUrdu = false,
  publishedTime,
  modifiedTime,
}: SEOProps) => {
  const fullTitle = title.includes(SITE_NAME)
    ? title
    : `${title} | ${SITE_NAME}`;

  const url =
    `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`.replace(/\/$/, "") ||
    SITE_URL;

  const schemas: Record<string, any>[] = [];
  if (jsonLd) {
    if (Array.isArray(jsonLd)) schemas.push(...jsonLd);
    else schemas.push(jsonLd);
  }

  if (breadcrumbs && breadcrumbs.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: `${SITE_URL}${b.path.startsWith("/") ? b.path : `/${b.path}`}`,
      })),
    });
  }

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      <meta name="author" content={SITE_NAME} />
      <meta
        name="robots"
        content={
          noIndex
            ? "noindex, nofollow"
            : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
        }
      />

      {/* ✅ Canonical — prevents duplicate-content issues for every page */}
      <link rel="canonical" href={url} />

      {/* hreflang intentionally REMOVED: en-PK / ur / x-default all pointed
          to the SAME URL, which is a conflicting language signal Google
          ignores. Re-add only when separate Urdu URLs actually exist. */}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content={imageWidth} />
      <meta property="og:image:height" content={imageHeight} />
      <meta property="og:image:alt" content={fullTitle} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="en_PK" />
      {hasUrdu && <meta property="og:locale:alternate" content="ur_PK" />}
      {type === "article" && publishedTime && <meta property="article:published_time" content={publishedTime} />}
      {type === "article" && modifiedTime && <meta property="article:modified_time" content={modifiedTime} />}

      {/* ✅ Twitter — twitter:site added so card is attributed to school handle */}
      <meta name="twitter:card" content="summary_large_image" />
      {TWITTER_SITE && <meta name="twitter:site" content={TWITTER_SITE} />}
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={fullTitle} />

      {schemas.map((s, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(s)}
        </script>
      ))}
    </Helmet>
  );
};

export default SEO;
export { DEFAULT_IMAGE };
