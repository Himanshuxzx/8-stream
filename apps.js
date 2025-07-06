const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');

const app = express();
const port = 3007;
app.use(express.json());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const supportedLanguages = ['Hindi', 'English', 'Bengali', 'Tamil', 'Telugu'];
const TMDB_API_KEY = '8baba8ab6b8bbe247645bcae7df63d0d';

const cache = {};
const CACHE_TTL = 1000 * 60 * 60;

function setCache(key, value) {
  cache[key] = {
    value,
    expires: Date.now() + CACHE_TTL
  };
}

function getCache(key) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    delete cache[key];
    return null;
  }
  return entry.value;
}

async function getImdbIdFromTmdb(tmdbId, type = 'movie') {
  try {
    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
    const { data } = await axios.get(url);
    return data.imdb_id || null;
  } catch (err) {
    console.error('TMDB fetch failed:', err.message);
    return null;
  }
}

async function fetchM3u8(embedUrl) {
  let m3u8Url = null;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
    ],
    defaultViewport: {
      width: 1280,
      height: 720,
    },
  });

  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    const url = req.url();
    if (url.endsWith('.m3u8')) {
      m3u8Url = url;
    }
    if (['image', 'stylesheet', 'font'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    for (let i = 0; i < 4 && !m3u8Url; i++) {
      await delay(1000);
    }
  } catch (err) {
    console.error('Navigation error:', err.message);
  }

  await browser.close();
  return m3u8Url;
}

app.get('/movie/:tmdbId', async (req, res) => {
  const tmdbId = req.params.tmdbId;
  const lang = supportedLanguages.includes(req.query.lang) ? req.query.lang : 'Hindi';

  try {
    const imdbId = await getImdbIdFromTmdb(tmdbId, 'movie');
    if (!imdbId) return res.status(404).json({ success: false, message: 'IMDb ID not found' });

    const cacheKey = `movie-${imdbId}-${lang}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ success: true, cached: true, ...cached });
    }

    const embedUrl = `https://embed.vidsrc.pk/movie/${imdbId}?lang=${lang}`;
    const m3u8Url = await fetchM3u8(embedUrl);

    if (m3u8Url) {
      const result = { type: 'movie', tmdbId, imdbId, lang, m3u8Url };
      setCache(cacheKey, result);
      res.json({ success: true, ...result });
    } else {
      res.status(404).json({ success: false, message: 'No m3u8 found', lang });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/series/:tmdbId/:season/:episode', async (req, res) => {
  const { tmdbId, season, episode } = req.params;
  const lang = supportedLanguages.includes(req.query.lang) ? req.query.lang : 'Hindi';

  try {
    const imdbId = await getImdbIdFromTmdb(tmdbId, 'tv');
    if (!imdbId) return res.status(404).json({ success: false, message: 'IMDb ID not found' });

    const cacheKey = `series-${imdbId}-s${season}e${episode}-${lang}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.json({ success: true, cached: true, ...cached });
    }

    const embedUrl = `https://embed.vidsrc.pk/tv/${imdbId}/${season}-${episode}?lang=${lang}`;
    const m3u8Url = await fetchM3u8(embedUrl);

    if (m3u8Url) {
      const result = { type: 'series', tmdbId, imdbId, season, episode, lang, m3u8Url };
      setCache(cacheKey, result);
      res.json({ success: true, ...result });
    } else {
      res.status(404).json({ success: false, message: 'No m3u8 found', lang });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
