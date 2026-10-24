// ضعه في: app/api/db/route.js — قاعدة البيانات والخادم الخاصان بالمنصة (بدون Supabase)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ===== التخزين: Redis (Upstash / Vercel KV) إن وُجد، وإلا ملف JSON ===== */
const KV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KVT = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const FILE = process.env.VERCEL ? '/tmp/codelab-db.json' : path.join(process.cwd(), 'data.json');
const kv = async (cmd) => (await (await fetch(KV, { method: 'POST', headers: { Authorization: `Bearer ${KVT}` }, body: JSON.stringify(cmd) })).json()).result;
async function dbGet(k) {
  if (KV) { const v = await kv(['GET', k]); return v ? JSON.parse(v) : null; }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8'))[k] ?? null; } catch { return null; }
}
async function dbSet(k, v) {
  if (KV) { await kv(['SET', k, JSON.stringify(v)]); return; }
  let all = {}; try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  all[k] = v; fs.writeFileSync(FILE, JSON.stringify(all));
}

/* ===== الأمان: كلمات السر (scrypt) + رموز موقّعة (HMAC) ===== */
const SECRET = process.env.AUTH_SECRET || 'change-this-secret';
const H = (s) => crypto.createHash('sha256').update(s + SECRET).digest('hex');
const sign = (p) => { const b = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 30 * 864e5 })).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = (t) => { try { const [b, s] = t.split('.'); if (s !== crypto.createHmac('sha256', SECRET).update(b).digest('base64url')) return null; const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; } };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

const RULES = 'أنت مساعد منصة CodeLab التعليمية. أجب بالعربية وباختصار، وفقط عن أمرين: (1) استخدام المنصة: محرر الأكواد، المستويات الـ100 (شرح ثم تمرين ثم اختبار)، المصادر الحرة، المفكرة، التنزيل المحمي، التسجيل. (2) تعلم البرمجة (HTML, CSS, JavaScript, Python, C++, Java) وشرح أخطاء الأكواد. إذا كان السؤال خارج ذلك فاعتذر بلطف ووجّه المستخدم لسؤال عن المنصة أو البرمجة.';
const hits = {}, fails = {};

export async function POST(req) {
  const J = (o, s = 200) => Response.json(o, { status: s });
  const body = await req.json().catch(() => ({}));
  const a = body.action;
  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0];
  const auth = verify((req.headers.get('authorization') || '').replace('Bearer ', ''));
  const admin = auth?.role === 'admin';
  const st = (await dbGet('settings')) || {};
  const geminiKey = st.gemini || process.env.GEMINI_API_KEY;

  if (a === 'status') return J({ ai: !!geminiKey, quota: (st.quotaUntil || 0) > Date.now(), yt: !!(st.youtube || process.env.YOUTUBE_API_KEY) });
  if (a === 'getCfg') return J({ cfg: await dbGet('cfg') });

  if (a === 'signup' || a === 'login') {
    const email = String(body.email || '').trim().toLowerCase(), pw = String(body.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 6) return J({ error: 'بريد صحيح وكلمة سر 6 أحرف على الأقل' });
    let u = await dbGet('u:' + email);
    if (a === 'signup') {
      if (u) return J({ error: 'هذا البريد مسجّل مسبقاً، سجّل الدخول' });
      const salt = crypto.randomBytes(16).toString('hex');
      u = { name: String(body.name || '').slice(0, 60), email, phone: String(body.phone || '').slice(0, 20), salt, hash: hashPw(pw, salt), created: Date.now(), last: Date.now(), levels: 0, data: {} };
      await dbSet('u:' + email, u);
      const idx = (await dbGet('idx')) || []; idx.push(email); await dbSet('idx', idx);
    } else {
      if (!u || hashPw(pw, u.salt) !== u.hash) return J({ error: 'البريد أو كلمة السر غير صحيحة' });
      u.last = Date.now(); await dbSet('u:' + email, u);
    }
    return J({ token: sign({ sub: email, role: 'user' }) });
  }
  if (a === 'me' || a === 'save') {
    if (!auth || auth.role !== 'user') return J({ error: 'unauth' });
    const u = await dbGet('u:' + auth.sub); if (!u) return J({ error: 'unauth' });
    if (a === 'save') {
      const d = body.data || {}; if (JSON.stringify(d).length > 2e5) return J({ error: 'too big' });
      u.data = d; u.last = Date.now(); u.levels = Object.values(d.progress || {}).reduce((x, y) => x + (+y || 0), 0);
      await dbSet('u:' + auth.sub, u); return J({ ok: true });
    }
    return J({ user: { name: u.name, email: u.email, phone: u.phone, data: u.data || {} } });
  }

  if (a === 'adminLogin') {
    if ((fails[ip]?.until || 0) > Date.now()) return J({ error: 'محاولات كثيرة، انتظر 5 دقائق' });
    const ok = H(String(body.pin || '')) === (st.pinHash || H(process.env.ADMIN_PIN || '100100'));
    if (ok) { delete fails[ip]; return J({ token: sign({ role: 'admin' }) }); }
    const f = (fails[ip] ||= { n: 0, until: 0 }); if (++f.n >= 5) { f.until = Date.now() + 3e5; f.n = 0; }
    return J({ error: 'الرمز غير صحيح' });
  }
  if (['setCfg', 'users', 'setPin', 'setKeys', 'yt'].includes(a) && !admin) return J({ error: 'unauth' }, 401);
  if (a === 'setCfg') { await dbSet('cfg', body.cfg); return J({ ok: true }); }
  if (a === 'users') {
    const idx = (await dbGet('idx')) || [];
    const us = await Promise.all(idx.map((e) => dbGet('u:' + e)));
    return J({ users: us.filter(Boolean).map((u) => ({ name: u.name, email: u.email, phone: u.phone, levels: u.levels, last: u.last, created: u.created })).reverse() });
  }
  if (a === 'setPin') { if (String(body.pin || '').length < 4) return J({ error: 'قصير' }); st.pinHash = H(String(body.pin)); await dbSet('settings', st); return J({ ok: true }); }
  if (a === 'setKeys') { if (body.gemini) { st.gemini = body.gemini.trim(); st.quotaUntil = 0; } if (body.youtube) st.youtube = body.youtube.trim(); await dbSet('settings', st); return J({ ok: true }); }
  if (a === 'yt') {
    const key = st.youtube || process.env.YOUTUBE_API_KEY;
    if (!key) return J({ error: 'أضف مفتاح YouTube من تبويب الأمان' });
    const id = (String(body.list).match(/[?&]list=([\w-]+)/) || [, body.list])[1];
    const items = []; let pt = '';
    for (let i = 0; i < 4; i++) {
      const r = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${id}&key=${key}${pt}`)).json();
      if (r.error) return J({ error: r.error.message });
      items.push(...(r.items || []).map((x) => ({ id: x.snippet.resourceId.videoId, t: x.snippet.title })));
      if (!r.nextPageToken) break; pt = '&pageToken=' + r.nextPageToken;
    }
    return J({ items });
  }

  if (a === 'ai') {
    const now = Date.now(); hits[ip] = (hits[ip] || []).filter((t) => now - t < 6e4);
    if (hits[ip].length >= 15) return J({ error: 'rate' }, 429); hits[ip].push(now);
    if (!geminiKey) return J({ error: 'no-ai' });
    if ((st.quotaUntil || 0) > now) return J({ quota: true });
    const contents = [...(body.history || []).slice(-8).map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 2000) }] })), { role: 'user', parts: [{ text: String(body.prompt || '').slice(0, 4000) }] }];
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent?key=${geminiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: RULES }] }, contents }) });
    if (r.status === 429 || r.status === 403) { st.quotaUntil = now + 36e5; await dbSet('settings', st); return J({ quota: true }); }
    const d = await r.json().catch(() => ({}));
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    return J(text ? { text } : { error: 'empty' });
  }
  return J({ error: 'unknown' }, 400);
}
