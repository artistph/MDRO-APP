# MDRO-APP — نظام ترصد الميكروبات المقاومة (MDRO)

نظام ترصد الميكروبات المقاومة للعلاج في **مستشفى المطرية التعليمي** — PWA عربي RTL.

## 🚀 التشغيل المحلي

افتح `index.html` مباشرة في المتصفح، أو شغّل HTTP server محلياً:

```bash
python -m http.server 8080
# أو
npx serve .
```

## 🔐 نظام الدخول (Firebase Auth — بريد/كلمة سر)

- كل مستخدم له حساب Firebase Auth حقيقي + مستند في `users/{uid}`.
- الأدوار: **owner** (مالك) / **editor** (محرر) / **viewer** (معاينة).
- المالك يدير المستخدمين من الإعدادات ← **إدارة المستخدمين** (إضافة/تعديل/حذف) خلف تحقق **كود المالك** (6 أرقام، SHA-256 في `bootstrap/owner-code`).
- أول حساب يغلق `bootstrap/owner` (ownerSet) مرة واحدة.

## ⚙️ إعداد أول مالك

1. **Firebase Console** ← مشروع `mdro-379fd`:
   - **Authentication ← Sign-in method ← Email/Password**: فعّل.
   - أنشئ حساب المالك الأول (بريد/كلمة سر) من **Users ← Add user**.
2. **Firestore** — بعد نشر `firestore.rules`:
   - أنشئ مستند `bootstrap/owner` بقيمة `ownerSet: false`.
   - (اختياري) أنشئ `bootstrap/owner-code` بالهاش `8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92` = كود `123456` مع `ownerUid`.
3. أول دخول بحساب المالك يغلق `bootstrap/owner` وينشئ/يحدّث `owner-code`.

## 📦 النشر

يُستضاف الملف الساكن على **GitHub Pages** (الجذر). وتُدار قواعد Firestore والاستضافة عبر:

```bash
firebase login
firebase deploy --only firestore:rules   # القواعد
firebase deploy --only hosting           # الاستضافة
```

أو عبر GitHub Actions من `.github/workflows/deploy.yml` (يستخدم `FIREBASE_TOKEN` في Secrets).

## 📁 البنية

```
index.html            التطبيق الأساسي
js/auth.js            الدخول وإدارة المستخدمين (MDROAuth)
js/user-manager.js    واجهة إدارة المستخدمين
sw.js                 Service Worker (PWA + notifications)
manifest.json         PWA manifest
firestore.rules       قواعد Firestore
firebase.json         إعداد firebase deploy / hosting
.github/workflows/    أتمتة النشر
```

## 🗄️ مجموعات Firestore

| المجموعة | الاستخدام |
|---|---|
| `mdro_data/{key}` | بيانات التطبيق (المزامنة) |
| `devices/{deviceId}` | تسجيل الأجهزة القديمة |
| `mdro_config/secrets` | أسرار قديمة (read-only) |
| `ldmCultures/{doc}` | ثقافات LDM |
| `users/{uid}` | حسابات وأدوار المستخدمين |
| `bootstrap/owner` | إغلاق أول مالك (مرة واحدة) |
| `bootstrap/owner-code` | كود المالك (SHA-256) |
| `ic-login-map/{uid}` | خريطة بريد الدخول ↔ UID |