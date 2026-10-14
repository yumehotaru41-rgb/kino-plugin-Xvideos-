// Kino plugin: XVideos (xvideos.com) — adult video search and playback.
// apiVersion 6: adult flag, streamHosts any, settings, download.
// Parser updated for current xvideos HTML (id="video_<eid>", data-src thumbs, title attr).

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
  const sort = String(kino.config.get("sort") || "relevance");
  const duration = String(kino.config.get("duration") || "allduration");
  const onlyHd = kino.config.get("onlyHd") === true;
  return { sort, duration, onlyHd };
}

function toItem(v) {
  return {
    id: v.id,
    ref: v.id,
    title: v.title,
    kind: "movie",
    poster: v.thumb,
    quality: v.hd ? (v.hdLabel || "HD") : undefined,
    runtimeMinutes: v.durationMin,
    overview: v.duration || undefined,
    adult: true,
  };
}

/**
 * Parse video cards from current xvideos listing HTML.
 * Structure (2026):
 *   <div id="video_<eid>" data-id="..." data-eid="..." class="... thumb-block ...">
 *     <div class="thumb-inside">...<img data-src="THUMB" ...>
 *       <span class="video-hd-mark">1080p</span>
 *     <div class="thumb-under">
 *       <p class="title"><a href="/video.<eid>/slug" title="TITLE">TITLE <span class="duration">N min</span></a></p>
 */
function parseVideoCards(html) {
  const items = [];
  const seen = new Set();

  // Split by video block starts (more resilient than matching balanced divs)
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

    // Title: prefer title="..." on the title link
    let title = "";
    const titleAttr =
      /<p[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*title="([^"]+)"/i.exec(block) ||
      /<a[^>]*href="\/video\.[^"]*"[^>]*title="([^"]+)"/i.exec(block);
    if (titleAttr) {
      title = cleanText(titleAttr[1]);
    }
    // Fallback: text content of the title <a>, strip duration span
    if (!title || title.length < 2) {
      const titleText =
        /<p[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="\/video\.[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
          block
        );
      if (titleText) {
        title = cleanText(titleText[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, ""));
      }
    }
    // Last resort: slug from href
    if (!title || title.length < 2) {
      const hrefM = /href="\/video\.[a-zA-Z0-9._-]+\/(?:\d+\/\d+\/)?([^"?]+)/i.exec(block);
      if (hrefM) {
        title = cleanText(decodeURIComponent(hrefM[1]).replace(/_/g, " "));
      }
    }
    if (!title || title.length < 2) continue;
    // Avoid using path-looking titles
    if (title.startsWith("/video.") || title.startsWith("video.")) {
      const hrefM = /href="\/video\.[a-zA-Z0-9._-]+\/(?:\d+\/\d+\/)?([^"?]+)/i.exec(block);
      if (hrefM) title = cleanText(decodeURIComponent(hrefM[1]).replace(/_/g, " "));
      else continue;
    }

    // Thumbnail: data-src preferred (lazy), then data-sfwthumb, then src if not blank.gif
    let thumb;
    const dataSrc = /data-src="(https?:\/\/[^"]+)"/i.exec(block);
    const sfw = /data-sfwthumb="(https?:\/\/[^"]+)"/i.exec(block);
    const src = /<img[^>]+src="(https?:\/\/[^"]+)"/i.exec(block);
    if (dataSrc) thumb = dataSrc[1];
    else if (sfw) thumb = sfw[1];
    else if (src && !/blank\.gif|lightbox/i.test(src[1])) thumb = src[1];

    // Duration
    const durM =
      /<span[^>]*class="duration"[^>]*>([^<]+)</i.exec(block) ||
      /class="duration"[^>]*>([^<]+)/i.exec(block);
    const duration = durM ? cleanText(durM[1]) : undefined;
    const durationMin = parseDuration(duration);

    // HD mark (1080p, 720p, HD, etc.)
    const hdMark = /<span[^>]*class="[^"]*video-hd-mark[^"]*"[^>]*>([^<]*)</i.exec(block);
    const hd = !!hdMark || /video-hd-mark/i.test(block);
    const hdLabel = hdMark ? cleanText(hdMark[1]) || "HD" : hd ? "HD" : undefined;

    seen.add(id);
    items.push({
      id,
      title: title.slice(0, 200),
      thumb,
      duration,
      durationMin,
      hd,
      hdLabel,
    });
  }

  // Fallback if the id="video_" pattern disappeared entirely
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
  if (params.onlyHd) {
    parts.push("quality=hd");
  }
  if (page > 0) {
    parts.push("p=" + page);
  }
  return "/?" + parts.join("&");
}

// ---- search ---------------------------------------------------------------

export async function search(query) {
  const q = String(query.q || "").trim();
  if (!q) return [];

  const page = query.cursor ? Math.max(0, Number(query.cursor) || 0) : 0;
  const params = searchParams();
  const path = buildSearchPath(q, page, params);

  let html;
  try {
    html = await fetchPage(path);
  } catch (e) {
    log("search failed", e.message);
    throw kino.error("unavailable", e.message);
  }

  let cards = parseVideoCards(html);

  if (params.onlyHd) {
    cards = cards.filter((c) => c.hd);
  }

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

  if (next) return { items, next };
  return items;
}

// ---- home -----------------------------------------------------------------

export async function home() {
  const rows = [];
  const sections = [
    { id: "fresh", title: "Recién subidos", path: "/" },
    { id: "best-week", title: "Mejores de la semana", path: "/best/week" },
    { id: "best-month", title: "Mejores del mes", path: "/best/month" },
    { id: "hits", title: "Más vistos", path: "/hits" },
  ];

  for (const sec of sections) {
    try {
      const html = await fetchPage(sec.path);
      const cards = parseVideoCards(html).slice(0, 40);
      if (cards.length) {
        rows.push({
          id: sec.id,
          title: sec.title,
          items: cards.map(toItem),
          ref: sec.path.replace(/^\//, "") || "fresh",
        });
      }
    } catch (e) {
      log("home", sec.id, "failed", e.message);
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
    path += (path.includes("?") ? "&" : "?") + "p=" + page;
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
  const next = cards.length >= 24 ? String(page + 1) : undefined;
  return { items, next };
}

// ---- resolve --------------------------------------------------------------

export async function resolve(ref) {
  const id = String(ref || "").replace(/[^a-zA-Z0-9._-]/g, "");
  if (!id) throw kino.error("not_found", "ref vacío");

  const candidates = [
    BASE + "/video." + id + "/",
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
      if (r.ok) {
        html = r.text();
        finalUrl = r.url;
        break;
      }
    } catch (e) {
      log("resolve fetch", url, e.message);
    }
  }

  if (!html) throw kino.error("not_found", "vídeo no encontrado");

  const high =
    /setVideoUrlHigh\(['"]([^'"]+)['"]\)/.exec(html) ||
    /html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/.exec(html);
  const low =
    /setVideoUrlLow\(['"]([^'"]+)['"]\)/.exec(html) ||
    /html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/.exec(html);
  const hls =
    /setVideoHLS\(['"]([^'"]+)['"]\)/.exec(html) ||
    /html5player\.setVideoHLS\(['"]([^'"]+)['"]\)/.exec(html);

  const og =
    /property="og:video(?::url)?"\s+content="([^"]+)"/i.exec(html) ||
    /content="([^"]+)"\s+property="og:video(?::url)?"/i.exec(html);

  const mp4Hd =
    /"(https?:\/\/[^"]*mp4[^"]*(?:hd|hq|1080|720)[^"]*)"/i.exec(html) ||
    /'(https?:\/\/[^']*mp4[^']*(?:hd|hq|1080|720)[^']*)'/i.exec(html);
  const mp4 =
    /"(https?:\/\/[^"]+\.mp4[^"]*)"/.exec(html) ||
    /'(https?:\/\/[^']+\.mp4[^']*)'/.exec(html);
  const m3u8 =
    /"(https?:\/\/[^"]+\.m3u8[^"]*)"/.exec(html) ||
    /'(https?:\/\/[^']+\.m3u8[^']*)'/.exec(html);

  const streams = {
    hls: (hls && hls[1]) || (m3u8 && m3u8[1]) || null,
    high: (high && high[1]) || (mp4Hd && mp4Hd[1]) || null,
    low: (low && low[1]) || null,
    og: (og && og[1]) || null,
    mp4: (mp4 && mp4[1]) || null,
  };

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
    log("no stream found for", id);
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
    if (url && url !== streamUrl) {
      alternatives.push({ url, label: altLabel, headers });
    }
  };

  if (pref !== "hls") addAlt(streams.hls, "HLS");
  if (pref !== "high") addAlt(streams.high, "Alta");
  if (pref !== "low") addAlt(streams.low, "Baja");
  addAlt(streams.mp4, "MP4");
  addAlt(streams.og, "OG");

  return {
    url: streamUrl,
    mime: isHls ? "application/x-mpegURL" : "video/mp4",
    headers,
    label,
    alternatives: alternatives.length ? alternatives : undefined,
  };
}
