import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import routeMetadata from "../content/routeMetadata.json";

const SITE = "https://codewire.tools";
const HOME_METADATA = {
  path: "/",
  title: "Codewire — NEC Field Calculators for Electricians",
  description:
    "Five NEC calculators in one fast, offline app for electricians: voltage drop, conduit fill, conduit bending, box fill, and wire ampacity. Instant pass/fail to the National Electrical Code.",
};

const metadataByPath = new Map(
  [
    HOME_METADATA,
    ...routeMetadata,
  ].map((metadata) => [metadata.path, metadata]),
);

function setMetaContent(selector: string, content: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) element.content = content;
}

export function RouteMetadata() {
  const { pathname } = useLocation();

  useEffect(() => {
    const metadata = metadataByPath.get(pathname);
    if (!metadata) return;

    const canonicalUrl = `${SITE}${metadata.path}`;
    document.title = metadata.title;
    setMetaContent('meta[name="description"]', metadata.description);
    setMetaContent('meta[property="og:title"]', metadata.title);
    setMetaContent('meta[property="og:description"]', metadata.description);
    setMetaContent('meta[property="og:url"]', canonicalUrl);
    setMetaContent('meta[name="twitter:title"]', metadata.title);
    setMetaContent('meta[name="twitter:description"]', metadata.description);

    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (canonical) canonical.href = canonicalUrl;
  }, [pathname]);

  return null;
}
