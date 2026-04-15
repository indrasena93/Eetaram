const express = require('express');
const path = require('path');
const Parser = require('rss-parser');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

const app = express();
const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EetaramBot/1.0)' }
});

const PORT = process.env.PORT || 3000;
const publicPath = path.join(__dirname, '..', 'public');

const FEEDS = {
  all: [
    { url:'https://feeds.feedburner.com/ndtvnews-top-stories', tag:'National', color:'#CC0000' },
    { url:'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', tag:'National', color:'#CC0000' },
    { url:'https://feeds.bbci.co.uk/news/world/rss.xml', tag:'World', color:'#006633' },
    { url:'https://www.thehindu.com/news/national/feeder/default.rss', tag:'National', color:'#FF6600' },
    { url:'https://indianexpress.com/feed/', tag:'National', color:'#1a237e' }
  ],
  telangana: [
    { url:'https://www.thehindu.com/news/national/telangana/feeder/default.rss', tag:'Telangana', color:'#0044AA' }
  ],
  andhra: [
    { url:'https://www.thehindu.com/news/national/andhra-pradesh/feeder/default.rss', tag:'Andhra Pradesh', color:'#CC0000' }
  ],
  national: [
    { url:'https://feeds.feedburner.com/ndtvnews-india-news', tag:'National', color:'#FF6600' },
    { url:'https://www.thehindu.com/news/national/feeder/default.rss', tag:'National', color:'#8B0000' },
    { url:'https://indianexpress.com/section/india/feed/', tag:'National', color:'#1a237e' }
  ],
  world: [
    { url:'https://feeds.bbci.co.uk/news/world/rss.xml', tag:'World', color:'#006633' },
    { url:'https://feeds.bbci.co.uk/news/world/asia/rss.xml', tag:'Asia', color:'#2E7D32' },
    { url:'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', tag:'World', color:'#222222' }
  ],
  entertainment: [
    { url:'https://feeds.feedburner.com/ndtvnews-entertainment', tag:'Entertainment', color:'#AA0066' },
    { url:'https://indianexpress.com/section/entertainment/feed/', tag:'Entertainment', color:'#880099' }
  ],
  sports: [
    { url:'https://feeds.feedburner.com/ndtvnews-sports', tag:'Sports', color:'#1565C0' },
    { url:'https://feeds.bbci.co.uk/sport/rss.xml', tag:'Sports', color:'#0D47A1' }
  ],
  tech: [
    { url:'https://feeds.feedburner.com/TechCrunch', tag:'Technology', color:'#0F9D58' },
    { url:'https://feeds.bbci.co.uk/news/technology/rss.xml', tag:'Technology', color:'#0F9D58' }
  ],
  business: [
    { url:'https://feeds.feedburner.com/ndtvnews-business', tag:'Business', color:'#004D40' },
    { url:'https://feeds.bbci.co.uk/news/business/rss.xml', tag:'Business', color:'#004D40' }
  ],
  health: [
    { url:'https://feeds.bbci.co.uk/news/health/rss.xml', tag:'Health', color:'#2E7D32' }
  ]
};

const newsCache = new Map();
const articleCache = new Map();
const NEWS_TTL_MS = 5 * 60 * 1000;
const ARTICLE_TTL_MS = 30 * 60 * 1000;

function stripHtml(input = '') {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCase(s='') {
  return s.replace(/\s+/g, ' ').trim();
}

function shortSummary(title = '', desc = '') {
  const cleaned = sentenceCase(stripHtml(desc));
  if (!cleaned) return title;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
  const best = (sentences[0] || cleaned).slice(0, 220).trim();
  return best.length < cleaned.length ? best + (/[.!?]$/.test(best) ? '' : '...') : best;
}

function normalizeTitle(title='') {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function timeValue(pubDate) {
  const d = new Date(pubDate || 0);
  return isNaN(d) ? 0 : d.getTime();
}

function splitParagraphs(text='') {
  const cleaned = sentenceCase(text);
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const paras = [];
  for (let i = 0; i < sentences.length; i += 3) {
    const chunk = sentences.slice(i, i + 3).join(' ').trim();
    if (chunk) paras.push(chunk);
  }
  return paras;
}

async function fetchFeed(feedDef) {
  try {
    const feed = await parser.parseURL(feedDef.url);
    return (feed.items || []).slice(0, 10).map(item => {
      const title = sentenceCase(stripHtml(item.title || ''));
      const desc = shortSummary(title, item.contentSnippet || item.content || item.summary || item.description || '');
      const rawBody = sentenceCase(stripHtml(item.content || item.contentSnippet || item.summary || item.description || title));
      const bodySentences = rawBody.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
      const link = item.link || '';
      const id = Buffer.from(link || title).toString('base64').replace(/=/g,'');
      return {
        id,
        title,
        desc,
        body: bodySentences.join('\n\n') || desc,
        link,
        pubDate: item.pubDate || item.isoDate || new Date().toUTCString(),
        tag: feedDef.tag,
        color: feedDef.color
      };
    }).filter(x => x.title);
  } catch {
    return [];
  }
}

async function buildNews(tab) {
  const feeds = FEEDS[tab] || FEEDS.all;
  const results = await Promise.all(feeds.map(fetchFeed));
  const merged = results.flat();
  const seen = new Set();
  const unique = [];
  for (const item of merged) {
    const key = normalizeTitle(item.title).slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => timeValue(b.pubDate) - timeValue(a.pubDate));
  return unique.slice(0, 30);
}

async function extractLongArticle(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EetaramBot/1.0)' }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const text = sentenceCase(stripHtml(article?.textContent || ''));
    if (!text || text.length < 400) return [];
    return splitParagraphs(text).slice(0, 10);
  } catch {
    return [];
  }
}

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/api/news', async (req, res) => {
  const tab = String(req.query.tab || 'all');
  const key = `news:${tab}`;
  const entry = newsCache.get(key);

  if (entry && Date.now() - entry.ts < NEWS_TTL_MS) {
    return res.json({ articles: entry.articles, cached: true });
  }

  const articles = await buildNews(tab);
  newsCache.set(key, { ts: Date.now(), articles });
  res.json({ articles, cached: false });
});

app.get('/api/article', async (req, res) => {
  const id = String(req.query.id || '');
  const link = String(req.query.link || '');
  const fallbackBody = sentenceCase(String(req.query.body || ''));
  const fallbackTitle = sentenceCase(String(req.query.title || ''));
  const tag = String(req.query.tag || '');
  const color = String(req.query.color || '#CC0000');
  const pubDate = String(req.query.pubDate || new Date().toUTCString());

  if (!id) {
    return res.status(400).json({ error: 'Missing article id' });
  }

  const cached = articleCache.get(id);
  if (cached && (Date.now() - cached.ts < ARTICLE_TTL_MS)) {
    return res.json({ article: cached.article, cached: true });
  }

  let paragraphs = [];
  if (link) {
    paragraphs = await extractLongArticle(link);
  }

  if (!paragraphs.length) {
    paragraphs = splitParagraphs(fallbackBody).slice(0, 6);
  }

  const article = {
    title: fallbackTitle,
    tag,
    color,
    pubDate,
    paragraphs: paragraphs.length ? paragraphs : [fallbackBody || 'Full article is not available right now.']
  };

  articleCache.set(id, { ts: Date.now(), article });
  res.json({ article, cached: false });
});

app.use(express.static(publicPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
