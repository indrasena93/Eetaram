const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app = express();
const parser = new Parser();
const PORT = process.env.PORT || 3000;

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
  all: { tag: 'Top News', color: '#CC0000' },
  telangana: { tag: 'Telangana', color: '#0044AA' },
  andhra: { tag: 'Andhra Pradesh', color: '#CC0000' },
  national: { tag: 'National', color: '#FF6600' },
  world: { tag: 'World', color: '#006633' },
  entertainment: { tag: 'Entertainment', color: '#880099' },
  sports: { tag: 'Sports', color: '#1565C0' },
  tech: { tag: 'Technology', color: '#0F9D58' },
  business: { tag: 'Business', color: '#004D40' },
  health: { tag: 'Health', color: '#2E7D32' }
};

const feedCache = new Map();
const FEED_TTL_MS = 5 * 60 * 1000;

async function extractArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return '';
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return article?.textContent || '';
  } catch {
    return '';
  }
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\d+\s+(minutes?|mins?|hours?|hrs?|days?)\s+ago\b/gi, ' ')
    .replace(/\b(Reuters|BBC|CNN|NDTV|The Hindu|Associated Press|AP News|CBS News|Fox News|Getty Images|Times of India|Indian Express)\b/gi, ' ')
    .replace(/\b(correspondent|editor|reporter|digital editor|Gaza correspondent)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function isBadSentence(s) {
  if (!s) return true;
  if (s.length < 60 || s.length > 280) return true;
  const bad = [
    /\b(read more|click here|newsletter|sign up|watch live|photo|image credit|copyright)\b/i,
    /\b(correspondent|editor|reporter)\b/i
  ];
  return bad.some(rx => rx.test(s));
}

function rewriteArticle(text, fallbackTitle = '') {
  const good = splitSentences(text).filter(s => !isBadSentence(s)).slice(0, 5);
  if (good.length < 2) return null;

  const title = fallbackTitle && fallbackTitle.trim().length > 20
    ? fallbackTitle.trim()
    : good[0].split(' ').slice(0, 11).join(' ') + '...';

  return {
    title,
    summary: good[0],
    body: good.slice(0, 3).join('\n\n')
  };
}

function normalizeTitle(t = '') {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
}

async function feedItems(url, tab) {
  try {
    const feed = await parser.parseURL(url);
    const meta = TAG_META[tab] || TAG_META.all;
    const items = [];

    for (const item of (feed.items || []).slice(0, 5)) {
      const title = (item.title || '').trim();
      const link = item.link || '';
      if (!title || !link) continue;

      const raw = await extractArticle(link);
      const rewritten = rewriteArticle(raw, title);
      if (!rewritten) continue;

      items.push({
        title: rewritten.title,
        desc: rewritten.summary,
        body: rewritten.body,
        pubDate: item.pubDate || new Date().toUTCString(),
        tag: meta.tag,
        color: meta.color,
        imgUrl: '',
        link
      });
    }
    return items;
  } catch {
    return [];
  }
}

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/news', async (req, res) => {
  const tab = req.query.tab || 'all';
  const cacheKey = `news:${tab}`;
  const cached = feedCache.get(cacheKey);

  if (cached && (Date.now() - cached.ts) < FEED_TTL_MS) {
    return res.json({ articles: cached.articles, cached: true });
  }

  const feeds = FEEDS[tab] || FEEDS.all;
  const results = await Promise.all(feeds.map(f => feedItems(f, tab)));
  let articles = results.flat();

  const seen = new Set();
  articles = articles.filter(a => {
    const key = normalizeTitle(a.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  feedCache.set(cacheKey, { ts: Date.now(), articles });
  res.json({ articles, cached: false });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
