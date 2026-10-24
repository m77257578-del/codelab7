# CodeLab | كود لاب

## هيكل المشروع (4 ملفات داخل app + ملفات الجذر)
app/page.js            ← المنصة كلها
app/layout.js
app/globals.css
app/api/db/route.js    ← قاعدة البيانات والخادم (ملف route.js)
package.json, next.config.js, tailwind.config.js, postcss.config.js

## التشغيل محلياً
npm install
npm run dev     (قاعدة البيانات ملف data.json يُنشأ تلقائياً)

## النشر على Vercel
1. ارفع المشروع إلى GitHub ثم Import في Vercel.
2. Storage > Create > Upstash Redis (مجاني) واربطه بالمشروع (يضيف KV_REST_API_URL و KV_REST_API_TOKEN تلقائياً).
   بدونه تُحفظ البيانات في /tmp وتضيع عند إعادة تشغيل الخادم.
3. أضف AUTH_SECRET (نص عشوائي طويل). باقي المتغيرات اختيارية (انظر env.example.txt).
4. Deploy.

## لوحة الأدمن
افتح  موقعك/#admin  أو اضغط الشعار 7 مرات. الرمز المبدئي 100100 (غيّره فوراً).
من تبويب الأمان: ضع مفتاح Gemini ومفتاح YouTube، وغيّر الرمز.

## ملفات اختيارية (تثبيت المنصة كتطبيق)
public/manifest.webmanifest, public/sw.js, public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
احذف مجلد app/admin إن كان عندك من النسخة السابقة.
