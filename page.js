'use client';
// CodeLab | كود لاب — Next.js 14 (App Router) single-file app. Put this file at app/page.js
import { useState, useEffect, useRef, useCallback } from 'react';

/* ===== Config ===== */
const GEMINI_MODEL = 'gemini-2.0-flash';
const LANGS = { html: 'HTML', css: 'CSS', js: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java' };
const STARTERS = {
  html: '<h1>مرحباً بك في CodeLab</h1>\n<button id="b">اضغط هنا</button>',
  css: 'body { background: #1e1b4b; color: #fde68a; font-family: sans-serif; }\nh1 { text-align: center; }',
  js: "document.getElementById('b').onclick = () => alert('أهلاً!');",
  python: 'name = "CodeLab"\nprint("Hello " + name)',
  cpp: '#include <iostream>\nint main() {\n  std::cout << "Hello";\n  return 0;\n}',
  java: 'public class Main {\n  public static void main(String[] a) {\n    System.out.println("Hello");\n  }\n}',
};
const KW = /\b(function|const|let|var|return|if|else|for|while|class|import|def|print|int|void|public|static|new|include|true|false|null|None|and|or|not|in|try|catch)\b/g;
/* ===== Own backend client (talks to app/api/db/route.js) ===== */
const tok = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
async function api(action, body = {}, role = 'cl_tok') {
  try {
    const r = await fetch('/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok(role) || ''}` }, body: JSON.stringify({ action, ...body }) });
    return await r.json();
  } catch { return null; }
}
const askAI = (prompt, history = []) => api('ai', { prompt, history });
let llm = null; // optional on-device model (WebLLM), loaded only on demand

/* ===== Code runners: JS (worker), Python (Pyodide), C++/Java (translated to JS for simple programs) ===== */
const PRE = 'let buf="";const __w=(...a)=>{buf+=a.join("")};const __l=(...a)=>{buf+=a.join("")+"\\n"};const console={log:(...a)=>{buf+=a.join(" ")+"\\n"}};';
const runMain = (src) => { try { return { out: new Function(PRE + src + '\nreturn buf;')() }; } catch (e) { return { err: e.message }; } };
const runWorker = (src, ms = 3000) => new Promise((res) => {
  let w;
  try { w = new Worker(URL.createObjectURL(new Blob([`onmessage=()=>{try{postMessage({out:(new Function(${JSON.stringify(PRE + src + '\nreturn buf;')}))()})}catch(e){postMessage({err:e.message})}}`]))); } catch { return res(runMain(src)); }
  const t = setTimeout(() => { w.terminate(); res({ err: 'الكود يعمل بلا توقف (حلقة لا نهائية؟)' }); }, ms);
  w.onmessage = (e) => { clearTimeout(t); w.terminate(); res(e.data); };
  w.onerror = () => { clearTimeout(t); w.terminate(); res(runMain(src)); };
  w.postMessage(1);
});
let pyo = null;
async function runPy(code) {
  try {
    pyo ||= await (await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs')).loadPyodide();
    let o = ''; pyo.setStdout({ batched: (x) => (o += x + '\n') }); pyo.setStderr({ batched: () => {} });
    await pyo.runPythonAsync(code); return { out: o };
  } catch (e) {
    if (!pyo) return { noRun: true, err: 'تعذر تحميل مشغّل Python (يحتاج إنترنت في أول مرة). تم فحص القواعد فقط.' };
    return { err: String(e.message).split('\n').filter(Boolean).slice(-1)[0] };
  }
}
function toJS(code, lang) {
  let s = code.replace(/\/\/.*$/gm, '').replace(/#include.*|using namespace.*|^\s*import .*;|^\s*package .*;/gm, '').replace(/std::/g, '');
  if (lang === 'java') s = s.replace(/(public\s+)?class\s+\w+\s*\{/, '').replace(/\}\s*$/, '').replace(/(public\s+)?static\s+void\s+main\s*\([^)]*\)/, 'function main()');
  else s = s.replace(/int\s+main\s*\(\s*\)/, 'function main()');
  const T = 'int|long|double|float|bool|boolean|String|string';
  s = s.replace(new RegExp(`\\b(?:static\\s+)?(?:${T}|void)\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, 'g'), (m, n, p) => `function ${n}(${p.replace(new RegExp(`\\b(?:${T})\\s+`, 'g'), '')}) {`);
  s = s.replace(new RegExp(`\\b(?:${T}|auto)\\s+(\\w+)\\s*(=|;)`, 'g'), 'let $1 $2');
  s = s.replace(/cout\s*((?:<<[^;]+)+);/g, (m, ch) => `__w(${ch.split('<<').slice(1).map((x) => (x.trim() === 'endl' ? '"\\n"' : x.trim())).join(', ')});`);
  s = s.replace(/System\.out\.println\(/g, '__l(').replace(/System\.out\.print\(/g, '__w(');
  s = s.replace(/(\b\w+\b)\s*\/\s*(\b\w+\b)/g, 'Math.trunc($1 / $2)');
  return /function main\(/.test(s) ? s + '\nmain();' : s;
}
async function runCode(lang, code) {
  if (lang === 'python') return runPy(code);
  const r = await runWorker(lang === 'js' ? code : toJS(code, lang));
  return r;
}
// Any YouTube link (watch, youtu.be, shorts, playlist) or Drive link -> embeddable URL
function embedUrl(u) {
  const y = u.match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([\w-]{11})/), l = u.match(/[?&]list=([\w-]+)/);
  if (/youtu/.test(u)) return y ? `https://www.youtube.com/embed/${y[1]}${l ? '?list=' + l[1] : ''}` : l ? `https://www.youtube.com/embed/videoseries?list=${l[1]}` : u;
  const d = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  return d ? `https://drive.google.com/file/d/${d[1]}/preview` : u;
}
// Resize + compress a photo picked from the device (max 400px JPEG) so it can be stored with the platform data
const pickPhoto = (file) => new Promise((res) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 400 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.82)); }; img.src = URL.createObjectURL(file); });
const TT = ['المتغيرات والجمع', 'الضرب والطرح', 'أولوية العمليات', 'الحلقات for', 'الشرط داخل الحلقة', 'الدوال', 'القسمة والباقي', 'الحلقات المتداخلة', 'الدوال التكرارية: المضروب', 'الدوال التكرارية: فيبوناتشي'];
const LES = [
  'المتغير صندوق يحفظ قيمة باسم. نعرّف متغيرين ثم نجمعهما بعلامة + ونطبع الناتج.',
  'نستخدم * للضرب و - للطرح. الضرب يُحسب قبل الطرح تلقائياً.',
  'للعمليات أولوية: الأقواس أولاً ثم الضرب والقسمة ثم الجمع والطرح. الأقواس تغيّر الترتيب.',
  'الحلقة for تكرر أمراً عدة مرات. هنا نمرّ على الأعداد من 1 إلى K ونجمعها في متغير.',
  'نضع شرطاً if داخل الحلقة لننفّذ الجمع فقط عندما يتحقق الشرط. % يعطي باقي القسمة.',
  'الدالة مجموعة أوامر لها اسم. نستدعيها بالاسم وتعطينا قيمة ترجعها عبر return.',
  'القسمة الصحيحة تعطي الجزء الصحيح من الناتج، و % يعطي الباقي. لكل لغة طريقتها.',
  'نضع حلقة داخل حلقة. الحلقة الداخلية تُنفَّذ كاملة لكل دورة من الخارجية.',
  'الدالة التكرارية تنادي نفسها بقيمة أصغر حتى تصل لحالة التوقف. المضروب: n! = n × (n-1)!',
  'متتالية فيبوناتشي: كل رقم هو مجموع الرقمين قبله. الدالة تنادي نفسها مرتين.',
];
const FAQ = [
  [/مستوى|مستويات|ليفل|level/i, 'في كل لغة 100 مستوى: شرح، ثم تمرين تكتبه في المحرر، ثم اختبار سريع. المستوى التالي يُفتح بعد نجاحك.'],
  [/تشغيل|شغل|المحرر|نتيج|run/i, 'اكتب كودك في المحرر واضغط ▶ تشغيل. إن كان صحيحاً تظهر النتيجة، وإن كان فيه خطأ يظهر سببه وطريقة إصلاحه.'],
  [/خطأ|غلط|error/i, 'اضغط تشغيل وستشرح لك المنصة مكان الخطأ وسببه وحله. أكثر الأخطاء: نقص ; أو قوس غير مغلق أو اسم متغير خاطئ.'],
  [/مفكرة|ملاحظ|نوت/i, 'افتح أي مصدر من المصادر الحرة واضغط 📝 المفكرة لتدوين ملاحظاتك، وتُحفظ تلقائياً في حسابك.'],
  [/تنزيل|offline|انترنت|إنترنت/i, 'زر ⬇ تنزيل محمي يحفظ الفيديو مشفراً للمشاهدة بدون إنترنت، ويعمل مع روابط mp4 المباشرة.'],
  [/حساب|تسجيل|دخول|كلمة/i, 'سجّل من نافذة الدخول بالبريد وكلمة السر. المحرر مجاني للجميع، والمستويات للمسجلين.'],
  [/متغير|variable/i, 'المتغير صندوق يحفظ قيمة باسم، مثل a = 5 في Python أو let a = 5; في JavaScript.'],
  [/حلقة|loop|for|while/i, 'الحلقة تكرر أمراً عدة مرات، مثل for i in range(5) في Python أو for (let i = 0; i < 5; i++) في JavaScript.'],
  [/دالة|function|def/i, 'الدالة مجموعة أوامر لها اسم تستدعيها وقت الحاجة، وقد تأخذ مدخلات وترجع قيمة.'],
  [/شرط|if/i, 'الشرط if ينفّذ أمراً فقط إذا تحقق شرط معين، ويمكن إضافة else لحالة عدم التحقق.'],
  [/html|وسم/i, 'HTML يبني هيكل الصفحة بوسوم مثل h1 و p و a.'],
  [/css|تنسيق/i, 'CSS ينسّق شكل الصفحة: الألوان والأحجام والمسافات والتخطيط.'],
];
const localAnswer = (q) => (FAQ.find(([re]) => re.test(q)) || [0, 'أنا المساعد الداخلي. أجيب عن استخدام المنصة (المستويات، المحرر، المفكرة، التنزيل المحمي) وأساسيات البرمجة (متغيرات، حلقات، شروط، دوال). اسألني عن أحدها.'])[1];

/* ===== Level generator: 100 progressive levels per language, answers computed by code ===== */
const MK = {
html: `a|ينشئ رابطاً|<a href="#">رابط</a>
h1|هو أكبر عنوان|<h1>عنوان</h1>
p|يكتب فقرة نصية|<p>نص</p>
img|يعرض صورة|<img src="a.png" alt="x">
br|ينزل لسطر جديد|<br>
ul|ينشئ قائمة نقطية|<ul><li>1</li></ul>
ol|ينشئ قائمة مرقمة|<ol><li>1</li></ol>
div|يجمع عناصر في حاوية|<div class="box">..</div>
span|يلف جزءاً من النص|<span>نص</span>
button|ينشئ زراً|<button>اضغط</button>
input|ينشئ حقل إدخال|<input type="text">
form|ينشئ نموذجاً لإرسال البيانات|<form action="/go"></form>
table|ينشئ جدولاً|<table><tr><td>1</td></tr></table>
strong|يجعل النص عريضاً ومهماً|<strong>مهم</strong>
em|يجعل النص مائلاً|<em>نص</em>
hr|يرسم خطاً أفقياً|<hr>
label|يربط نصاً بحقل إدخال|<label for="n">الاسم</label>
textarea|ينشئ مربع نص كبير|<textarea rows="3"></textarea>
select|ينشئ قائمة منسدلة|<select><option>1</option></select>
video|يعرض فيديو|<video src="v.mp4" controls></video>
audio|يشغل صوتاً|<audio src="a.mp3" controls></audio>
header|يمثل رأس الصفحة|<header>..</header>
nav|يحتوي روابط التنقل|<nav><a href="#">1</a></nav>
main|يحتوي المحتوى الرئيسي|<main>..</main>
section|يقسم الصفحة إلى أقسام|<section>..</section>
article|يمثل مقالاً مستقلاً|<article>..</article>
footer|يمثل ذيل الصفحة|<footer>..</footer>
canvas|يرسم رسوماً بالجافاسكريبت|<canvas id="c"></canvas>
iframe|يضمّن صفحة داخل صفحة|<iframe src="p.html"></iframe>
script|يضيف كود جافاسكريبت|<script src="a.js"></script>
link|يربط ملف CSS|<link rel="stylesheet" href="s.css">
meta|يحدد بيانات الصفحة مثل الترميز|<meta charset="utf-8">
title|يحدد عنوان التبويب|<title>موقعي</title>
details|ينشئ محتوى قابلاً للطي|<details><summary>أكثر</summary></details>`,
css: `color|يغير لون النص|color: red;
background|يغير خلفية العنصر|background: #222;
font-size|يحدد حجم الخط|font-size: 18px;
margin|يضبط المسافة الخارجية|margin: 10px;
padding|يضبط المسافة الداخلية|padding: 10px;
border|يضيف إطاراً|border: 1px solid red;
border-radius|يدوّر الحواف|border-radius: 12px;
width|يحدد العرض|width: 200px;
height|يحدد الارتفاع|height: 100px;
display|يغير طريقة عرض العنصر|display: flex;
justify-content|يوزع عناصر flex أفقياً|justify-content: center;
align-items|يحاذي عناصر flex عمودياً|align-items: center;
flex-direction|يغير اتجاه flex|flex-direction: column;
gap|يضع مسافة بين عناصر flex أو grid|gap: 8px;
grid-template-columns|يحدد أعمدة الشبكة|grid-template-columns: 1fr 1fr;
position|يحدد نوع التموضع|position: absolute;
top|يزيح العنصر من الأعلى|top: 10px;
z-index|يرتب العناصر فوق بعضها|z-index: 5;
opacity|يتحكم في الشفافية|opacity: 0.5;
box-shadow|يضيف ظلاً للعنصر|box-shadow: 0 4px 8px #000;
text-align|يحاذي النص|text-align: center;
font-weight|يجعل الخط عريضاً|font-weight: bold;
line-height|يحدد تباعد الأسطر|line-height: 1.6;
overflow|يتحكم في المحتوى الزائد|overflow: hidden;
cursor|يغير شكل المؤشر|cursor: pointer;
transition|يجعل التغيير سلساً|transition: all 0.3s;
transform|يدوّر أو يكبّر العنصر|transform: rotate(45deg);
animation|يشغل حركة معرّفة بـ keyframes|animation: spin 2s infinite;
@media|يطبق أنماطاً حسب حجم الشاشة|@media (max-width: 600px) { }
:hover|يطبق نمطاً عند مرور المؤشر|a:hover { color: red; }
::before|يضيف محتوى قبل العنصر|p::before { content: "★"; }
var(--x)|يستخدم متغير CSS|color: var(--main);
backdrop-filter|يضبب ما خلف العنصر|backdrop-filter: blur(8px);
object-fit|يحدد كيفية ملء الصورة لإطارها|object-fit: cover;`,
};
const rnd = (n, k) => { const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const pk = (n, k, lo, hi) => lo + Math.floor(rnd(n, k) * (hi - lo + 1));
function genLevel(lang, n) {
  let q, ans, opts, spec;
  if (lang === 'html' || lang === 'css') {
    const E = MK[lang].split('\n').map((l) => l.split('|')), i = Math.min(33, Math.floor((n - 1) / 3)), f = (n - 1) % 3, e = E[i];
    const o1 = E[(i + 11) % 34], o2 = E[(i + 23) % 34], w = lang === 'html' ? 'وسم' : 'خاصية أو أمر';
    if (f === 0) { q = `أي ${w} ${e[1]}؟`; opts = [e[0], o1[0], o2[0]]; }
    else if (f === 1) { q = `ماذا يفعل ${e[0]}؟`; opts = [e[1], o1[1], o2[1]]; }
    else { q = `أي كود صحيح ${e[1]}؟`; opts = [e[2], e[2].slice(0, -1), e[2].replace(/[:"=]/, '')]; if (opts[2] === e[2]) opts[2] = e[2] + '}'; }
    ans = opts[0];
    const keys = [e[0], i > 0 && E[i - 1][0], i > 1 && E[i - 2][0]].slice(0, f + 1).filter(Boolean);
    spec = { title: e[0], lesson: `${e[0]} — ${e[1]}.\n\nمثال:\n${e[2]}`, task: lang === 'html' ? `اكتب كود HTML يستخدم الوسوم: ${keys.map((k) => `<${k}>`).join(' و ')}` : `اكتب كود CSS يستخدم: ${keys.join(' و ')}`, starter: lang === 'html' ? '<!-- اكتب هنا -->' : '/* اكتب هنا */', need: keys, solution: [e[2], i > 0 && E[i - 1][2], i > 1 && E[i - 2][2]].slice(0, f + 1).filter(Boolean).join('\n') };
  } else {
    const J = lang === 'js', P = lang === 'python';
    const D = (a, v) => (P ? `${a} = ${v}` : J ? `let ${a} = ${v};` : `int ${a} = ${v};`);
    const PR = (x) => ({ js: `console.log(${x});`, python: `print(${x})`, cpp: `cout << ${x};`, java: `System.out.println(${x});` })[lang];
    const FN = (body) => (P ? `def f(x): return ${body}` : J ? `function f(x) { return ${body}; }` : `${lang === 'java' ? 'static ' : ''}int f(int x) { return ${body}; }`);
    const TN = (c, y, no) => (P ? `${y} if ${c} else ${no}` : `${c} ? ${y} : ${no}`);
    const FOR = (v, from, to, body) => (P ? `for ${v} in range(${from}, ${to}):\n    ${body}` : `for (${J ? 'let' : 'int'} ${v} = ${from}; ${v} < ${to}; ${v}++) ${body};`);
    const CM = P ? '# اكتب هنا' : '// اكتب هنا';
    const wrap = (fn, body) => (J || P ? [...fn, ...body].join('\n') : lang === 'cpp' ? `#include <iostream>\nusing namespace std;\n${fn.join('\n')}\nint main() {\n${body.map((x) => '  ' + x).join('\n')}\n  return 0;\n}` : `public class Main {\n${fn.map((x) => '  ' + x).join('\n')}\n  public static void main(String[] args) {\n${body.map((x) => '    ' + x).join('\n')}\n  }\n}`);
    const build = (bd, { a, b, c, K, M, m, z }) => {
      let L, v, T, fn = [], body = [CM];
      if (bd === 0) { L = [D('a', a), D('b', b), PR('a + b')]; v = a + b; T = `عرّف a = ${a} و b = ${b} ثم اطبع ناتج جمعهما.`; }
      else if (bd === 1) { L = [D('a', a), D('b', b), D('c', c), PR('a * b - c')]; v = a * b - c; T = `عرّف a = ${a} و b = ${b} و c = ${c} ثم اطبع ناتج a * b - c.`; }
      else if (bd === 2) { L = [D('a', a), D('b', b), D('c', c), PR('(a + b) * c - a')]; v = (a + b) * c - a; T = `عرّف a = ${a} و b = ${b} و c = ${c} ثم اطبع ناتج (a + b) * c - a.`; }
      else if (bd === 3) { L = [D('s', 0), FOR('i', 1, K + 1, 's += i'), PR('s')]; v = (K * (K + 1)) / 2; T = `اكتب حلقة تجمع الأعداد من 1 إلى ${K} داخل المتغير s ثم اطبع s.`; body = [D('s', 0), CM]; }
      else if (bd === 4) { L = [D('s', 0), FOR('i', 1, K + 1, P ? `if i % ${m} == 0: s += i` : `if (i % ${m} == 0) s += i`), PR('s')]; v = 0; for (let i = 1; i <= K; i++) if (i % m === 0) v += i; T = `اكتب حلقة من 1 إلى ${K} تجمع في s الأعداد التي تقبل القسمة على ${m} فقط، ثم اطبع s.`; body = [D('s', 0), CM]; }
      else if (bd === 5) { L = [FN(`x * ${a} + ${b}`), PR(`f(${c})`)]; v = c * a + b; T = `الدالة f جاهزة وتحسب x * ${a} + ${b}. استدعِ f(${c}) واطبع النتيجة.`; fn = [L[0]]; }
      else if (bd === 6) { L = [D('a', a), D('b', b), PR(P ? 'a // b + a % b' : J ? 'Math.floor(a / b) + a % b' : 'a / b + a % b')]; v = Math.floor(a / b) + (a % b); T = `عرّف a = ${a} و b = ${b} ثم اطبع (ناتج القسمة الصحيحة a على b) + (باقي القسمة).`; }
      else if (bd === 7) { L = [D('c', 0), FOR('i', 0, K, P ? `for j in range(0, ${M}):\n        if (i + j) % 2 == 0: c += 1` : `for (${J ? 'let' : 'int'} j = 0; j < ${M}; j++) if ((i + j) % 2 == 0) c++`), PR('c')]; v = 0; for (let i = 0; i < K; i++) for (let j = 0; j < M; j++) if ((i + j) % 2 === 0) v++; T = `اكتب حلقتين متداخلتين: i من 0 إلى ${K - 1} و j من 0 إلى ${M - 1}، وزِد العداد c كلما كان i + j زوجياً، ثم اطبع c.`; body = [D('c', 0), CM]; }
      else if (bd === 8) { L = [FN(TN('x <= 1', '1', 'x * f(x - 1)')), PR(`f(${K}) + ${z}`)]; let fa = 1; for (let i = 2; i <= K; i++) fa *= i; v = fa + z; T = `الدالة f تحسب المضروب (factorial). اطبع f(${K}) + ${z}.`; fn = [L[0]]; }
      else { L = [FN(TN('x < 2', 'x', 'f(x - 1) + f(x - 2)')), PR(`f(${K})`)]; let x = 0, y = 1; for (let i = 0; i < K; i++) [x, y] = [y, x + y]; v = x; T = `الدالة f تحسب متتالية فيبوناتشي. اطبع f(${K}).`; fn = [L[0]]; }
      return { L, v, T, fn, body };
    };
    const bd = Math.floor((n - 1) / 10), t = (n - 1) % 10;
    const p = { a: bd === 6 ? 20 + t * 6 + pk(n, 1, 0, 5) : 2 + t * 3 + pk(n, 1, 0, 2), b: bd === 6 ? pk(n, 2, 3, 9) : pk(n, 2, 2, 5 + t), c: pk(n, 3, 2, 4 + t), K: bd === 3 ? 3 + t * 2 + pk(n, 4, 0, 1) : bd === 4 ? 6 + t * 2 + pk(n, 4, 0, 1) : bd === 7 ? 3 + t : bd === 8 ? pk(n, 4, 3, 7) : 6 + t, M: pk(n, 5, 3, 7), m: pk(n, 6, 2, 3), z: 1 + t };
    const r = build(bd, p), ex = build(bd, { a: 3, b: 2, c: 4, K: 4, M: 3, m: 2, z: 1 });
    ans = r.v; q = `ما ناتج هذا الكود؟\n${r.L.join('\n')}`; opts = [ans, ans + 1 + (n % 3), ans - 2 - (n % 2)];
    spec = { title: TT[bd], lesson: `${LES[bd]}\n\nالطباعة في ${LANGS[lang]}: ${PR('x')}\n\nمثال:\n${ex.L.join('\n')}\n← الناتج: ${ex.v}`, task: r.T, starter: wrap(r.fn, r.body), solution: wrap(r.fn, r.L.filter((x) => !r.fn.includes(x))), expect: String(r.v) };
  }
  const k = Math.floor(rnd(n, 9) * 3), r = opts.map((_, j) => String(opts[(j + k) % 3]));
  return [q, r, r.indexOf(String(ans)), spec];
}
const DEF = {
  pin: '100100',
  dev: { name: 'اسم المطور', bio: 'مطور برمجيات شغوف بتعليم البرمجة بطريقة ممتعة ومبسطة للجميع.', photo: '', tech: ['React', 'Next.js', 'Python', 'C++', 'Java', 'Tailwind', 'Node.js', 'Git'] },
  links: [{ n: 'واتساب', u: 'https://wa.me/' }, { n: 'يوتيوب', u: 'https://youtube.com' }, { n: 'تيك توك', u: 'https://tiktok.com' }, { n: 'جيت هاب', u: 'https://github.com' }],
  resources: Object.keys(LANGS).flatMap((k) => [{ id: k + '_v', lang: k, t: `فيديو شرح ${LANGS[k]}`, type: 'video', u: '' }, { id: k + '_p', lang: k, t: `مذكرة ${LANGS[k]}`, type: 'pdf', u: '' }]),
  custom: {},
};

/* ===== Helpers ===== */
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
function usePersist(key, init) {
  const [v, setV] = useState(init);
  const ready = useRef(false);
  useEffect(() => { try { const s = localStorage.getItem(key); if (s) setV(JSON.parse(s)); } catch {} ready.current = true; }, [key]);
  useEffect(() => { if (ready.current) try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV];
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function highlight(code, lang) {
  let t = esc(code);
  if (lang === 'html') return t.replace(/(&lt;\/?[\w-]+)|(\s[\w-]+=)|("[^"]*")|(&gt;)/g, (m, a, b, c, d) => a || d ? `<i class="t1">${m}</i>` : b ? `<i class="t2">${m}</i>` : `<i class="t3">${m}</i>`);
  if (lang === 'css') return t.replace(/([\w-]+)(\s*:)|([.#][\w-]+)|(\d+[a-z%]*)/g, (m, p, c, s, n) => p ? `<i class="t2">${p}</i>${c}` : s ? `<i class="t1">${m}</i>` : `<i class="t4">${m}</i>`);
  const cm = lang === 'python' ? '#.*' : '\\/\\/.*';
  return t.replace(new RegExp(`(${cm})|("(?:[^"\\\\]|\\\\.)*"|'[^']*')|(\\b\\d+\\b)`, 'g'), (m, c, s, n) => c ? `<i class="t5">${m}</i>` : s ? `<i class="t3">${m}</i>` : `<i class="t4">${m}</i>`).replace(/(<i class="t\d">.*?<\/i>)|\b(function|const|let|var|return|if|else|for|while|class|import|def|print|int|void|public|static|new|include|true|false|null|None|and|or|not|in|try|catch)\b/g, (m, k, w) => k ? k : `<i class="t1">${w}</i>`);
}
/* ===== On-device diagnostics (no network): finds errors and explains them in Arabic ===== */
function diagnose(code, lang) {
  const d = [], add = (line, why, fix) => d.push({ line, why, fix });
  const lines = code.split('\n');
  if (lang === 'html') {
    const V = 'area base br col embed hr img input link meta source track wbr'.split(' '), st = [], re = /<(\/?)([a-zA-Z][\w-]*)[^>]*?>/g, ln = (i) => code.slice(0, i).split('\n').length;
    let m;
    while ((m = re.exec(code))) {
      const t = m[2].toLowerCase(); if (V.includes(t) || m[0].endsWith('/>')) continue;
      if (!m[1]) st.push([t, ln(m.index)]);
      else { const p = st.pop(); if (!p || p[0] !== t) { add(ln(m.index), `الوسم </${t}> لا يطابق ${p ? '<' + p[0] + '>' : 'أي وسم مفتوح'}`, 'أغلق الوسوم بنفس ترتيب فتحها'); if (p) st.push(p); } }
    }
    st.forEach(([t, l]) => add(l, `الوسم <${t}> لم يُغلق`, `أضف </${t}> في المكان المناسب`));
    return d;
  }
  const st = [], pr = { ')': '(', ']': '[', '}': '{' }, nz = lines.map((l, i) => [l, i]).filter(([l]) => l.trim());
  lines.forEach((ln, i) => {
    let s = ln.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, 'S');
    if (lang === 'python') s = s.replace(/#.*/, ''); else if (lang !== 'css') s = s.replace(/\/\/.*/, '');
    if (/["'`]/.test(s)) add(i + 1, 'نص (string) لم تُغلق علامة التنصيص الخاصة به', 'أغلق النص بنفس علامة التنصيص التي بدأ بها');
    for (const ch of s) { if ('([{'.includes(ch)) st.push([ch, i + 1]); else if (pr[ch]) { const p = st.pop(); if (!p || p[0] !== pr[ch]) add(i + 1, `القوس '${ch}' لا يطابق قوس فتح`, 'راجع أزواج الأقواس ( ) [ ] { }'); } }
    const tr = s.trim(), nx = (nz.find(([, j]) => j > i) || [''])[0].trim(), pv = [...nz].reverse().find(([, j]) => j < i);
    if (lang === 'python') {
      if (/^(def|if|elif|else|for|while|class|try|except|with)\b/.test(tr) && !tr.endsWith(':')) add(i + 1, 'ينقص النقطتان : في نهاية السطر', `اكتب ${tr}:`);
      if (/^print\s+[\w"']/.test(tr)) add(i + 1, 'دالة print تحتاج أقواساً', 'اكتب print( ... )');
      if (/^(if|while|elif)\b[^=]*[^=!<>]=[^=]/.test(tr)) add(i + 1, 'استخدمت = (إسناد) بدل == (مقارنة)', 'استبدل = بـ ==');
      if (pv && tr && pv[0].trim().endsWith(':') && ln.match(/^\s*/)[0].length <= pv[0].match(/^\s*/)[0].length) add(i + 1, 'السطر بعد النقطتين يجب أن يكون مُزاحاً للداخل', 'أضف مسافتين أو أربع في بداية السطر');
    } else if (lang === 'css') {
      if (/^[\w-]+\s*:\s*[^;{}]+$/.test(tr)) add(i + 1, 'ينقص ; في نهاية الخاصية', 'أضف ; في نهاية السطر');
      if (/^[\w-]+\s+[^:{};]+;$/.test(tr)) add(i + 1, 'ينقص النقطتان : بين اسم الخاصية وقيمتها', 'اكتب الخاصية: القيمة;');
    } else {
      if (/^(if|while)\s*\([^=!<>]*[^=!<>]=[^=][^)]*\)/.test(tr)) add(i + 1, 'استخدمت = (إسناد) داخل الشرط بدل == (مقارنة)', 'استبدل = بـ ==');
      if (lang !== 'js' && tr && !/[;{}(,:+\-*/&|=?]$/.test(tr) && !/^(#|\/\*|\*|if\b|for\b|while\b|else\b|\)|public|private|protected|class|using|import|package)/.test(tr) && !nx.startsWith('{')) add(i + 1, 'ينقص ; في نهاية السطر', 'أضف ; في نهاية الجملة');
      if (lang === 'java' && /\bstring\s+\w+/.test(tr)) add(i + 1, 'اسم النوع string يجب أن يكون String بحرف كبير', 'اكتب String');
      if (lang === 'java' && /\bsystem\.out/.test(tr)) add(i + 1, 'اسم System يجب أن يبدأ بحرف كبير', 'اكتب System.out.println');
    }
  });
  st.forEach(([c, l]) => add(l, `القوس '${c}' مفتوح ولم يُغلق`, 'أضف قوس الإغلاق المناسب'));
  if (lang === 'cpp' && /\bcout\b/.test(code) && !/#include\s*<iostream>/.test(code)) add(1, 'تستخدم cout بدون تضمين المكتبة', 'أضف #include <iostream> في أول الملف');
  if (lang === 'java' && !/class\s+\w+/.test(code)) add(1, 'لا يوجد class', 'كل كود جافا يجب أن يكون داخل class');
  if (lang === 'js' && !d.length) { try { new Function(code); } catch (e) { const m = e.message; add(0, /end of input/.test(m) ? 'الكود ناقص: قوس أو } لم يُغلق' : /missing \)/.test(m) ? 'قوس ) ناقص' : /Unexpected token|Invalid or unexpected/.test(m) ? 'رمز غير متوقع (فاصلة أو قوس أو علامة تنصيص ناقصة أو زائدة)' : m, 'راجع الأسطر الأخيرة قبل الخطأ وتأكد من اكتمال الأقواس والنصوص'); } }
  return d;
}
const fmtDiag = (d) => `📍 ${d.file ? d.file + ' · ' : ''}${d.line ? 'سطر ' + d.line : 'مكان الخطأ غير محدد'}\n🔎 السبب: ${d.why}\n🛠 الحل: ${d.fix}`;
const arJs = (m) => (/(\w+) is not defined/.test(m) ? `الاسم ${m.match(/(\w+) is not defined/)[1]} غير معرّف: تأكد من كتابته صحيحاً أو عرّفه قبل استخدامه` : /null|undefined/.test(m) ? 'تحاول استخدام عنصر غير موجود (غالباً الـ id غير مطابق لما في HTML)' : m);
/* Offline encrypted store: AES-GCM in IndexedDB, entry named "<id>.codelab"; decrypted only in memory while playing */
const idb = () => new Promise((res, rej) => { const q = indexedDB.open('codelab-vault', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => res(q.result); q.onerror = rej; });
const idbOp = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('f', mode); const r = fn(tx.objectStore('f')); tx.oncomplete = () => res(r.result); tx.onerror = rej; }); };
async function vaultKey() {
  let raw = localStorage.getItem('cl_vk');
  if (!raw) { raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))); localStorage.setItem('cl_vk', raw); }
  return crypto.subtle.importKey('raw', Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function saveSecure(id, url) {
  const buf = await (await fetch(url)).arrayBuffer(), iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(), buf);
  await idbOp('readwrite', (s) => s.put({ iv, data: enc }, `${id}.codelab`));
}
async function openSecure(id) {
  const rec = await idbOp('readonly', (s) => s.get(`${id}.codelab`)); if (!rec) return null;
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, await vaultKey(), rec.data);
  return URL.createObjectURL(new Blob([dec], { type: 'video/mp4' }));
}

/* ===== UI atoms ===== */
const glass = 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-[0_0_30px_-8px_rgba(168,85,247,.45)]';
const btn = 'px-4 py-2 rounded-xl font-bold transition active:scale-95';
const grad = 'bg-gradient-to-l from-fuchsia-600 to-violet-600 hover:brightness-125 text-white';
const Modal = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
    <div className={`${glass} bg-slate-900/90 w-full max-w-md p-6 cm`} onClick={(e) => e.stopPropagation()}>{children}</div>
  </div>
);

/* ===== Editor ===== */
function Editor({ onError }) {
  const [lang, setLang] = useState('html');
  const [codes, setCodes] = usePersist('cl_codes', STARTERS);
  const [tab, setTab] = useState('html'); // web sub-tab
  const [out, setOut] = useState([]);
  const [run, setRun] = useState(0);
  const [pdoc, setPdoc] = useState('');
  const ta = useRef(null), pre = useRef(null);
  const web = ['html', 'css', 'js'].includes(lang);
  const cur = web ? tab : lang;
  const code = codes[cur] ?? '';
  const set = (v) => setCodes((c) => ({ ...c, [cur]: v }));
  const put = useCallback((text, caret = text.length) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    set(code.slice(0, a) + text + code.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + caret; });
  }, [code, cur]);
  const PAIRS = { '{': '}', '[': ']', '(': ')', '<': '>', '"': '"' };
  const onKey = (e) => {
    const el = e.target, nx = code[el.selectionStart];
    if (Object.values(PAIRS).includes(e.key) && nx === e.key) { e.preventDefault(); requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = el.selectionStart + 1)); el.selectionStart++; return; }
    if (PAIRS[e.key]) { e.preventDefault(); put(e.key + PAIRS[e.key], 1); }
    if (e.key === 'Tab') { e.preventDefault(); put('  '); }
  };
  useEffect(() => {
    const h = (e) => { if (e.data?.cl === 'err') { const dg = [{ line: e.data.l, why: arJs(e.data.m), fix: 'راجع هذا السطر في تبويب JS وتأكد من الأسماء والـ id', file: 'JS' }]; setOut([`✖ ${dg[0].why} (سطر ${e.data.l})`]); onError(codes.js, 'JavaScript', dg); } };
    window.addEventListener('message', h); return () => window.removeEventListener('message', h);
  }, [codes.js, onError]);
  const doRun = async () => {
    const ds = web ? [['html', 'HTML'], ['css', 'CSS'], ['js', 'JS']].flatMap(([k, nm]) => diagnose(codes[k], k).map((x) => ({ ...x, file: nm }))) : diagnose(code, lang);
    if (web) { setRun((n) => n + 1); setPdoc(`<html dir="rtl"><style>${codes.css}</style><body>${codes.html}<script>window.onerror=(m,s,l)=>parent.postMessage({cl:'err',m,l},'*');${codes.js}<\/script></body></html>`); }
    if (ds.length) { setOut(ds.map((x) => `✖ ${x.file ? x.file + ' · ' : ''}${x.line ? 'سطر ' + x.line : ''}: ${x.why}`)); onError(code, LANGS[lang], ds); return; }
    if (web) { setOut(['✔ تم التشغيل بدون أخطاء']); return; }
    setOut(['… جارٍ التشغيل']);
    const r = await runCode(lang, code);
    if (r.noRun) return setOut([r.err]);
    if (r.err) { const dg = [{ line: 0, why: arJs(r.err), fix: 'راجع منطق الكود وأسماء المتغيرات' }]; setOut([`✖ ${dg[0].why}`]); onError(code, LANGS[lang], dg); return; }
    setOut(['✔ تم التشغيل بدون أخطاء', ...(r.out || '(لا يوجد ناتج مطبوع)').split('\n')]);
  };
  const srcDoc = pdoc;
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-3 gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        {Object.entries(LANGS).map(([k, v]) => <button key={k} onClick={() => { setLang(k); if (['html', 'css', 'js'].includes(k)) setTab(k); }} className={`${btn} text-sm ${lang === k || (web && k === tab && false) ? grad : 'bg-white/5 text-slate-300'}`}>{v}</button>)}
        <button onClick={doRun} className={`${btn} bg-emerald-500 text-black mr-auto`}>▶ تشغيل</button>
      </div>
      {web && <div className="flex gap-2">{['html', 'css', 'js'].map((t) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded-lg text-sm ${tab === t ? 'bg-amber-400 text-black font-bold' : 'bg-white/5 text-slate-300'}`}>{t.toUpperCase()}</button>)}</div>}
      <div className={`flex-1 grid gap-3 min-h-0 ${web ? 'md:grid-cols-2' : ''}`}>
        <div className={`${glass} relative overflow-hidden min-h-[220px]`} dir="ltr">
          <pre ref={pre} aria-hidden className="ed absolute inset-0 m-0 overflow-hidden" dangerouslySetInnerHTML={{ __html: highlight(code, cur) + '\n' }} />
          <textarea ref={ta} value={code} spellCheck={false} onChange={(e) => set(e.target.value)} onKeyDown={onKey}
            onScroll={(e) => { pre.current.scrollTop = e.target.scrollTop; pre.current.scrollLeft = e.target.scrollLeft; }}
            className="ed absolute inset-0 w-full h-full bg-transparent text-transparent caret-amber-300 resize-none outline-none" />
        </div>
        {web ? <iframe key={run} sandbox="allow-scripts" srcDoc={srcDoc} className="w-full h-full min-h-[220px] rounded-2xl bg-white" title="preview" /> : null}
      </div>
      <div className={`${glass} p-3 h-28 overflow-auto text-sm font-mono text-emerald-300`} dir="ltr">{out.length ? out.map((l, i) => <div key={i} className={l.startsWith('✖') ? 'text-rose-400' : ''}>{l}</div>) : <span className="text-slate-500">Terminal ›</span>}</div>
      <div className="flex gap-1 overflow-x-auto md:hidden" dir="ltr">
        {['{', '}', '[', ']', '<', '>', ';', '=', '"', ':'].map((c) => <button key={c} onMouseDown={(e) => e.preventDefault()} onClick={() => (PAIRS[c] ? put(c + PAIRS[c], 1) : put(c))} className="min-w-10 h-10 rounded-lg bg-violet-900/60 text-amber-200 font-mono text-lg">{c}</button>)}
      </div>
    </div>
  );
}

/* ===== Levels + resources ===== */
function Levels({ cfg, user, setUser }) {
  const [lang, setLang] = useState('js');
  const [active, setActive] = useState(null);
  const [pick, setPick] = useState(null);
  const [res, setRes] = useState(null);
  const done = user.progress[lang] || 0;
  const getQ = (n) => cfg.custom[`${lang}:${n}`] || genLevel(lang, n);
  const tier = (n) => (n <= 33 ? ['مبتدئ', 'bg-emerald-500'] : n <= 66 ? ['متوسط', 'bg-amber-400'] : ['متقدم', 'bg-fuchsia-500']);
  const answer = (i) => {
    setPick(i);
    if (i === getQ(active)[2]) setTimeout(() => { setUser((u) => ({ ...u, progress: { ...u.progress, [lang]: Math.max(u.progress[lang] || 0, active) } })); setActive(null); setPick(null); }, 700);
    else setTimeout(() => setPick(null), 900);
  };
  return (
    <div className="p-4 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap gap-2">{Object.entries(LANGS).map(([k, v]) => <button key={k} onClick={() => setLang(k)} className={`${btn} text-sm ${lang === k ? grad : 'bg-white/5 text-slate-300'}`}>{v}</button>)}</div>
      <p className="text-slate-300">تقدمك: <b className="text-amber-300">{done}</b> / 100</p>
      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
        {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => {
          const open = n <= done + 1, ok = n <= done, [tn, tc] = tier(n);
          return <button key={n} disabled={!open} onClick={() => setActive(n)} title={tn}
            className={`relative aspect-square rounded-xl grid place-items-center font-bold border ${ok ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300' : open ? 'border-fuchsia-400 text-white pulse' : 'bg-white/5 border-white/10 text-slate-600'}`}>
            {open ? n : '🔒'}<span className={`absolute top-0.5 left-0.5 w-2 h-2 rounded-full ${tc}`} /></button>;
        })}
      </div>
      <div className="flex gap-4 text-xs text-slate-400"><span>🟢 مبتدئ 1–33</span><span>🟡 متوسط 34–66</span><span>🟣 متقدم 67–100</span></div>
      <section className={`${glass} p-4`}>
        <h2 className="text-xl font-bold text-amber-300 mb-3">المصادر الحرة لـ {LANGS[lang]} · فيديوهات ومذكرات (مفتوحة بلا ترتيب)</h2>
        <div className="grid sm:grid-cols-2 gap-3">{cfg.resources.filter((r) => !r.lang || r.lang === lang).map((r) => (
          <button key={r.id} onClick={() => setRes(r)} className="text-right p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10">
            <span className="text-2xl">{r.type === 'video' ? '🎬' : '📄'}</span> <span className="font-bold">{r.t}</span> <span className="text-xs text-slate-400">{r.u ? '' : '(لم يُضف بعد)'}</span></button>))}</div>
      </section>
      {active && <LevelPlay key={lang + active} lang={lang} n={active} q={getQ(active)} spec={genLevel(lang, active)[3]} tier={tier(active)} onClose={() => setActive(null)} onDone={() => { setUser((u) => ({ ...u, progress: { ...u.progress, [lang]: Math.max(u.progress[lang] || 0, active) } })); setActive(null); }} />}
      {res && <ResourceView r={res} user={user} setUser={setUser} onClose={() => setRes(null)} />}
    </div>
  );
}

function ResourceView({ r, user, setUser, onClose }) {
  const [src, setSrc] = useState(null);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(true);
  const direct = /\.(mp4|webm)(\?|$)/i.test(r.u);
  const off = (user.offline || []).includes(r.id);
  useEffect(() => () => src && URL.revokeObjectURL(src), [src]);
  const dl = async () => { setMsg('جارٍ التنزيل والتشفير...'); try { await saveSecure(r.id, r.u); setUser((u) => ({ ...u, offline: [...(u.offline || []), r.id] })); setMsg('تم الحفظ مشفراً ✔'); } catch { setMsg('تعذر التنزيل (الرابط يجب أن يكون ملف mp4 مباشر يسمح بالـ CORS)'); } };
  const play = async () => setSrc(await openSecure(r.id));
  return (
    <div className="fixed inset-0 z-40 bg-slate-950/95 overflow-auto p-4">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between mb-3"><h3 className="text-xl font-bold">{r.t}</h3><button onClick={onClose} className={`${btn} bg-white/10`}>✕ إغلاق</button></div>
        <div className="aspect-video rounded-2xl overflow-hidden bg-black">
          {src ? <video src={src} controls controlsList="nodownload" onContextMenu={(e) => e.preventDefault()} className="w-full h-full" />
            : r.type === 'video' && r.u ? (direct ? <video src={r.u} controls controlsList="nodownload" className="w-full h-full" /> : <iframe src={embedUrl(r.u)} className="w-full h-full" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" title={r.t} />)
            : r.u ? <iframe src={embedUrl(r.u)} className="w-full h-full" title={r.t} /> : <div className="h-full grid place-items-center text-slate-500">لم يُرفع الملف بعد</div>}
        </div>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          {direct && !off && <button onClick={dl} className={`${btn} ${grad}`}>⬇ تنزيل محمي</button>}
          {off && <button onClick={play} className={`${btn} bg-emerald-500 text-black`}>▶ تشغيل بدون إنترنت</button>}
          <button onClick={() => setOpen(!open)} className={`${btn} bg-amber-400 text-black`}>📝 المفكرة</button>
          <span className="text-sm text-slate-400">{msg}</span>
        </div>
      </div>
      {open && <Notebook rid={r.id} user={user} setUser={setUser} />}
    </div>
  );
}

function Notebook({ rid, user, setUser }) {
  return (
    <aside className={`${glass} bg-slate-900/95 fixed bottom-0 left-0 right-0 md:left-4 md:right-auto md:bottom-4 md:w-80 h-64 p-3 flex flex-col z-50`}>
      <b className="text-amber-300 mb-2">مفكرتي · تُحفظ تلقائياً</b>
      <textarea value={user.notes?.[rid] || ''} onChange={(e) => setUser((u) => ({ ...u, notes: { ...u.notes, [rid]: e.target.value } }))} placeholder="دوّن ملاحظاتك عن هذا الدرس..." className="flex-1 bg-black/30 rounded-xl p-3 outline-none resize-none" />
    </aside>
  );
}

/* ===== Admin ===== */
function Admin({ cfg, setCfg, onExit }) {
  const [ok, setOk] = useState(false), [pin, setPin] = useState(''), [err, setErr] = useState('');
  const [lock, setLock] = usePersist('cl_lock', { n: 0, until: 0 });
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('lvl');
  const [users, setUsers] = useState([]);
  const loadUsers = () => api('users', {}, 'cl_adm').then((d) => setUsers(d?.users || []));
  useEffect(() => { if (ok && tab === 'usr') loadUsers(); }, [ok, tab]);
  const [f, setF] = useState({ lang: 'js', n: 1, q: '', a: '', b: '', c: '', right: 0, rt: '', ru: '', rtype: 'video', rl: 'js', gk: '', yk: '', pl: '', newPin: '', ln: '', lu: '' });
  const u = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const inp = 'w-full bg-black/30 border border-white/10 rounded-xl p-2 my-1 outline-none focus:border-fuchsia-400';
  const login = async () => {
    const r = await api('adminLogin', { pin });
    if (r === null) { const h = await sha(pin); if (h === (cfg.pinHash || (await sha(DEF.pin)))) setOk(true); else setErr('الرمز غير صحيح'); return; }
    if (r.token) { localStorage.setItem('cl_adm', r.token); setOk(true); } else setErr(r.error || 'الرمز غير صحيح');
  };
  if (!ok) return (
    <div className="grid place-items-center h-[70vh] p-4"><div className={`${glass} p-6 w-full max-w-sm text-center`}>
      <div className="text-4xl mb-2">🔐</div><h2 className="font-bold mb-3">لوحة الأدمن</h2>
      <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} placeholder="رمز المرور" className={`${inp} text-center tracking-widest`} />
      {err && <p className="text-rose-400 text-sm">{err}</p>}
      <button onClick={login} className={`${btn} ${grad} w-full mt-2`}>دخول</button>
      <button onClick={onExit} className="block mx-auto text-xs text-slate-400 mt-3">رجوع</button></div></div>);
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex gap-2 flex-wrap"><button onClick={onExit} className={`${btn} text-sm bg-rose-600 text-white`}>🔒 خروج</button>{[['lvl', 'المستويات'], ['res', 'المصادر'], ['dev', 'المطور والروابط'], ['usr', 'المستخدمون'], ['pin', 'الأمان']].map(([k, v]) => <button key={k} onClick={() => setTab(k)} className={`${btn} text-sm ${tab === k ? grad : 'bg-white/5'}`}>{v}</button>)}</div>
      <div className={`${glass} p-4`}>
        {tab === 'lvl' && <>
          <select value={f.lang} onChange={u('lang')} className={inp}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k} className="text-black">{v}</option>)}</select>
          <input type="number" min="1" max="100" value={f.n} onChange={u('n')} className={inp} placeholder="رقم المستوى" />
          <input value={f.q} onChange={u('q')} className={inp} placeholder="السؤال" />
          {['a', 'b', 'c'].map((k) => <input key={k} value={f[k]} onChange={u(k)} className={inp} placeholder={`الخيار ${k.toUpperCase()}`} />)}
          <select value={f.right} onChange={u('right')} className={inp}>{['A', 'B', 'C'].map((x, i) => <option key={x} value={i} className="text-black">الإجابة الصحيحة: {x}</option>)}</select>
          <button className={`${btn} bg-white/10 w-full mb-2`} onClick={() => { const L = cfg.custom[`${f.lang}:${f.n}`] || genLevel(f.lang, +f.n); setF({ ...f, q: L[0], a: L[1][0], b: L[1][1], c: L[1][2], right: L[2] }); }}>تحميل المستوى الحالي للتعديل</button>
          <button className={`${btn} ${grad} w-full`} onClick={() => { setCfg({ ...cfg, custom: { ...cfg.custom, [`${f.lang}:${f.n}`]: [f.q, [f.a, f.b, f.c], +f.right] } }); setF({ ...f, q: '', a: '', b: '', c: '' }); }}>حفظ المستوى</button>
          <p className="text-xs text-slate-400 mt-2">المستويات المخصصة: {Object.keys(cfg.custom).length}</p></>}
        {tab === 'res' && <>
          <select value={f.rl} onChange={u('rl')} className={inp}>{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k} className="text-black">{v}</option>)}</select>
          <input value={f.rt} onChange={u('rt')} className={inp} placeholder="العنوان" />
          <input value={f.ru} onChange={u('ru')} className={inp} placeholder="الرابط (YouTube embed / mp4 / pdf)" dir="ltr" />
          <input value={f.pl} onChange={u('pl')} className={inp} placeholder="رابط قائمة تشغيل يوتيوب لاستيراد كل فيديوهاتها (اختياري)" dir="ltr" />
          <button className={`${btn} bg-white/10 w-full mb-2`} onClick={async () => { const r = await api('yt', { list: f.pl }, 'cl_adm'); if (!r?.items) return setMsg(r?.error || 'فشل الاستيراد (أضف مفتاح YouTube من تبويب الأمان)'); setCfg({ ...cfg, resources: [...cfg.resources, ...r.items.map((v) => ({ id: 'yt' + v.id + f.rl, lang: f.rl, t: v.t, type: 'video', u: 'https://www.youtube.com/watch?v=' + v.id }))] }); setMsg(`تم استيراد ${r.items.length} فيديو ✔`); }}>استيراد قائمة التشغيل</button>
          <p className="text-xs text-amber-300">{msg}</p>
          <select value={f.rtype} onChange={u('rtype')} className={inp}><option value="video" className="text-black">فيديو</option><option value="pdf" className="text-black">PDF</option></select>
          <button className={`${btn} ${grad} w-full`} onClick={() => { setCfg({ ...cfg, resources: [...cfg.resources, { id: 'r' + Date.now(), lang: f.rl, t: f.rt, u: f.ru, type: f.rtype }] }); setF({ ...f, rt: '', ru: '' }); }}>إضافة مصدر</button>
          {cfg.resources.map((r) => <div key={r.id} className="py-2 border-b border-white/5"><div className="flex justify-between"><span>{LANGS[r.lang] || 'الكل'} · {r.type === 'video' ? '🎬' : '📄'} {r.t}</span><button onClick={() => setCfg({ ...cfg, resources: cfg.resources.filter((x) => x.id !== r.id) })} className="text-rose-400">حذف</button></div><input value={r.u} dir="ltr" placeholder="الرابط" onChange={(e) => setCfg({ ...cfg, resources: cfg.resources.map((x) => (x.id === r.id ? { ...x, u: e.target.value } : x)) })} className={inp} /></div>)}</>}
        {tab === 'dev' && <>
          <input value={cfg.dev.name} onChange={(e) => setCfg({ ...cfg, dev: { ...cfg.dev, name: e.target.value } })} className={inp} placeholder="الاسم" />
          <div className="flex items-center gap-3 my-2">
            {cfg.dev.photo ? <img src={cfg.dev.photo} alt="" className="w-16 h-16 rounded-full object-cover" /> : <div className="w-16 h-16 rounded-full bg-white/10 grid place-items-center text-2xl">👨‍💻</div>}
            <label className={`${btn} bg-white/10 text-sm cursor-pointer`}>📷 رفع صورة من الجهاز<input type="file" accept="image/*" className="hidden" onChange={async (e) => { const fl = e.target.files[0]; if (fl) setCfg({ ...cfg, dev: { ...cfg.dev, photo: await pickPhoto(fl) } }); e.target.value = ''; }} /></label>
            {cfg.dev.photo && <button onClick={() => setCfg({ ...cfg, dev: { ...cfg.dev, photo: '' } })} className="text-rose-400 text-sm">حذف</button>}
          </div>
          <textarea value={cfg.dev.bio} onChange={(e) => setCfg({ ...cfg, dev: { ...cfg.dev, bio: e.target.value } })} className={inp} rows={3} />
          <input value={cfg.dev.tech.join(',')} onChange={(e) => setCfg({ ...cfg, dev: { ...cfg.dev, tech: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } })} className={inp} placeholder="التقنيات مفصولة بفاصلة" />
          <hr className="border-white/10 my-3" />
          {cfg.links.map((l, i) => <div key={i} className="flex gap-1"><input value={l.n} onChange={(e) => setCfg({ ...cfg, links: cfg.links.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)) })} className={inp} /><input value={l.u} dir="ltr" onChange={(e) => setCfg({ ...cfg, links: cfg.links.map((x, j) => (j === i ? { ...x, u: e.target.value } : x)) })} className={inp} /><button onClick={() => setCfg({ ...cfg, links: cfg.links.filter((_, j) => j !== i) })} className="text-rose-400 px-2">✕</button></div>)}
          <div className="flex gap-1"><input value={f.ln} onChange={u('ln')} className={inp} placeholder="اسم الرابط" /><input value={f.lu} onChange={u('lu')} className={inp} placeholder="https://" dir="ltr" /><button onClick={() => { if (f.ln && f.lu) { setCfg({ ...cfg, links: [...cfg.links, { n: f.ln, u: f.lu }] }); setF({ ...f, ln: '', lu: '' }); } }} className={`${btn} bg-emerald-500 text-black`}>+</button></div></>}
        {tab === 'usr' && <>
          <div className="flex justify-between mb-2"><b>عدد المستخدمين: {users.length}</b><button onClick={loadUsers} className="text-amber-300 text-sm">تحديث</button></div>
          {users.length === 0 && <p className="text-xs text-slate-400">لا يوجد مستخدمون بعد، أو أن الخادم غير متصل.</p>}
          {users.map((x) => <div key={x.email} className="py-2 border-b border-white/5 text-sm"><b>{x.name || 'بدون اسم'}</b> · <span dir="ltr">{x.email}</span><br />📞 <span dir="ltr">{x.phone || '-'}</span> · مستويات منجزة: {x.levels} · آخر ظهور: {new Date(x.last).toLocaleDateString('ar-EG')}</div>)}</>}
        {tab === 'pin' && <>
          <input type="password" value={f.newPin} onChange={u('newPin')} className={inp} placeholder="رمز جديد (4 أرقام على الأقل)" />
          <button className={`${btn} ${grad} w-full`} onClick={async () => { if (f.newPin.length >= 4) { const r = await api('setPin', { pin: f.newPin }, 'cl_adm'); if (!r) setCfg({ ...cfg, pinHash: await sha(f.newPin) }); setMsg(!r || r.ok ? 'تم تحديث الرمز ✔' : 'فشل: سجّل دخول الأدمن من جديد'); setF({ ...f, newPin: '' }); } }}>تحديث الرمز</button>
          <hr className="border-white/10 my-3" />
          <input value={f.gk} onChange={u('gk')} className={inp} placeholder="مفتاح Gemini المجاني" dir="ltr" />
          <input value={f.yk} onChange={u('yk')} className={inp} placeholder="مفتاح YouTube Data API (لاستيراد القوائم)" dir="ltr" />
          <button className={`${btn} ${grad} w-full`} onClick={async () => { const r = await api('setKeys', { gemini: f.gk, youtube: f.yk }, 'cl_adm'); setMsg(r?.ok ? 'تم حفظ المفاتيح على الخادم ✔' : r?.error || 'فشل الحفظ'); setF({ ...f, gk: '', yk: '' }); }}>حفظ المفاتيح</button>
          <p className="text-xs text-amber-300 mt-2">{msg}</p></>}
      </div>
    </div>
  );
}

/* ===== Profile with 3D tilt cards ===== */
function Tilt({ children }) {
  const [s, setS] = useState('');
  return <div onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setS(`perspective(600px) rotateY(${((e.clientX - r.left) / r.width - 0.5) * 24}deg) rotateX(${-((e.clientY - r.top) / r.height - 0.5) * 24}deg) scale(1.06)`); }} onMouseLeave={() => setS('')} style={{ transform: s, transition: 'transform .15s' }} className={`${glass} p-4 text-center font-bold text-amber-200`}>{children}</div>;
}
function Profile({ cfg }) {
  const d = cfg.dev;
  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6 text-center">
      <div className="w-32 h-32 mx-auto rounded-full p-1 bg-gradient-to-tr from-fuchsia-500 via-amber-400 to-emerald-400">
        {d.photo ? <img src={d.photo} alt={d.name} className="w-full h-full rounded-full object-cover" /> : <div className="w-full h-full rounded-full bg-slate-900 grid place-items-center text-5xl">👨‍💻</div>}</div>
      <h1 className="text-3xl font-black">{d.name}</h1>
      <p className="text-slate-300 max-w-xl mx-auto leading-8">{d.bio}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">{d.tech.map((t) => <Tilt key={t}>{t}</Tilt>)}</div>
      <div className="flex flex-wrap justify-center gap-3">{cfg.links.map((l) => <a key={l.n} href={l.u} target="_blank" rel="noopener noreferrer" className={`${btn} ${grad}`}>{l.n}</a>)}</div>
    </div>
  );
}

function CodeBox({ value, onChange, lang }) {
  const pre = useRef(null);
  return (
    <div className={`${glass} relative overflow-hidden h-64`} dir="ltr">
      <pre ref={pre} aria-hidden className="ed absolute inset-0 m-0 overflow-hidden" dangerouslySetInnerHTML={{ __html: highlight(value, lang) + '\n' }} />
      <textarea value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} onScroll={(e) => { pre.current.scrollTop = e.target.scrollTop; pre.current.scrollLeft = e.target.scrollLeft; }}
        onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); const el = e.target, st = el.selectionStart; onChange(value.slice(0, st) + '  ' + value.slice(el.selectionEnd)); requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = st + 2)); } }}
        className="ed absolute inset-0 w-full h-full bg-transparent text-transparent caret-amber-300 resize-none outline-none" />
    </div>
  );
}

// One level = lesson -> coding exercise in the language editor -> quick quiz
function LevelPlay({ lang, n, q: quiz, spec, tier, onClose, onDone }) {
  const [step, setStep] = useState(0), [code, setCode] = useState(spec.starter), [out, setOut] = useState(''), [ok, setOk] = useState(false), [pick, setPick] = useState(null), [pdoc, setPdoc] = useState('');
  const web = lang === 'html' || lang === 'css';
  const [txt, ...rest] = spec.lesson.split('\n\nمثال:\n'), ex = rest.join('');
  const run = async () => {
    setOk(false); setOut('… جارٍ التشغيل');
    const ds = diagnose(code, lang);
    if (ds.length) return setOut(ds.map(fmtDiag).join('\n\n'));
    if (web) {
      setPdoc(lang === 'html' ? code : `<style>${code}</style><h1>عنوان</h1><p>فقرة</p><a href="#">رابط</a><button>زر</button><div class="box">صندوق</div>`);
      const dom = new DOMParser().parseFromString(code, 'text/html');
      const miss = spec.need.filter((k) => (lang === 'html' ? !dom.querySelector(k) : !(/^[a-z-]+$/.test(k) ? new RegExp('(^|[\\s;{])' + k + '\\s*:').test(code) : code.includes(k === 'var(--x)' ? 'var(--' : k))));
      if (miss.length) return setOut('ينقص استخدام: ' + miss.join('، '));
      setOk(true); return setOut('✔ ممتاز! التمرين صحيح.');
    }
    const r = await runCode(lang, code);
    if (r.noRun) return setOut(r.err);
    if (r.err) return setOut('📍 خطأ أثناء التشغيل\n🔎 السبب: ' + arJs(r.err) + '\n🛠 الحل: راجع منطق الكود وأسماء المتغيرات');
    const got = (r.out || '').trim();
    if (got === spec.expect) { setOk(true); setOut(`✔ ممتاز! الناتج ${got} صحيح.`); } else setOut(`الناتج الحالي: ${got || '(لا شيء مطبوع)'}\nالمطلوب: ${spec.expect}\nراجع الكود وحاول مجدداً.`);
  };
  const [qq, opts, right] = quiz;
  return (
    <div className="fixed inset-0 z-40 bg-slate-950/95 overflow-auto p-4"><div className="max-w-2xl mx-auto space-y-3">
      <div className="flex justify-between items-center"><span className={`text-xs px-2 py-1 rounded-full text-black ${tier[1]}`}>مستوى {n} · {tier[0]} · {LANGS[lang]}</span><button onClick={onClose} className={`${btn} bg-white/10`}>✕</button></div>
      <h2 className="text-2xl font-black text-amber-300">{spec.title}</h2>
      <div className="flex gap-2 text-xs">{['١ الشرح', '٢ التطبيق', '٣ الاختبار'].map((x, i) => <span key={x} className={`px-2 py-1 rounded-full ${step === i ? 'bg-fuchsia-600 text-white' : 'bg-white/10'}`}>{x}</span>)}</div>
      {step === 0 && <>
        <div className={`${glass} p-4 leading-8 whitespace-pre-wrap`}>{txt}</div>
        {ex && <pre dir="ltr" className="bg-black/40 rounded-xl p-3 text-sm text-emerald-300 overflow-auto font-mono">{ex}</pre>}
        <button onClick={() => setStep(1)} className={`${btn} ${grad} w-full`}>ابدأ التمرين ←</button></>}
      {step === 1 && <>
        <div className={`${glass} p-3 whitespace-pre-wrap`}>🎯 {spec.task}</div>
        <CodeBox value={code} onChange={setCode} lang={lang} />
        <div className="flex gap-2"><button onClick={run} className={`${btn} bg-emerald-500 text-black flex-1`}>▶ تشغيل وفحص</button><button onClick={() => setCode(spec.solution)} className={`${btn} bg-white/10`}>💡 الحل</button></div>
        {out && <pre className={`${glass} p-3 text-sm whitespace-pre-wrap ${ok ? 'text-emerald-300' : 'text-amber-200'}`}>{out}</pre>}
        {web && pdoc && <iframe sandbox="allow-scripts" srcDoc={pdoc} className="w-full h-48 rounded-2xl bg-white" title="preview" />}
        {ok && <button onClick={() => setStep(2)} className={`${btn} ${grad} w-full`}>التالي: الاختبار السريع ←</button>}</>}
      {step === 2 && <>
        <h3 className="text-lg font-bold">{qq.split('\n')[0]}</h3>
        {qq.includes('\n') && <pre dir="ltr" className="bg-black/40 rounded-xl p-3 text-sm text-emerald-300 overflow-auto font-mono">{qq.split('\n').slice(1).join('\n')}</pre>}
        <div className="space-y-2">{opts.map((t, i) => <button key={i} dir="auto" onClick={() => { setPick(i); if (i === right) setTimeout(onDone, 700); else setTimeout(() => setPick(null), 900); }} className={`w-full p-3 rounded-xl border text-start font-mono ${pick === i ? (i === right ? 'bg-emerald-500/30 border-emerald-400' : 'bg-rose-500/30 border-rose-400') : 'bg-white/5 border-white/10'}`}>{t}</button>)}</div></>}
    </div></div>
  );
}

function Chat({ ai, setAi }) {
  const [open, setOpen] = useState(false), [msgs, setMsgs] = useState([]), [t, setT] = useState(''), [busy, setBusy] = useState(false);
  const live = ai.on && !ai.quota;
  const send = async () => {
    if (!t.trim() || busy) return;
    const h = [...msgs, { role: 'user', text: t }]; setMsgs(h); setT(''); setBusy(true);
    const r = live ? await askAI(t, msgs) : null;
    if (r?.quota) setAi((a) => ({ ...a, quota: true }));
    const reply = r?.text || (r?.quota ? '⚠️ انتهى الحد المجاني لـ Gemini، سأجيب بالذكاء الداخلي.\n\n' : '') + localAnswer(t);
    setMsgs([...h, { role: 'model', text: reply }]); setBusy(false);
  };
  return (
    <>
      <button onClick={() => setOpen(!open)} className={`${btn} ${grad} fixed bottom-20 right-4 z-40 rounded-full shadow-lg`}>🤖 تواصل مع الذكاء الاصطناعي</button>
      {open && (
        <div className={`${glass} bg-slate-900/95 fixed bottom-36 right-4 left-4 sm:left-auto sm:w-96 h-96 z-40 flex flex-col p-3`}>
          <b className="text-amber-300 mb-2">{live ? '✨ Gemini' : '🧠 الذكاء الداخلي'} · المنصة وتعلم البرمجة فقط</b>
          <div className="flex-1 overflow-auto space-y-2 text-sm">{msgs.length === 0 && <p className="text-slate-500">اسألني عن طريقة استخدام المنصة أو عن أي مفهوم برمجي.</p>}
            {msgs.map((m, i) => <div key={i} className={`p-2 rounded-xl whitespace-pre-wrap ${m.role === 'user' ? 'bg-violet-700/50' : 'bg-white/10'}`}>{m.text}</div>)}{busy && <p className="text-slate-500">...</p>}</div>
          <div className="flex gap-2 mt-2"><input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="اكتب سؤالك" className="flex-1 bg-black/30 rounded-xl p-2 outline-none" /><button onClick={send} className={`${btn} bg-emerald-500 text-black`}>إرسال</button></div>
        </div>)}
    </>
  );
}

/* ===== Root ===== */
export default function CodeLab({ startScreen = 'editor' }) {
  const [screen, setScreen] = useState(startScreen); // currentScreen
  const [cfg, setCfg] = usePersist('cl_cfg', DEF);
  const [user, setUser] = usePersist('cl_user', { progress: {}, notes: {}, offline: [] });
  const [isLoggedIn, setLogged] = usePersist('cl_logged', false);
  const [auth, setAuth] = useState(null); // target screen waiting for login
  const [form, setForm] = useState({ name: '', email: '', phone: '', pass: '' });
  const [mode, setMode] = useState('in'); // in = login, up = signup
  const [inst, setInst] = useState(null);
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); const h = (e) => { e.preventDefault(); setInst(e); }; window.addEventListener('beforeinstallprompt', h); return () => window.removeEventListener('beforeinstallprompt', h); }, []);
  const [explain, setExplain] = useState(null);
  const [theme, setTheme] = usePersist('cl_theme', 'dark');
  useEffect(() => { if (location.hash === '#light' || location.hash === '#dark') setTheme(location.hash.slice(1)); }, []);
  const tm = useRef(), pulled = useRef(false);
  const [ai, setAi] = useState({ on: false, quota: false });
  const geminiOn = ai.on && !ai.quota;
  const saveCfg = (c) => { setCfg(c); clearTimeout(tm.current); tm.current = setTimeout(() => api('setCfg', { cfg: c }, 'cl_adm'), 800); };
  const pull = async () => { if (!tok('cl_tok')) return; const r = await api('me'); if (r?.user) { setUser((u) => ({ ...u, ...r.user.data })); pulled.current = true; } else if (r?.error) localStorage.removeItem('cl_tok'); };
  useEffect(() => {
    api('status').then((x) => x && setAi({ on: !!x.ai, quota: !!x.quota }));
    api('getCfg').then((r) => r?.cfg && setCfg((c) => ({ ...c, ...r.cfg })));
    pull();
    if (location.hash === '#admin') setScreen('admin');
  }, []);
  useEffect(() => { if (!pulled.current || !tok('cl_tok')) return; const id = setTimeout(() => api('save', { data: user }), 1000); return () => clearTimeout(id); }, [user]);
  // Hidden admin entry: tap the logo 7 times within 3s (or Ctrl+Shift+A on desktop)
  const taps = useRef({ n: 0, t: 0 });
  const tap = () => { const now = Date.now(), k = taps.current; k.n = now - k.t > 3000 ? 1 : k.n + 1; k.t = now; if (k.n >= 7) { k.n = 0; setScreen('admin'); } };
  useEffect(() => { const h = (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') setScreen('admin'); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const go = (s) => { if (s === 'levels' && !isLoggedIn) setAuth(s); else setScreen(s); };
  const login = async () => {
    if (!form.email.includes('@') || form.pass.length < 6 || (mode === 'up' && !form.name)) return alert('أكمل الحقول: بريد صحيح وكلمة سر 6 أحرف على الأقل' + (mode === 'up' ? ' والاسم' : ''));
    const r = await api(mode === 'up' ? 'signup' : 'login', { name: form.name, email: form.email, phone: form.phone, password: form.pass });
    if (r?.error) return alert(r.error);
    if (r?.token) { localStorage.setItem('cl_tok', r.token); pulled.current = false; await pull(); }
    setLogged(true); setScreen(auth); setAuth(null);
  };
  const onError = useCallback(async (code, lang, diags) => {
    const local = diags.map(fmtDiag).join('\n\n');
    if (!geminiOn) return setExplain({ text: local, local: true });
    setExplain({ loading: true });
    const r = await askAI(`اللغة: ${lang}\nالأخطاء: ${diags.map((x) => `سطر ${x.line}: ${x.why}`).join('; ')}\nالكود:\n${code}\nاشرح بالعربية وباختصار: مكان الخطأ، سببه، وطريقة إصلاحه.`);
    if (r?.quota) setAi((a) => ({ ...a, quota: true }));
    setExplain(r?.text ? { text: r.text } : { text: local, local: true });
  }, [geminiOn]);
  const boost = async () => {
    const base = explain.text; setExplain({ loading: true });
    try {
      llm ||= await (await import(/* webpackIgnore: true */ 'https://esm.run/@mlc-ai/web-llm')).CreateMLCEngine('Qwen2.5-0.5B-Instruct-q4f16_1-MLC');
      const r = await llm.chat.completions.create({ messages: [{ role: 'system', content: 'اشرح خطأ البرمجة التالي بالعربية ببساطة وبإيجاز.' }, { role: 'user', content: base }] });
      setExplain({ text: base + '\n\n🧠 شرح مبسّط:\n' + r.choices[0].message.content, local: true, boosted: true });
    } catch { setExplain({ text: base + '\n\n(الجهاز لا يدعم WebGPU أو فشل تنزيل النموذج)', local: true, boosted: true }); }
  };
  const items = [['editor', 'محرر الأكواد'], ['levels', 'الـ 100 مستوى'], ['profile', 'بروفايل المطور']];
  return (
    <div dir="rtl" className={`min-h-screen text-slate-100 app ${theme === 'light' ? 'light' : ''}`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&family=JetBrains+Mono&display=swap');
        .app{font-family:Tajawal,sans-serif;background:radial-gradient(900px 500px at 85% -10%,#4c1d95aa,transparent),radial-gradient(700px 400px at 0% 100%,#86198f55,transparent),#0b0816}
        .ed{font:14px/1.6 'JetBrains Mono',monospace;padding:14px;white-space:pre;tab-size:2;color:#e2e8f0}
        textarea.ed{-webkit-text-fill-color:transparent}
        .t1{color:#c084fc;font-style:normal}.t2{color:#fbbf24;font-style:normal}.t3{color:#34d399;font-style:normal}.t4{color:#f0abfc;font-style:normal}.t5{color:#64748b;font-style:normal}
        .pulse{animation:p 2s infinite}@keyframes p{50%{box-shadow:0 0 18px #d946ef}}

        .light.app{color-scheme:light;background:radial-gradient(900px 500px at 85% -10%,#ddd6fe,transparent),radial-gradient(700px 400px at 0% 100%,#fbcfe8,transparent),#f8f7ff;color:#1e1b4b}
        .light .text-slate-100,.light .text-slate-200,.light .text-slate-300{color:#1e1b4b}
        .light .text-slate-400,.light .text-slate-500,.light .text-slate-600{color:#475569}
        .light .bg-white\\/5{background:#ffffffb3}.light .bg-white\\/10{background:#ede9fe}
        .light .bg-slate-900\\/90,.light .bg-slate-900\\/95,.light .bg-slate-950\\/70,.light .bg-slate-950\\/95{background:#fffffff2}
        .light .bg-black\\/30,.light .bg-black\\/40{background:#f1f5f9}.light .bg-violet-900\\/60{background:#ddd6fe}
        .light .border-white\\/10,.light .border-white\\/5{border-color:#c4b5fd}
        .light .text-amber-300,.light .text-amber-200{color:#b45309}.light .text-emerald-300{color:#047857}
        .light button.pulse{color:#86198f}.light .ed{color:#1e293b}.light textarea.ed{color:transparent}
        .light .t1{color:#7c3aed}.light .t2{color:#b45309}.light .t3{color:#047857}.light .t4{color:#a21caf}.light .t5{color:#94a3b8}
        .light pre.text-emerald-300{color:#047857}
        @media(prefers-reduced-motion:reduce){.pulse{animation:none}}
      `}</style>
      <nav className="sticky top-0 z-30 h-16 flex items-center gap-3 px-4 bg-slate-950/70 backdrop-blur-xl border-b border-white/10 overflow-x-auto">
        <span onClick={tap} className="select-none cursor-default font-black text-xl bg-gradient-to-l from-amber-300 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent whitespace-nowrap">كود لاب | CodeLab</span>
        <div className="flex gap-1 mr-auto">{items.map(([k, v]) => <button key={k} onClick={() => go(k)} className={`px-3 py-2 rounded-xl text-sm whitespace-nowrap transition ${screen === k ? grad : 'text-slate-300 hover:bg-white/10'}`}>{v}</button>)}</div>
        {inst && <button onClick={() => { inst.prompt(); setInst(null); }} className="px-3 py-2 rounded-xl bg-emerald-500 text-black whitespace-nowrap text-sm">📲 تثبيت</button>}
        <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="px-3 py-2 rounded-xl bg-white/10 whitespace-nowrap" aria-label="تبديل الوضع">{theme === 'light' ? '🌙 داكن' : '☀️ فاتح'}</button>
        <span className="text-xs whitespace-nowrap text-slate-400">{geminiOn ? '✨ Gemini' : '🧠 ذكاء محلي'}</span>
        {isLoggedIn && <button onClick={() => { localStorage.removeItem('cl_tok'); pulled.current = false; setLogged(false); setScreen('editor'); }} className="text-xs text-slate-400 whitespace-nowrap">خروج</button>}
      </nav>
      <main>
        {screen === 'editor' && <Editor onError={onError} />}
        {screen === 'levels' && <Levels cfg={cfg} user={user} setUser={setUser} />}
        {screen === 'profile' && <Profile cfg={cfg} />}
        {screen === 'admin' && <Admin cfg={cfg} setCfg={saveCfg} onExit={() => setScreen('editor')} />}
      </main>
      <Chat ai={ai} setAi={setAi} />
      {auth && (
        <Modal onClose={() => setAuth(null)}>
          <h2 className="text-xl font-black mb-1">{mode === 'in' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}</h2>
          <p className="text-sm text-slate-400 mb-3">المحرر مجاني للجميع، والمستويات والمفكرة للمسجلين.</p>
          {[['name', 'الاسم', 'text'], ['email', 'البريد الإلكتروني', 'email'], ['phone', 'رقم الهاتف', 'tel'], ['pass', 'كلمة السر', 'password']].filter(([k]) => mode === 'up' || k === 'email' || k === 'pass').map(([k, p, t]) => <input key={k} type={t} placeholder={p} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full bg-black/30 border border-white/10 rounded-xl p-3 my-1 outline-none focus:border-fuchsia-400" />)}
          <button onClick={login} className={`${btn} ${grad} w-full mt-2`}>{mode === 'in' ? 'دخول' : 'إنشاء الحساب'}</button>
          <button onClick={() => setMode(mode === 'in' ? 'up' : 'in')} className="block mx-auto text-sm text-amber-300 mt-3">{mode === 'in' ? 'ليس لديك حساب؟ أنشئ حساباً' : 'لديك حساب؟ سجّل الدخول'}</button>
        </Modal>)}
      {explain && (
        <Modal onClose={() => setExplain(null)}>
          <h3 className="font-black text-amber-300 mb-2">🔍 شرح الخطأ</h3>
          <div className="whitespace-pre-wrap leading-7 text-sm max-h-80 overflow-auto">{explain.loading ? 'جارٍ التحليل...' : explain.text}</div>
          {explain.local && <p className="text-xs text-slate-500 mt-2">🧠 تحليل محلي يعمل على جهازك</p>}
          {explain.local && !explain.boosted && <button onClick={boost} className={`${btn} bg-white/10 w-full mt-2 text-sm`}>شرح أذكى بنموذج على الهاتف (تجريبي · تنزيل كبير)</button>}
          <button onClick={() => setExplain(null)} className={`${btn} ${grad} w-full mt-3`}>فهمت</button>
        </Modal>)}
    </div>
  );
}
