const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// simple API
app.get('/api/news', (req, res) => {
  res.json({
    articles: [
      {
        title: "Sample News Working",
        desc: "Your deployment is working correctly.",
        body: "This is a test article. Your Render deployment is fixed.",
        pubDate: new Date().toISOString(),
        tag: "Test",
        color: "#CC0000"
      }
    ]
  });
});

// health check
app.get('/health', (req, res) => res.send('ok'));

// FIXED fallback
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log("Server running on " + PORT);
});
