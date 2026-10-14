/// <reference path="./kino.d.ts" />

const BASE = "https://www.xvideos.com";

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

function log(...args) {
  try {
    kino.log(...args);
  } catch {}
}

function cfg(key, fallback) {
  const v = kino.config.get(key);
  return v !== undefined && v !== null && v !== "" ? v : fallback;
}

async function fetchText(url) {
  const r = await kino.fetch(url, { headers: UA, timeoutMs: 20000 });
  if (!r.ok) throw kino.error("unavailable", "xVideos respondió " + r.status);
  return r.text();
}

function cleanQuery(q) {
  return String(q || "")
    .replace(/[^\p{L}\p{N}\s\-_.']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

/** Construye la URL de búsqueda con los filtros de ajustes */
function searchUrl(q, page) {
  const params = new URLSearchParams({
    k: q,
    p: String(page),
    sort: cfg("sort", "relevance"),
    quality: cfg("quality", "hd"),
    durf: cfg("durf", "allduration"),
    datef: cfg("datef", "all"),
  });
  return `${BASE}/?${params.toString()}`;
}

function parseSearchResults(html) {
  const maxItems = parseInt(cfg("resultsPerPage", "30"), 10) || 30;
  const items = [];
  const blocks = html.split(/id="video_/i).slice(1);

  for (const block of blocks) {
    if (items.length >= maxItems) break;
    try {
      const idMatch = block.match(/^([0-9a-z]+)/i);
      if (!idMatch) continue;
      const id = idMatch[1];

      const hrefMatch = block.match(/href="(\/video\.?[0-9a-z]+\/[^"#?]+)"/i);
      if (!hrefMatch) continue;
      const ref = hrefMatch[1];

      let title = "";
      const titleMatch =
        block.match(/title="([^"]{3,200})"/i) ||
        block.match(/<p class="title"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</i);
      if (titleMatch) title = decodeHtml(titleMatch[1].trim());
      if (!title || title.length < 3) continue;

      let poster = "";
      const imgMatch =
        block.match(/data-src="(https?:\/\/[^"]+)"/i) ||
        block.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
      if (imgMatch) poster = imgMatch[1].replace(/&amp;/g, "&");

      let quality = "";
      const durMatch = block.match(/class="duration"[^>]*>([^<]+)</i);
      if (durMatch) quality = durMatch[1].trim();
      if (/1080|4k/i.test(block)) quality = (quality ? quality + " · " : "") + "1080p";
      else if (/hd/i.test(block)) quality = (quality ? quality + " · " : "") + "HD";

      items.push({
        id: "xv-" + id,
        ref,
        title: title.slice(0, 200),
        kind: "movie",
        poster: poster || undefined,
        quality: quality || undefined,
        adult: true,
      });
    } catch (e) {
      log("parse item failed", e.message);
    }
  }

  const seen = new Set();
  return items.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------
export async function search(query) {
  const q = cleanQuery(query.q);
  if (!q) return [];

  const page = query.cursor ? parseInt(query.cursor, 10) || 0 : 0;
  const html = await fetchText(searchUrl(q, page));
  const items = parseSearchResults(html);

  if (items.length >= 15) {
    return { items, next: String(page + 1) };
  }
  return items;
}

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------
export async function home() {
  const rows = [];

  // Nuevos
  try {
    const html = await fetchText(BASE + "/");
    const items = parseSearchResults(html);
    if (items.length) {
      rows.push({
        id: "new",
        title: "Nuevos en xVideos",
        items,
        ref: "new",
      });
    }
  } catch (e) {
    log("home new failed", e.message);
  }

  // Mejor valorados del día
  try {
    const html = await fetchText(BASE + "/best");
    const items = parseSearchResults(html);
    if (items.length) {
      rows.push({
        id: "best",
        title: "Mejor valorados",
        items,
        ref: "best",
      });
    }
  } catch (e) {
    log("home best failed", e.message);
  }

  // Hits
  try {
    const html = await fetchText(BASE + "/hits");
    const items = parseSearchResults(html);
    if (items.length) {
      rows.push({
        id: "hits",
        title: "Más vistos",
        items,
        ref: "hits",
      });
    }
  } catch (e) {
    log("home hits failed", e.message);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// browse (Ver más)
// ---------------------------------------------------------------------------
export async function browse(ref, cursor) {
  const page = cursor ? parseInt(cursor, 10) || 0 : 0;
  let url;

  if (ref === "new") {
    url = page === 0 ? BASE + "/" : `${BASE}/new/${page}`;
  } else if (ref === "best") {
    url = page === 0 ? BASE + "/best" : `${BASE}/best/${page}`;
  } else if (ref === "hits") {
    url = page === 0 ? BASE + "/hits" : `${BASE}/hits/${page}`;
  } else {
    // ref = término de búsqueda guardado
    url = searchUrl(cleanQuery(ref), page);
  }

  const html = await fetchText(url);
  const items = parseSearchResults(html);

  return {
    items,
    next: items.length >= 15 ? String(page + 1) : undefined,
  };
}

// ---------------------------------------------------------------------------
// resolve + descarga
// ---------------------------------------------------------------------------
export async function resolve(ref) {
  let path = String(ref || "");
  if (!path.startsWith("/")) path = "/" + path;
  if (!/\/video\.?[0-9a-z]+/i.test(path)) {
    throw kino.error("not_found", "Referencia de vídeo no válida");
  }

  const pageUrl = BASE + path;
  const html = await fetchText(pageUrl);

  const streams = [];

  const high = html.match(/setVideoUrlHigh\(['"](https?:\/\/[^'"]+)['"]\)/i);
  if (high) {
    streams.push({
      url: high[1].replace(/&amp;/g, "&"),
      label: "MP4 Alta",
      quality: "high",
      mime: "video/mp4",
    });
  }

  const low = html.match(/setVideoUrlLow\(['"](https?:\/\/[^'"]+)['"]\)/i);
  if (low) {
    streams.push({
      url: low[1].replace(/&amp;/g, "&"),
      label: "MP4 Baja",
      quality: "low",
      mime: "video/mp4",
    });
  }

  const hls = html.match(/setVideoHLS\(['"](https?:\/\/[^'"]+)['"]\)/i);
  if (hls) {
    streams.push({
      url: hls[1].replace(/&amp;/g, "&"),
      label: "HLS",
      quality: "hls",
      mime: "application/x-mpegURL",
    });
  }

  if (streams.length === 0) {
    const any = html.match(
      /(?:setVideoUrl(?:High|Low)|html5player\.setVideoUrl(?:High|Low))\(['"](https?:\/\/[^'"]+)['"]\)/i
    );
    if (any) {
      streams.push({
        url: any[1].replace(/&amp;/g, "&"),
        label: "MP4",
        quality: "high",
        mime: "video/mp4",
      });
    }
  }

  if (streams.length === 0) {
    throw kino.error("not_found", "No se encontró stream reproducible");
  }

  // Preferencia del usuario
  const prefer = cfg("preferQuality", "high");
  const order = { high: 0, hls: 1, low: 2 };
  streams.sort((a, b) => {
    if (a.quality === prefer) return -1;
    if (b.quality === prefer) return 1;
    return (order[a.quality] ?? 9) - (order[b.quality] ?? 9);
  });

  const best = streams[0];
  const alternatives = streams.slice(1).map((s) => ({
    url: s.url,
    mime: s.mime,
    label: s.label,
  }));

  return {
    url: best.url,
    mime: best.mime || "video/mp4",
    label: best.label,
    alternatives: alternatives.length ? alternatives : undefined,
    headers: {
      Referer: BASE + "/",
      "User-Agent": UA["User-Agent"],
    },
  };
}
