// Kino plugin: XVideos — v1.3.0
// Fix: resolve needs /video.<id>/<slug> (bare /video.<id>/ returns 404).
// More resilient stream extraction + popular tag rows on Home.

const BASE = "https://www.xvideos.com";

function log(...args) {
  try {
    kino.log(...args);
  } catch {
    // ignore
  }
}

function cleanText(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&comma;/g, ",")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return "";
      }
    })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDuration(text) {
  const t = String(text || "").toLowerCase();
  const h = /(\d+)\s*h/.exec(t);
  const m = /(\d+)\s*min/.exec(t);
  let minutes = 0;
  if (h) minutes += parseInt(h[1], 10) * 60;
  if (m) minutes += parseInt(m[1], 10);
  return minutes > 0 ? minutes : undefined;
}

function preferredQuality() {
  const q = String(kino.config.get("quality") || "high").toLowerCase();
  if (q === "low" || q === "hls") return q;
  return "high";
}

function searchParams() {
  return {
    sort: String(kino.config.get("sort") || "relevance"),
    duration: String(kino.config.get("duration") || "allduration"),
    onlyHd: kino.config.get("onlyHd") === true,
  };
}

/** Normalize any stored ref to a plain video eid (alphanumeric). */
function extractId(ref) {
  const s = String(ref || "").trim();
  if (!s) return "";
  // Full path: /video.eid/slug or video.eid/slug
  let m = /(?:^|\/)video\.([a-zA-Z0-9._-]+)/.exec(s);
  if (m) return m[1];
  // Classic numeric: /video12345/ or video12345
  m = /(?:^|\/)video(\d{5,})(?:\/|$)/.exec(s);
  if (m) return m[1];
  // id|slug or eid only
  const head = s.split(/[|/]/)[0];
  return head.replace(/[^a-zA-Z0-9._-]/g, "");
}

function toItem(v) {
  return {
    id: v.id,
    ref: v.id, // resolve only needs the eid; URL is built as /video.<eid>/x
    title: v.title,
    kind: "movie",
    poster: v.thumb,
    quality: v.hd ? v.hdLabel || "HD" : undefined,
    runtimeMinutes: v.durationMin,
    overview: v.duration || undefined,
    adult: true,
  };
}

function parseVideoCards(html) {
  const items = [];
  const seen = new Set();

  const starts = [];
  const startRe = /<div[^>]*\bid="video_([a-zA-Z0-9._-]+)"[^>]*>/gi;
  let sm;
  while ((sm = startRe.exec(html)) !== null) {
    starts.push({ id: sm[1], index: sm.index });
  }

  for (let i = 0; i < starts.length; i++) {
    const id = starts[i].id;
    if (seen.has(id)) continue;
    const from = starts[i].index;
    const to = i + 1 < starts.length ? starts[i + 1].index : from + 4000;
    const block = html.slice(from, Math.min(to, from + 4500));

    let title = "";
    const titleAttr =
      /<p[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"/i.exec(block) ||
      /<a[^>]*href="\/video\.[^"]*"[^>]*title="([^"]+)"/i.exec(block);
    if (titleAttr) title = cleanText(titleAttr[1]);

    if (!title || title.length < 2) {
      const titleText =
        /<p[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="\/video\.[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
          block
        );
      if (titleText) {
        title = cleanText(titleText[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, ""));
      }
    }

    if (!title || title.length < 2) {
      const hrefM = /href="\/video\.[a-zA-Z0-9._-]+\/(?:\d+\/\d+\/)?([^"?#]+)/i.exec(block);
      if (hrefM) title = cleanText(decodeURIComponent(hrefM[1]).replace(/_/g, " "));
    }

    if (!title || title.length < 2) continue;
    if (title.startsWith("/video.") || title.startsWith("video.")) {
      const hrefM = /href="\/video\.[a-zA-Z0-9._-]+\/(?:\d+\/\d+\/)?([^"?#]+)/i.exec(block);
      if (hrefM) title = cleanText(decodeURIComponent(hrefM[1]).replace(/_/g, " "));
      else continue;
    }

    let thumb;
    const dataSrc = /data-src="(https?:\/\/[^"]+)"/i.exec(block);
    const sfw = /data-sfwthumb="(https?:\/\/[^"]+)"/i.exec(block);
    const src = /<img[^>]+src="(https?:\/\/[^"]+)"/i.exec(block);
    if (dataSrc) thumb = dataSrc[1];
    else if (sfw) thumb = sfw[1];
    else if (src && !/blank\.gif|lightbox/i.test(src[1])) thumb = src[1];

    const durM =
      /<span[^>]*class="duration"[^>]*>([^<]+)</i.exec(block) ||
      /class="duration"[^>]*>([^<]+)/i.exec(block);
    const duration = durM ? cleanText(durM[1]) : undefined;

    const hdMark = /<span[^>]*class="[^"]*video-hd-mark[^"]*"[^>]*>([^<]*)</i.exec(block);
    const hd = !!hdMark || /video-hd-mark/i.test(block);
    const hdLabel = hdMark ? cleanText(hdMark[1]) || "HD" : hd ? "HD" : undefined;

    seen.add(id);
    items.push({
      id,
      title: title.slice(0, 200),
      thumb,
      duration,
      durationMin: parseDuration(duration),
      hd,
      hdLabel,
    });
  }

  if (items.length === 0) {
    const linkRe =
      /<a[^>]*href="\/video\.([a-zA-Z0-9._-]+)\/[^"]*"[^>]*title="([^"]+)"[^>]*>/gi;
    let lm;
    while ((lm = linkRe.exec(html)) !== null) {
      const id = lm[1];
      if (seen.has(id)) continue;
      const title = cleanText(lm[2]);
      if (!title || title.length < 2) continue;
      seen.add(id);
      const around = html.slice(Math.max(0, lm.index - 800), lm.index + 200);
      const ds = /data-src="(https?:\/\/[^"]+)"/i.exec(around);
      items.push({
        id,
        title: title.slice(0, 200),
        thumb: ds ? ds[1] : undefined,
        duration: undefined,
        durationMin: undefined,
        hd: /video-hd-mark/i.test(around),
        hdLabel: undefined,
      });
    }
  }

  return items;
}

async function fetchPage(path) {
  const url = path.startsWith("http") ? path : BASE + path;
  const r = await kino.fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Referer: BASE + "/",
    },
    timeoutMs: 15000,
  });
  if (!r.ok) throw new Error("xvideos respondió " + r.status);
  return r.text();
}

function buildSearchPath(q, page, params) {
  const parts = ["k=" + encodeURIComponent(q)];
  if (params.sort && params.sort !== "relevance") {
    parts.push("sort=" + encodeURIComponent(params.sort));
  }
  if (params.duration && params.duration !== "allduration") {
    parts.push("durf=" + encodeURIComponent(params.duration));
  }
  if (params.onlyHd) parts.push("quality=hd");
  if (page > 0) parts.push("p=" + page);
  return "/?" + parts.join("&");
}

function extractStreams(html) {
  const pick = (...pats) => {
    for (const p of pats) {
      const m = p.exec(html);
      if (m && m[1]) return m[1];
    }
    return null;
  };

  const hls = pick(
    /setVideoHLS\(['"]([^'"]+)['"]\)/,
    /html5player\.setVideoHLS\(['"]([^'"]+)['"]\)/,
    /"(https?:\/\/[^"]+\.m3u8[^"]*)"/,
    /'(https?:\/\/[^']+\.m3u8[^']*)'/
  );
  const high = pick(
    /setVideoUrlHigh\(['"]([^'"]+)['"]\)/,
    /html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/,
    /"(https?:\/\/[^"]*mp4[^"]*(?:hd|hq|1080|720)[^"]*)"/i
  );
  const low = pick(
    /setVideoUrlLow\(['"]([^'"]+)['"]\)/,
    /html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/
  );
  const mp4 = pick(
    /"(https?:\/\/[^"]+\.mp4[^"]*)"/,
    /'(https?:\/\/[^']+\.mp4[^']*)'/
  );
  const og = pick(
    /property="og:video(?::url)?"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:video(?::url)?"/i
  );

  return { hls, high, low, mp4, og };
}

// ---- search ---------------------------------------------------------------

export async function search(query) {
  const q = String(query.q || "").trim();
  if (!q) return [];

  const page = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0;
  const params = searchParams();

  let html;
  try {
    html = await fetchPage(buildSearchPath(q, page, params));
  } catch (e) {
    log("search failed", e.message);
    throw kino.error("unavailable", e.message);
  }

  let cards = parseVideoCards(html);
  if (params.onlyHd) cards = cards.filter((c) => c.hd);

  const qLower = q.toLowerCase();
  const qWords = qLower.split(/\s+/).filter(Boolean);
  cards.sort((a, b) => {
    const at = a.title.toLowerCase();
    const bt = b.title.toLowerCase();
    const aExact = at.includes(qLower) ? 0 : 1;
    const bExact = bt.includes(qLower) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aScore = qWords.reduce((s, w) => s + (at.includes(w) ? 1 : 0), 0);
    const bScore = qWords.reduce((s, w) => s + (bt.includes(w) ? 1 : 0), 0);
    return bScore - aScore;
  });

  const items = cards.slice(0, 100).map(toItem);
  const next = cards.length >= 24 ? String(page + 1) : undefined;
  return next ? { items, next } : items;
}

// ---- home -----------------------------------------------------------------

export async function home() {
  const rows = [];
  // Main feeds + popular categories/tags (xvideos /c/Name-N and /tags/slug)
  const sections = [
    { id: "fresh", title: "Recién subidos", path: "/" },
    { id: "best-week", title: "Mejores de la semana", path: "/best/week" },
    { id: "best-month", title: "Mejores del mes", path: "/best/month" },
    { id: "hits", title: "Más vistos", path: "/hits" },
    { id: "amateur", title: "Amateur", path: "/c/Amateur-65" },
    { id: "anal", title: "Anal", path: "/c/Anal-12" },
    { id: "blowjob", title: "Blowjob", path: "/c/Blowjob-15" },
    { id: "big-tits", title: "Big Tits", path: "/c/Big_Tits-23" },
    { id: "big-ass", title: "Big Ass", path: "/c/Big_Ass-24" },
    { id: "teen", title: "Teen", path: "/c/Teen_18_-13" },
    { id: "latina", title: "Latina", path: "/c/Latina-16" },
    { id: "lesbian", title: "Lesbian", path: "/c/Lesbian-26" },
    { id: "milf", title: "MILF", path: "/c/Milf-19" },
    { id: "asian", title: "Asian", path: "/c/Asian_Woman-32" },
    { id: "hardcore", title: "Hardcore", path: "/c/Hardcore-10" },
  ];

  for (const sec of sections) {
    try {
      const html = await fetchPage(sec.path);
      const cards = parseVideoCards(html).slice(0, 36);
      if (cards.length) {
        rows.push({
          id: sec.id,
          title: sec.title,
          items: cards.map(toItem),
          ref: sec.path.replace(/^\//, "") || "fresh",
        });
      }
    } catch (e) {
      log("home", sec.id, e.message);
    }
  }

  return rows;
}

// ---- browse ---------------------------------------------------------------

export async function browse(ref, cursor) {
  const page = cursor ? Math.max(0, Number(cursor) || 0) : 0;
  let path = "/" + String(ref || "fresh").replace(/^\/+/, "");
  if (path === "/fresh") path = "/";

  if (page > 0) {
    // Categories use /c/Name-N/N for pages sometimes; search uses ?p=
    if (path.startsWith("/c/") || path.startsWith("/tags/") || path.startsWith("/best")) {
      // xvideos category pagination: /c/Amateur-65/2
      if (!/\/\d+$/.test(path)) path = path + "/" + (page + 1);
      else path = path.replace(/\/\d+$/, "/" + (page + 1));
    } else {
      path += (path.includes("?") ? "&" : "?") + "p=" + page;
    }
  }

  let html;
  try {
    html = await fetchPage(path);
  } catch (e) {
    log("browse failed", e.message);
    throw kino.error("unavailable", e.message);
  }

  const cards = parseVideoCards(html);
  const items = cards.map(toItem);
  const next = cards.length >= 20 ? String(page + 1) : undefined;
  return { items, next };
}

// ---- resolve --------------------------------------------------------------

export async function resolve(ref) {
  // Never throw before first await (engine rule on older Kino)
  await Promise.resolve();

  const id = extractId(ref);
  if (!id) throw kino.error("not_found", "ref vacío");

  // xvideos returns 404 for /video.<id>/ without a path segment.
  // Any non-empty slug works (/x, /watch, real slug, etc.).
  const candidates = [
    BASE + "/video." + id + "/x",
    BASE + "/video." + id + "/watch",
    BASE + "/video." + id + "/" + id,
    BASE + "/video" + id + "/",
  ];

  let html = null;
  let finalUrl = null;

  for (const url of candidates) {
    try {
      const r = await kino.fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
          Accept: "text/html",
          Referer: BASE + "/",
        },
        timeoutMs: 15000,
      });
      if (!r.ok) {
        log("resolve status", r.status, url);
        continue;
      }
      const body = r.text();
      // Skip soft-404 pages
      if (/not found|página no encontrada|video not found/i.test(body) && !/setVideoHLS|setVideoUrlHigh/i.test(body)) {
        log("resolve soft-404", url);
        continue;
      }
      html = body;
      finalUrl = r.url;
      break;
    } catch (e) {
      log("resolve fetch", url, e.message || e);
    }
  }

  if (!html) {
    throw kino.error("not_found", "vídeo no encontrado");
  }

  const streams = extractStreams(html);
  const pref = preferredQuality();

  let streamUrl = null;
  let label = "Directo";

  if (pref === "hls") {
    streamUrl = streams.hls || streams.high || streams.og || streams.mp4 || streams.low;
    label = streams.hls ? "HLS" : "Respaldo";
  } else if (pref === "low") {
    streamUrl = streams.low || streams.high || streams.hls || streams.og || streams.mp4;
    label = streams.low ? "Baja" : "Respaldo";
  } else {
    streamUrl = streams.hls || streams.high || streams.og || streams.mp4 || streams.low;
    label = streams.hls ? "HLS" : streams.high ? "Alta" : "Directo";
  }

  if (!streamUrl) {
    log("no stream in page for", id);
    throw kino.error("unavailable", "no se encontró el stream");
  }

  const headers = {
    Referer: finalUrl || BASE + "/",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  };

  const isHls = /\.m3u8(\?|$)/i.test(streamUrl);
  const alternatives = [];
  const addAlt = (url, altLabel) => {
    if (url && url !== streamUrl) alternatives.push({ url, label: altLabel, headers });
  };
  if (pref !== "hls") addAlt(streams.hls, "HLS");
  if (pref !== "high") addAlt(streams.high, "Alta");
  if (pref !== "low") addAlt(streams.low, "Baja");
  addAlt(streams.mp4, "MP4");

  return {
    url: streamUrl,
    mime: isHls ? "application/x-mpegURL" : "video/mp4",
    headers,
    label,
    alternatives: alternatives.length ? alternatives : undefined,
  };
}
