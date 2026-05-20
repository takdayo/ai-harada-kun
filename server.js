import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const SYSTEM_PROMPT = `あなたは「AIはらだくん」という、カッコよくてかわいいAIロボット家庭教師です。
英文法ぜんぶを、楽しく分かりやすく日本語で教えます。
内蔵の「超絶英文法問題」1,583問（全25章：時制・受動態・助動詞・仮定法・不定詞・動名詞・分詞・関係詞・接続詞・前置詞・比較・主述の一致・疑問文・否定・語順・話法・動詞/名詞/代名詞/形容詞/副詞の語法・イディオム・会話表現・ボキャブラリー・文構造）からクイズも出題できます。

【返答ルール】
- 日本語で答える（英語の例文はそのまま英語で）
- 明るく親しみやすい口調、絵文字は控えめに（1〜2個まで）
- 例文を必ず添える（英文と日本語訳をセットで）
- 重要語は <b>太字</b>、強調は <span class="hl">ハイライト</span>、コードや英文記号は <code>...</code> でマークアップ
- 改行は <br> を使う（フロントエンドはHTMLレンダリング）
- 回答は5〜12行程度に簡潔に
- 質問が曖昧なら、優しく聞き返してOK
- ユーザーが「問題を出して」と言ったら、フロント側で自動的に🎯クイズタブが開きクイズが始まります。番号指定（「53問を出して」）や章名指定（「関係詞のクイズ」）にも対応していることを案内してください。

【得意分野】
中学〜高校英文法全般（時制・態・助動詞・仮定法・準動詞・関係詞・接続詞・比較・語法・イディオム・会話表現 など）。`;

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasKey: !!process.env.POE_API_KEY,
    bot: process.env.POE_BOT || 'Claude-Sonnet-4.5',
  });
});

app.post('/api/chat', async (req, res) => {
  if (!process.env.POE_API_KEY) {
    return res.status(503).json({ error: 'POE_API_KEY is not configured on the server.' });
  }
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (messages.length === 0) {
    return res.status(400).json({ error: 'messages is required' });
  }
  const bot = process.env.POE_BOT || 'Claude-Sonnet-4.5';

  let upstream;
  try {
    upstream = await fetch('https://api.poe.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.POE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: bot,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        stream: true,
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to reach Poe API: ' + String(err) });
  }

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => '');
    return res.status(upstream.status || 500).json({ error: txt || 'Upstream error' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const raw of parts) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content ?? '';
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        } catch {
          // ignore non-JSON keepalive lines
        }
      }
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI HARADA-KUN running on http://localhost:${PORT}`);
  console.log(`  Poe bot: ${process.env.POE_BOT || 'Claude-Sonnet-4.5'}`);
  console.log(`  API key: ${process.env.POE_API_KEY ? 'OK' : 'MISSING — set POE_API_KEY to enable chat'}`);
});
