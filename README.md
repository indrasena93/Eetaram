# Eetaram Production Fast Real News

This version is optimized for reliable hosting on Render.

## What changed
- Uses RSS feeds only
- No slow page scraping
- 5 minute server cache
- Original Eetaram UI
- Stable `/api/news` endpoint

## Local run
```bash
npm install
npm start
```

## Render settings
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`
- Root Directory: leave blank
