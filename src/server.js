
const express = require('express');
const Parser  = require('rss-parser');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app    = express();
const parser = new Parser({ customFields: { item: [['media:content','media:content'],['media:thumbnail','media:thumbnail']] } });
const PORT   = process.env.PORT || 3000;

/* ── Feeds ── */
const FEEDS = {
  all: [
    'https://feeds.feedburner.com/ndtvnews-top-stories',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.feedburner.com/ndtvnews-india-news',
    'https://www.thehindu.com/news/national/feeder/default.rss',
    'https://indianexpress.com/feed/'
  ],
  telangana: [
    'https://www.thehindu.com/news/national/telangana/feeder/default.rss',
    'https://timesofindia.indiatimes.com/rssfeeds/-2128816011.cms'
  ],
  andhra: [
    'https://www.thehindu.com/news/national/andhra-pradesh/feeder/default.rss',
    'https://timesofindia.indiatimes.com/rssfeeds/7098551.cms'
  ],
  national: [
    'https://feeds.feedburner.com/ndtvnews-india-news',
    'https://www.thehindu.com/news/national/feeder/default.rss',
    'https://indianexpress.com/section/india/feed/'
  ],
  world: [
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://feeds.bbci.co.uk/news/world/asia/rss.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'
  ],
  entertainment: [
    'https://feeds.feedburner.com/ndtvnews-entertainment',
    'https://indianexpress.com/section/entertainment/feed/'
  ],
  sports: [
    'https://feeds.feedburner.com/ndtvnews-sports',
    'https://feeds.bbci.co.uk/sport/rss.xml'
  ],
  tech: [
    'https://feeds.feedburner.com/TechCrunch',
    'https://feeds.bbci.co.uk/news/technology/rss.xml'
  ],
  business: [
    'https://feeds.feedburner.com/ndtvnews-business',
    'https://feeds.bbci.co.uk/news/business/rss.xml'
  ],
  health: [
    'https://feeds.bbci.co.uk/news/health/rss.xml'
  ]
};

const TAG_META = {
  all:           { tag: 'Top News',       color: '#CC0000' },
  telangana:     { tag: 'Telangana',      color: '#0044AA' },
  andhra:        { tag: 'Andhra Pradesh', color: '#CC0000' },
  national:      { tag: 'National',       color: '#FF6600' },
  world:         { tag: 'World',          color: '#006633' },
  entertainment: { tag: 'Entertainment',  color: '#880099' },
  sports:        { tag: 'Sports',         color: '#1565C0' },
  tech:          { tag: 'Technology',     color: '#0F9D58' },
  business:      { tag: 'Business',       color: '#004D40' },
  health:        { tag: 'Health',         color: '#2E7D32' }
};

/* ─────────────────────────────────────────────
   IMAGE EXTRACTION HELPERS
───────────────────────────────────────────── */

/**
 * Pull image from an RSS <item> node.
 * Checks: enclosure, media:thumbnail, media:content, <img> in description HTML.
 */
function imgFromRssItem(item) {
  /* 1. enclosure (podcast / photo feeds) */
  if (item.enclosure?.url && /\.(jpg|jpeg|png|webp|gif)/i.test(item.enclosure.url))
    return item.enclosure.url;

  /* 2. media:thumbnail */
  const mt = item['media:thumbnail'];
  if (mt) {
    const url = typeof mt === 'string' ? mt : (mt?.$ ?.url || mt?.url);
    if (url) return url;
  }

  /* 3. media:content */
  const mc = item['media:content'];
  if (mc) {
    const url = typeof mc === 'string' ? mc : (mc?.$ ?.url || mc?.url);
    if (url && /image/i.test(mc?.$ ?.medium || mc?.medium || 'image')) return url;
  }

  /* 4. <img> inside description or content:encoded HTML */
  const htmlStr = item['content:encoded'] || item.content || item.description || '';
  if (htmlStr) {
    const m = htmlStr.match(/<img[^>]+src=["']([^"']+\.(jpg|jpeg|png|webp))/i);
    if (m) return m[1];
  }

  return '';
}

/**
 * Fetch the article page and extract:
 *  - article text (via Readability)
 *  - best thumbnail (og:image > twitter:image > first large <img> in article)
 *
 * Returns { text, imgUrl }
 */
async function extractArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return { text: '', imgUrl: '' };

    const html = await res.text();
    const dom  = new JSDOM(html, { url });
    const doc  = dom.window.document;

    /* ── Extract OG / Twitter image first ── */
    let imgUrl = '';

    const ogImg = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
               || doc.querySelector('meta[name="og:image"]')?.getAttribute('content');
    if (ogImg && ogImg.startsWith('http')) imgUrl = ogImg;

    if (!imgUrl) {
      const twImg = doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
                 || doc.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content');
      if (twImg && twImg.startsWith('http')) imgUrl = twImg;
    }

    /* ── Readability for text ── */
    const reader  = new Readability(doc.cloneNode(true));
    const article = reader.parse();
    const text    = article?.textContent || '';

    /* ── If still no image, scan article's first large <img> ── */
    if (!imgUrl && article?.content) {
      const tmpDom = new JSDOM(article.content);
      const imgs   = [...tmpDom.window.document.querySelectorAll('img')];
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        /* skip tiny tracking pixels and SVG icons */
        const w = parseInt(img.getAttribute('width') || '9999', 10);
        const h = parseInt(img.getAttribute('height') || '9999', 10);
        if (src.startsWith('http') && !/svg|pixel|tracking|logo/i.test(src) && w > 100 && h > 60) {
          imgUrl = src;
          break;
        }
      }
      /* last resort: first http img without size constraints */
      if (!imgUrl) {
        for (const img of imgs) {
          const src = img.getAttribute('src') || '';
          if (src.startsWith('http') && !/svg|1x1|pixel/i.test(src)) { imgUrl = src; break; }
        }
      }
    }

    return { text, imgUrl };
  } catch {
    return { text: '', imgUrl: '' };
  }
}

/* ─────────────────────────────────────────────
   TEXT PROCESSING
───────────────────────────────────────────── */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, ' ').replace(/\n+/g, ' ').replace(/\s+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\d+\s+(minutes?|mins?|hours?|hrs?|days?)\s+ago\b/gi, ' ')
    .replace(/\b(Reuters|BBC|CNN|NDTV|The Hindu|Associated Press|AP News|CBS News|Fox News|Getty Images|Times of India|Indian Express)\b/gi, ' ')
    .replace(/\b(correspondent|editor|reporter|digital editor|Gaza correspondent)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim();
}

function sentences(text) {
  return cleanText(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function isBadSentence(s) {
  if (!s || s.length < 60 || s.length > 600) return true;
  return [
    /\b(read more|click here|newsletter|sign up|watch live|photo|image credit|copyright)\b/i,
    /\b(correspondent|editor|reporter)\b/i
  ].some(rx => rx.test(s));
}

function rewriteArticle(text, fallbackTitle = '') {
  const good = sentences(text).filter(s => !isBadSentence(s));
  if (good.length < 1) return null;
  const title = fallbackTitle?.trim().length > 20
    ? fallbackTitle.trim()
    : good[0].split(' ').slice(0, 11).join(' ') + '...';
  return { title, summary: good[0], body: good.slice(0, 8).join('\n\n') };
}

function normalizeTitle(t = '') {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}

/* ─────────────────────────────────────────────
   FEED PROCESSING
───────────────────────────────────────────── */
async function feedItems(feedUrl, tab) {
  try {
    const feed     = await parser.parseURL(feedUrl);
    const meta     = TAG_META[tab] || TAG_META.all;
    const rawItems = (feed.items || []).slice(0, 5);

    const results = await Promise.all(
      rawItems.map(async (item) => {
        const title = (item.title || '').trim();
        const link  = item.link || '';
        if (!title || !link) return null;

        /* Extract image from RSS first (fast, no extra fetch needed) */
        const rssImg = imgFromRssItem(item);

        /* Fetch article page for text + potentially better og:image */
        const { text, imgUrl: pageImg } = await extractArticle(link);

        /* Priority: og:image from page > RSS media image */
        const imgUrl = pageImg || rssImg;

        const rewritten = rewriteArticle(text, title);
        if (!rewritten) return null;

        return {
          title:   rewritten.title,
          desc:    rewritten.summary,
          body:    rewritten.body,
          pubDate: item.pubDate || new Date().toUTCString(),
          tag:     meta.tag,
          color:   meta.color,
          imgUrl,
          link
        };
      })
    );

    return results.filter(Boolean);
  } catch {
    return [];
  }
}

/* ─────────────────────────────────────────────
   API ROUTES
───────────────────────────────────────────── */
app.get('/api/news', async (req, res) => {
  const tab   = req.query.tab || 'all';
  const feeds = FEEDS[tab] || FEEDS.all;

  const results = await Promise.all(feeds.map(f => feedItems(f, tab)));
  let articles  = results.flat();

  const seen = new Set();
  articles = articles.filter(a => {
    const key = normalizeTitle(a.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json({ articles });
});

app.use(express.json());
app.post('/api/article', (req, res) => {
  const { title, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'Missing article data' });
  res.json({ article: { title, body: body.split('\n\n').filter(Boolean) } });
});

app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`Eetaram running → http://localhost:${PORT}`);
});
