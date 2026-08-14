import { useEffect } from "react";

const OG_IMAGE_PATH = "/og-image.svg";

/**
 * Per-route title, description, social preview and structured data for the
 * public pages (roadmap §15.3).
 *
 * The console is a single-page app, so without this every marketing route would
 * share one title in the browser tab, in a shared link and in a search result.
 *
 * The share image matters more here than it looks: in this market a link is
 * usually passed around in Messenger or Facebook, and a card with no picture
 * reads as a broken link rather than a product.
 */
export function useDocumentMeta(meta: {
  title: string;
  description: string;
  /** Emitted as JSON-LD so search results can show the plan and its price. */
  structuredData?: unknown;
}): void {
  const structured = meta.structuredData === undefined ? null : JSON.stringify(meta.structuredData);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = meta.title;

    const created: Element[] = [];
    const upsert = (attribute: "name" | "property", key: string, content: string) => {
      let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      if (tag === null) {
        tag = document.createElement("meta");
        tag.setAttribute(attribute, key);
        document.head.append(tag);
        created.push(tag);
      }
      tag.content = content;
    };

    upsert("name", "description", meta.description);
    upsert("property", "og:title", meta.title);
    upsert("property", "og:description", meta.description);
    upsert("property", "og:type", "website");
    upsert("property", "og:locale", "mn_MN");
    upsert("property", "og:site_name", "BuildWatch");
    // Absolute, because a crawler resolves this without the page's base URL.
    upsert("property", "og:image", new URL(OG_IMAGE_PATH, window.location.origin).toString());
    upsert("property", "og:image:alt", "BuildWatch — барилгын төслийн AI-agent удирдлага");
    upsert("name", "twitter:card", "summary_large_image");

    let script: HTMLScriptElement | null = null;
    if (structured !== null) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.text = structured;
      document.head.append(script);
      created.push(script);
    }

    return () => {
      document.title = previousTitle;
      // Only the tags this hook created are removed; anything the document
      // already shipped with is left alone.
      for (const tag of created) tag.remove();
    };
  }, [meta.title, meta.description, structured]);
}

/**
 * JSON-LD for the product and its published plans.
 *
 * Prices come from the API like everywhere else, so a plan change updates the
 * search snippet without anyone remembering to edit it.
 */
export function softwareApplicationSchema(input: {
  offers: readonly { name: string; priceMinor: string; currency: string; interval: string }[];
}): unknown {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "BuildWatch",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Барилгын төслийн зураг төсөл, өдрийн тайлан, гүйцэтгэл баталгаажуулалт, хугацааны урьдчилсан таамгийг нэгтгэсэн AI-agent удирдлагын систем.",
    inLanguage: "mn",
    offers: input.offers.map((offer) => ({
      "@type": "Offer",
      name: offer.name,
      price: (BigInt(offer.priceMinor) / 100n).toString(),
      priceCurrency: offer.currency,
      // VAT is quoted separately on the page, so the structured data says so too
      // rather than implying the listed number is the final charge.
      valueAddedTaxIncluded: false,
      category: offer.interval === "YEAR" ? "Annual subscription" : "Monthly subscription",
    })),
  };
}
