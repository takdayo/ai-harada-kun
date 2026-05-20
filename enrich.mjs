/**
 * questions.json を充実化:
 *  - MC: 正解選択肢を空所に代入して full を構築
 *  - reorder: 末尾の「（語不要）」等を整形
 *  - other: 部分解答（①→resembles 等）を完全な英文に展開（AI）
 *  - other (null): 正解を AI が生成
 *
 * 使い方:
 *   node enrich.mjs              # MC部分のみ（API不要）
 *   POE_API_KEY=xxx node enrich.mjs --ai   # AIも含めて完全化
 *   POE_API_KEY=xxx node enrich.mjs --ai --limit 50  # 50問だけテスト
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const RUN_AI = args.includes('--ai');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i+1]) : Infinity; })();
const BOT = process.env.POE_BOT || 'Claude-Sonnet-4.5';
const KEY = process.env.POE_API_KEY;

const dataPath = 'public/questions.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

/* ---------- 1) MC: 空所に正解を代入 ---------- */
let mcDone = 0;
for(const q of data.questions){
  if(q.type !== 'mc' || q.full) continue;
  if(typeof q.a !== 'number' || !q.opts) continue;
  const ans = q.opts[q.a];
  // 全角空所 (　　) や半角 (  ) を正解で置換
  let full = q.q.replace(/\(\s*[　\s]+\s*\)/, ans);
  // 大文字化（先頭が小文字なら）
  if(/^[a-z]/.test(full)) full = full[0].toUpperCase() + full.slice(1);
  q.full = full;
  q.fullSource = 'mc-substitution';
  mcDone++;
}
console.log(`[1/3] MC substitution: ${mcDone} 問補完`);

/* ---------- 2) other (短い full = 部分解答) を残しつつ、UI用にラベル付け ---------- */
let otherMarked = 0;
for(const q of data.questions){
  if(q.type !== 'other' || !q.full) continue;
  if(q.full.length < 40){
    q.fullPartial = q.full;
    q.fullSource = 'original-partial';
    otherMarked++;
  } else {
    q.fullSource = 'original-full';
  }
}
console.log(`[2/3] other 部分解答マーキング: ${otherMarked} 問`);

/* ---------- 3) AI で残りを生成（option） ---------- */
const needAI = data.questions.filter(q =>
  q.type !== 'mc' &&
  (!q.full || (q.type === 'other' && q.full.length < 40))
);
console.log(`AI生成候補: ${needAI.length} 問`);

if(!RUN_AI){
  console.log('  → --ai フラグが無いのでスキップ。MC修正のみ保存します。');
} else if(!KEY){
  console.error('ERROR: POE_API_KEY が未設定。 set POE_API_KEY=xxx して再実行してください。');
  process.exit(1);
} else {
  const targets = needAI.slice(0, LIMIT);
  console.log(`  → ${targets.length} 問を生成します（model=${BOT}）`);

  const sys = `あなたは英文法問題集の正解英文を整形する厳格なアシスタントです。
以下の問題に対して、文法的に正しい完成英文を1文だけ、英語のみで出力してください。
余計な前置き・引用符・日本語・括弧書きは絶対に付けないでください。
複数文ある問題は、最も自然な完成英文を1〜2文で返してください。`;

  let ok = 0, fail = 0;
  const CONCURRENCY = 6;
  const queue = targets.slice();
  async function worker(){
    while(queue.length){
      const q = queue.shift();
      try{
        const userMsg = buildPrompt(q);
        const r = await fetch('https://api.poe.com/v1/chat/completions', {
          method:'POST',
          headers:{ 'Authorization':`Bearer ${KEY}`, 'Content-Type':'application/json' },
          body: JSON.stringify({
            model: BOT,
            messages: [
              { role:'system', content: sys },
              { role:'user', content: userMsg },
            ],
            stream: false,
            temperature: 0.2,
          }),
        });
        if(!r.ok){ throw new Error(`http ${r.status}: ${(await r.text()).slice(0,120)}`); }
        const j = await r.json();
        const text = (j.choices?.[0]?.message?.content || '').trim()
          .replace(/^["'`]+|["'`]+$/g, '').split('\n')[0].trim();
        if(text && text.length > 5){
          if(q.fullPartial){ /* keep original partial */ }
          q.full = text;
          q.fullSource = 'ai-generated';
          ok++;
        } else {
          fail++;
        }
      } catch(e){
        console.warn(`  [n=${q.n}] failed:`, String(e).slice(0,100));
        fail++;
      }
      if((ok+fail) % 20 === 0){
        console.log(`  progress: ${ok+fail}/${targets.length}  ok=${ok} fail=${fail}`);
      }
    }
  }
  await Promise.all(Array.from({length: CONCURRENCY}, () => worker()));
  console.log(`[3/3] AI生成完了: ok=${ok} fail=${fail}`);
}

/* ---------- 保存 ---------- */
fs.writeFileSync(dataPath, JSON.stringify(data));
fs.writeFileSync('public/questions.data.js',
  '/* auto-generated — do not edit */\nwindow.QUESTIONS_DATA = ' + JSON.stringify(data) + ';\n'
);
const filled = data.questions.filter(q=>q.full).length;
console.log(`\n保存完了: ${dataPath}  (full埋まり: ${filled}/${data.questions.length})`);

function buildPrompt(q){
  if(q.type === 'reorder'){
    return `次の並べかえ問題の正解英文を1文で出力してください。
【問題】${q.q}
【並べかえる語】${q.words?.join(' / ') || ''}
【部分解答】${q.fullPartial || '(なし)'}`;
  }
  // other (誤文訂正 / 書きかえ / 記述 / 穴埋め)
  return `次の英文法問題の正解英文を1文で出力してください。空欄を埋め、誤りを訂正し、書きかえ後の英文を返してください。
【問題】${q.q}
【部分解答/ヒント】${q.fullPartial || '(原本記載なし。文脈から最適な英文を作成)'}`;
}
