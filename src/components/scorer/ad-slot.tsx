import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function loadScript(client: string) {
  const id = "adsense-js";
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
}

/** Manual unit only. Stays unmounted during live scoring so taps can't hit an ad. */
export function AdSlot({ client, slot }: { client: string; slot: string }) {
  const pushed = useRef(false);

  useEffect(() => {
    if (!client || !slot || pushed.current) return;
    pushed.current = true;
    loadScript(client);
    const timer = window.setTimeout(() => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        pushed.current = false;
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [client, slot]);

  if (!client || !slot) return null;

  return (
    <aside className="border-line mt-6 border-t pt-4" aria-label="Advertisement">
      <p className="text-faint mb-2 text-xs font-medium tracking-wide uppercase">Advertisement</p>
      <ins
        className="adsbygoogle block min-h-16"
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
