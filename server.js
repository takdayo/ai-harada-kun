import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// AI 機能は終了（2026-11-03）。Poe には一切つながない。
app.get('/api/health', (req, res) => res.json({ ok: true, ai: false }));
app.post('/api/chat', (req, res) => res.status(410).json({ error: 'AI機能は終了しました。原田英語（haradaeigo.com）をご利用ください。' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI HARADA-KUN running on http://localhost:${PORT}`);
});
