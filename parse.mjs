import fs from 'node:fs';

const raw = fs.readFileSync('aibunpou_utf8.txt', 'utf8');
const lines = raw.split(/\r?\n|\r/);

/* ---------- 章定義 ---------- */
const CHAPTERS = [
  { id:'tense',    name:'時制',         range:[1, 31] },
  { id:'passive',  name:'受動態',       range:[32, 39] },
  { id:'modal',    name:'助動詞',       range:[40, 79] },
  { id:'subj',     name:'仮定法',       range:[80, 113] },
  { id:'inf',      name:'不定詞',       range:[114, 154] },
  { id:'gerund',   name:'動名詞',       range:[155, 178] },
  { id:'part',     name:'分詞',         range:[179, 204] },
  { id:'relative', name:'関係詞',       range:[205, 259] },
  { id:'conj',     name:'接続詞',       range:[260, 321] },
  { id:'prep',     name:'前置詞',       range:[322, 373] },
  { id:'comp',     name:'比較',         range:[374, 430] },
  { id:'agree',    name:'主述の一致',   range:[431, 447] },
  { id:'q',        name:'疑問文',       range:[448, 474] },
  { id:'neg',      name:'否定',         range:[475, 493] },
  { id:'order',    name:'語順・省略・強調', range:[494, 519] },
  { id:'speech',   name:'話法',         range:[520, 525] },
  { id:'verbusage',name:'動詞の語法',   range:[526, 671] },
  { id:'nounusage',name:'名詞の語法',   range:[672, 704] },
  { id:'pronusage',name:'代名詞の語法', range:[705, 762] },
  { id:'adjusage', name:'形容詞の語法', range:[763, 812] },
  { id:'advusage', name:'副詞の語法',   range:[813, 847] },
  { id:'idiom',    name:'イディオム',   range:[848, 1323] },
  { id:'convo',    name:'会話表現',     range:[1324, 1422] },
  { id:'vocab',    name:'ボキャブラリー', range:[1423, 1541] },
  { id:'struct',   name:'文構造',       range:[1542, 1596] },
];
function chapterOf(g){ for(const c of CHAPTERS) if(g>=c.range[0]&&g<=c.range[1]) return c; return null; }

/* ---------- 解答キー & 正解英文の境界 ---------- */
let ansStartLine = lines.findIndex(l => /^\s*解\s*答/.test(l));
if(ansStartLine < 0) ansStartLine = lines.length;
console.log(`[boundary] answer section starts at line ${ansStartLine+1}`);

/* mc解答キー: "(N) ★ [→ M]" */
const ansKey  = new Map();         // gnum -> 0..3
const fullSent= new Map();         // gnum -> 正解英文 (mc/reorder/other全て)
const mcMark = ['①','②','③','④'];

for(let i=ansStartLine; i<lines.length; i++){
  const l = lines[i];
  let m = l.match(/^\((\d+)\)\s*([①②③④])\s*\[→\s*(\d+)\]/);
  if(m){
    ansKey.set(parseInt(m[3]), mcMark.indexOf(m[2]));
    continue;
  }
  m = l.match(/^\((\d+)\)\s+(.+?)\s*\[→\s*(\d+)\]\s*$/);
  if(m){
    const gnum = parseInt(m[3]);
    let s = m[2].trim();
    if(s.length > 2 && !mcMark.includes(s)){
      fullSent.set(gnum, s);
    }
  }
}
console.log(`[answers] mc-keys: ${ansKey.size}, full sentences: ${fullSent.size}`);

/* ---------- 問題本体パース ---------- */
const questions = [];
const seen = new Set();
const stats = { total:0, mc:0, reorder:0, other:0, dup:0, dropped:0 };

let currentSection = 'A';
const qOpenRe = /^\((\d+)\)\s*(.*?)$/;
const endRe   = /^(.*?)→\s*(\d+)\s*$/;
const sectionRe = /^\[([Ａ-ＺA-Za-zＡＡ]+)\]\s*(.+)$/;
const blankSlotRe = /^\(\d+\)\s*[＿_]+\s*$/;
const ansLineRe   = /\[→\s*\d+\]/;

const optsRe = /①\s*(.+?)\s*②\s*(.+?)\s*③\s*(.+?)\s*④\s*(.+?)\s*$/;
const reorderRe = /\(([^()]{2,200}?\/[^()]{2,200}?)\)/; // 1つ以上 / を含む括弧

let i = 0;
while(i < ansStartLine){
  const line = lines[i];

  // セクション識別
  const sm = line.match(sectionRe);
  if(sm){
    currentSection = sm[1];
    i++; continue;
  }
  // 空行・解答スロットはスキップ
  if(!line.trim() || blankSlotRe.test(line) || ansLineRe.test(line)){
    i++; continue;
  }

  const qm = line.match(qOpenRe);
  if(!qm){ i++; continue; }

  const innerN = parseInt(qm[1]);
  let bodyParts = [qm[2]];
  let gnum = null;
  let endIdx = i;

  // 1行目で既に → M がある？
  const em0 = qm[2].match(endRe);
  if(em0){
    bodyParts = [em0[1]];
    gnum = parseInt(em0[2]);
  } else {
    // 続く行をバッファ
    let j = i+1;
    while(j < ansStartLine){
      const lj = lines[j];
      if(qOpenRe.test(lj)) break;             // 次の問題開始
      if(sectionRe.test(lj)) break;           // 新セクション
      if(!lj.trim()){ j++; continue; }        // 空行スキップ
      const em = lj.match(endRe);
      if(em){
        bodyParts.push(em[1]);
        gnum = parseInt(em[2]);
        endIdx = j;
        break;
      } else {
        bodyParts.push(lj);
        endIdx = j;
      }
      j++;
    }
  }

  i = endIdx + 1;
  stats.total++;
  if(gnum === null){ stats.dropped++; continue; }
  if(seen.has(gnum)){ stats.dup++; continue; }

  let body = bodyParts.join(' ').replace(/\s+/g, ' ').trim();

  // 次の数行で options を探す（mc判定）
  let opts = null;
  for(let k=i; k<Math.min(i+3, ansStartLine); k++){
    const lk = lines[k];
    if(!lk.trim()) continue;
    if(qOpenRe.test(lk) || sectionRe.test(lk)) break;
    const om = lk.match(optsRe);
    if(om){
      opts = [om[1].trim(), om[2].trim(), om[3].trim(), om[4].trim()];
      break;
    }
  }

  // type判定
  let type = 'other';
  let words = null;
  if(opts){
    type = 'mc';
  } else {
    const rm = body.match(reorderRe);
    if(rm){
      type = 'reorder';
      words = rm[1].split('/').map(s=>s.trim()).filter(Boolean);
    }
  }

  // 解答
  let answer = null;
  if(type === 'mc'){
    if(ansKey.has(gnum)) answer = ansKey.get(gnum);
    else { stats.dropped++; continue; }
  }

  // 章
  const ch = chapterOf(gnum);
  if(!ch){ stats.dropped++; continue; }

  seen.add(gnum);
  const obj = {
    n: gnum,
    inner: innerN,
    type,
    section: currentSection,
    chapter: ch.id,
    chapterName: ch.name,
    q: body,
    full: fullSent.get(gnum) || null,
  };
  if(type === 'mc'){ obj.opts = opts; obj.a = answer; stats.mc++; }
  else if(type === 'reorder'){ obj.words = words; stats.reorder++; }
  else { stats.other++; }

  questions.push(obj);
}

questions.sort((a,b)=>a.n-b.n);

/* ---------- 統計 ---------- */
console.log('\n=== Parse stats ===');
console.log(`total seen: ${stats.total}, mc: ${stats.mc}, reorder: ${stats.reorder}, other: ${stats.other}, duplicates: ${stats.dup}, dropped: ${stats.dropped}`);
console.log(`Final questions: ${questions.length}`);

const byChap = {};
for(const q of questions){
  byChap[q.chapter] = byChap[q.chapter] || { mc:0, reorder:0, other:0, total:0 };
  byChap[q.chapter][q.type]++;
  byChap[q.chapter].total++;
}
console.log('\n--- By chapter ---');
console.log('chapter        name              total  mc  reord  other');
for(const c of CHAPTERS){
  const b = byChap[c.id] || { mc:0, reorder:0, other:0, total:0 };
  console.log(`${c.id.padEnd(12)} ${c.name.padEnd(14)} ${String(b.total).padStart(5)} ${String(b.mc).padStart(4)} ${String(b.reorder).padStart(5)} ${String(b.other).padStart(5)}`);
}

const payload = {
  meta: {
    generated: new Date().toISOString(),
    chapters: CHAPTERS,
    counts: { total: questions.length, ...stats },
  },
  chapters: CHAPTERS,
  questions,
};
fs.writeFileSync('public/questions.json', JSON.stringify(payload));
console.log(`\nWrote public/questions.json (${fs.statSync('public/questions.json').size} bytes)`);

// script-tag 用に同じ内容をJSモジュールとして出力（fetch不要で確実にロード）
fs.writeFileSync('public/questions.data.js',
  '/* auto-generated by parse.mjs — do not edit */\n' +
  'window.QUESTIONS_DATA = ' + JSON.stringify(payload) + ';\n'
);
console.log(`Wrote public/questions.data.js (${fs.statSync('public/questions.data.js').size} bytes)`);
