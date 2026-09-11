/**
 * auth.js — تسجيل الدخول وإدارة المستخدمين عبر Firebase Auth (Email/Password) + Firestore.
 *
 * يحقق نفس منظومة تطبيق "الإداريات":
 *  - كل مستخدم له حساب Firebase Auth حقيقي (بريد/كلمة سر) + مستند في users/{uid}.
 *  - الأدوار: owner (مالك) / editor (محرر) / viewer (معاينة).
 *  - المالك يضيف/يعدّل/يحذف المستخدمين خلف تحقق "كود المالك" (owner-code).
 *  - أول حساب (بريد المالك الافتراضي) يكتسب الملكية عبر bootstrap/owner مرة واحدة.
 *
 * يُستدعى هذا الملف بعد تحميل firebase compat SDK.
 */

const MDRO_LOGOUT_FLAG = 'mdro_logout_flag';

window.MDROAuth = (function () {
  'use strict';

  let currentUser = null;          // {uid, email, name, role}
  const sessionCacheKey = 'mdro-auth-session';

  /* ---------- أدوات داخلية ---------- */
  async function fetchUser(uid) {
    try {
      const snap = await dbCompat.collection('users').doc(uid).get();
      return snap.exists ? snap.data() : null;
    } catch { return null; }
  }

  /** جلب مستند المستخدم مع إعادة محاولة للأخطاء العابرة (شبكة/Firestore)
   *  حتى لا يسقط دور مستخدم حقيقي إلى pending بسبب قراءة فاشلة لحظياً */
  async function fetchUserWithRetry(uid, tries) {
    const max = tries || 3;
    let d = null;
    for (let i = 0; i < max; i++) {
      d = await fetchUser(uid);
      if (d) return d;
      if (navigator.onLine === false) return null;
      await new Promise(r => setTimeout(r, 500));
    }
    return d;
  }

  async function loadBootstrapOwner() {
    try {
      const snap = await dbCompat.collection('bootstrap').doc('owner').get();
      return snap.exists ? snap.data() : null;
    } catch { return null; }
  }

  /** بعد أول دخول للمالك: أغلق باب الحصول على الملكية نهائياً */
  async function closeBootstrapIfNeeded() {
    try {
      const bs = await loadBootstrapOwner();
      if (bs && bs.ownerSet === false && currentUser && currentUser.role === 'owner') {
        await dbCompat.collection('bootstrap').doc('owner').set({
          ownerSet: true, by: currentUser.uid, at: new Date(),
        });
      }
    } catch {}
  }

  /** خزّن كود المالك الرقمي (SHA-256) مع ownerUid — يستدعى عند دخول المالك دائماً */
  async function ensureOwnerCode() {
    try {
      const ref = dbCompat.collection('bootstrap').doc('owner-code');
      const snap = await ref.get();
      const ownerUid = currentUser ? currentUser.uid : null;
      if (!snap.exists) {
        const codeHash = await sha256(MDRO_DEFAULT_OWNER_CODE);
        if (codeHash) await ref.set({ codeHash, ownerUid, updatedAt: new Date() });
        return codeHash;
      }
      const data = snap.data();
      if (ownerUid && (!data.ownerUid || data.ownerUid !== ownerUid)) {
        try { await ref.set({ ...data, ownerUid, updatedAt: new Date() }); } catch {}
      }
      return data.codeHash || null;
    } catch { return null; }
  }

  /* ---------- كاش الجلسة المحلي (العمل الأوفلاين) ---------- */
  function cacheSession(u) {
    try { localStorage.setItem(sessionCacheKey, JSON.stringify({ uid: u.uid, email: u.email, name: u.name, role: u.role, at: Date.now() })); } catch {}
    try { localStorage.setItem('mdro_last_user', JSON.stringify({ name: u.name || '', email: u.email || '', role: u.role || '' })); } catch {}
  }
  function cachedSession() {
    try { return JSON.parse(localStorage.getItem(sessionCacheKey) || 'null'); } catch { return null; }
  }

  /* ---------- SHA-256 (لرمز المالك) ---------- */
  async function sha256(str) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }
  async function ownerCodeHash() {
    try {
      const snap = await dbCompat.collection('bootstrap').doc('owner-code').get();
      return snap.exists ? snap.data().codeHash : null;
    } catch { return null; }
  }
  async function verifyOwnerCode(input) {
    const h = await sha256(String(input || '').trim());
    if (!h) return false;
    const stored = await ownerCodeHash();
    return !!stored && stored === h;
  }
  async function setOwnerCode(newCode) {
    if (!canManageUsers()) return { ok: false, msg: 'صلاحية المالك فقط.' };
    const h = await sha256(String(newCode || '').trim());
    if (!h) return { ok: false, msg: 'تعذّر تشفير الكود.' };
    try {
      await dbCompat.collection('bootstrap').doc('owner-code').set({ codeHash: h, updatedAt: new Date() });
      return { ok: true };
    } catch (e) { return { ok: false, msg: errorMsg(e) }; }
  }

  /* ---------- الدخول ---------- */
  async function login(email, password) {
    const em = (email || '').trim();
    if (!em || !password) return { ok: false, msg: 'أدخل البريد وكلمة السر.' };

    // دخول أوفلاين: يسمح لنفس آخر حساب سجّل على هذا الجهاز فقط
    if (navigator.onLine === false) {
      const cached = cachedSession();
      if (cached && cached.email === em) {
        currentUser = { uid: cached.uid, email: cached.email, name: cached.name, role: cached.role };
        _setLocalRole(currentUser.role);
        try { sessionStorage.removeItem(MDRO_LOGOUT_FLAG); } catch {}
        return { ok: true, offline: true };
      }
      return { ok: false, msg: 'أنت غير متصل — الدخول الأوفلاين متاح فقط لنفس آخر حساب مسجّل على هذا الجهاز.' };
    }

    try {
      let uid, displayEmail, d;
      try {
        const cred = await sessionAuth.signInWithEmailAndPassword(em, password);
        uid = cred.user.uid;
        displayEmail = cred.user.email || em;
        d = await fetchUser(uid);
      } catch (e) {
        // إن فشل الدخول عبر compat، نتأكد من ترجمة الخطأ
        return { ok: false, msg: errorMsg(e) };
      }

      if (!d) {
        await sessionAuth.signOut().catch(() => {});
        return { ok: false, msg: 'هذا الحساب غير مصرّح له بالدخول بعد — راجع مالك النظام.' };
      }

      // البريد الذي أدخل به المستخدم أصبح بريد العرض الفعلي
      try {
        const mref = dbCompat.collection('ic-login-map').doc(uid);
        const msnap = await mref.get();
        if (!msnap.exists) await mref.set({ email: displayEmail, authEmail: displayEmail });
        else if (msnap.data().email !== em) await mref.update({ email: em });
      } catch {}

      currentUser = { uid, email: em || displayEmail, name: d.name || em.split('@')[0], role: d.role || 'viewer' };
      cacheSession(currentUser);
      _setLocalRole(currentUser.role);
      try { sessionStorage.removeItem(MDRO_LOGOUT_FLAG); } catch {}

      if (currentUser.role === 'owner') {
        this._ownerPass = password;
        try { sessionStorage.setItem('mdro_owner_pass', password); } catch {}
        await ensureOwnerCode();
        await closeBootstrapIfNeeded();
      }
      return { ok: true };
    } catch (e) {
      // شبكة غير موثوقة: قُبلت المحلي لنفس آخر حساب إن تطابق
      const cached = cachedSession();
      if (cached && cached.email === em) {
        const c = (e && e.code) || '';
        if (c === 'auth/network-request-failed') {
          currentUser = { uid: cached.uid, email: cached.email, name: cached.name, role: cached.role };
          _setLocalRole(currentUser.role);
          try { sessionStorage.removeItem(MDRO_LOGOUT_FLAG); } catch {}
          return { ok: true, offline: true };
        }
      }
      return { ok: false, msg: errorMsg(e) };
    }
  }

  /* ---------- الخروج ---------- */
  async function logout() {
    try { await sessionAuth.signOut(); } catch {}
    currentUser = null;
    _setLocalRole('pending');
    _clearOwnerPass();
    try { sessionStorage.setItem(MDRO_LOGOUT_FLAG, '1'); } catch {}
    if (typeof MDRo_Sync_stop === 'function') { try { MDRo_Sync_stop(); } catch {} }
  }

  /* ---------- الحالة ---------- */
  function isLoggedIn() { return !!currentUser; }
  function get() { return currentUser || { uid: '', email: '', name: '', role: '' }; }
  function canEdit() { return !!currentUser && (currentUser.role === 'owner' || currentUser.role === 'editor'); }
  function canPrint() { return canEdit(); }
  function canManageUsers() { return !!currentUser && currentUser.role === 'owner'; }

  /* ---------- إدارة المستخدمين (المالك فقط) ---------- */
  async function createUser({ name, email, password, role, ownerCode }) {
    if (!canManageUsers()) return { ok: false, msg: 'صلاحية إدارة المستخدمين للمالك فقط.' };
    const codeOk = await verifyOwnerCode(ownerCode);
    if (!codeOk) return { ok: false, msg: 'كود المالك غير صحيح.' };

    const adminUid = currentUser.uid;
    let factoryApp = null;
    let newUid = null;
    const factoryName = 'mdro-user-factory-' + Date.now();
    try {
      factoryApp = firebase.initializeApp(firebaseConfig, factoryName);
      const factoryAuth = factoryApp.auth();
      const factoryDb = factoryApp.firestore();
      const cred = await factoryAuth.createUserWithEmailAndPassword(email.trim(), password);
      newUid = cred.user.uid;

      await factoryDb.collection('users').doc(newUid).set({
        name: name.trim(),
        email: email.trim(),
        authEmail: email.trim(),
        role: (role === 'owner' ? 'editor' : role) || 'viewer',
        createdBy: adminUid,
        createdAt: new Date(),
      });
      try { await factoryAuth.signOut(); } catch {}
    } catch (e) {
      return { ok: false, msg: errorMsg(e) + ((e && e.code) ? ' (' + e.code + ')' : '') };
    } finally {
      if (factoryApp) { try { firebase.app(factoryName).delete(); } catch {} }
    }

    if (newUid) {
      try {
        await dbCompat.collection('ic-login-map').doc(newUid).set({ email: email.trim(), authEmail: email.trim() });
      } catch {}
    }
    return { ok: true, msg: 'تمت إضافة المستخدم ✓' };
  }

  async function setRole(uid, role, ownerCode) {
    if (!canManageUsers()) return { ok: false, msg: 'صلاحية إدارة المستخدمين للمالك فقط.' };
    const codeOk = await verifyOwnerCode(ownerCode);
    if (!codeOk) return { ok: false, msg: 'كود المالك غير صحيح.' };
    try {
      await dbCompat.collection('users').doc(uid).update({ role });
      return { ok: true };
    } catch (e) { return { ok: false, msg: errorMsg(e) }; }
  }

  async function listUsers() {
    try {
      const snap = await dbCompat.collection('users').orderBy('createdAt', 'asc').get();
      return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch { return []; }
  }

  async function deleteUser(uid, ownerCode) {
    if (!canManageUsers()) return { ok: false, msg: 'صلاحية إدارة المستخدمين للمالك فقط.' };
    const codeOk = await verifyOwnerCode(ownerCode);
    if (!codeOk) return { ok: false, msg: 'كود المالك غير صحيح.' };
    try {
      if (currentUser && uid === currentUser.uid) return { ok: false, msg: 'لا يمكنك حذف حسابك الحالي.' };
      try { await dbCompat.collection('ic-login-map').doc(uid).delete(); } catch {}
      await dbCompat.collection('users').doc(uid).delete();
      return { ok: true };
    } catch (e) { return { ok: false, msg: errorMsg(e) }; }
  }

  async function updateUserData(uid, { name, email, role, newPassword, currentPassword }, ownerCode) {
    if (!canManageUsers()) return { ok: false, msg: 'صلاحية إدارة المستخدمين للمالك فقط.' };
    if (currentUser && uid === currentUser.uid) return { ok: false, msg: 'عدّل حساب المالك من قسمه أعلى الصفحة.' };
    const codeOk = await verifyOwnerCode(ownerCode);
    if (!codeOk) return { ok: false, msg: 'كود المالك غير صحيح.' };

    let current = null;
    try { current = (await dbCompat.collection('users').doc(uid).get()).data(); } catch {}
    const newEmail = email !== undefined && email !== null ? String(email).trim() : '';
    const emailChanged = !!newEmail && !!current && current.email !== newEmail;

    const update = {};
    if (name !== undefined && name !== null && String(name).trim()) update.name = String(name).trim();
    if (emailChanged) update.email = newEmail;
    if (role) {
      if (role === 'owner') return { ok: false, msg: 'لا يمكن رفع مستخدم لدور المالك.' };
      update.role = role;
    }
    if (!Object.keys(update).length && !newPassword) return { ok: false, msg: 'لا توجد تغييرات.' };

    if (emailChanged) {
      try {
        const mref = dbCompat.collection('ic-login-map').doc(uid);
        const msnap = await mref.get();
        if (msnap.exists) await mref.update({ email: newEmail });
      } catch {}
    }

    if (newPassword) {
      if (String(newPassword).length < 6) return { ok: false, msg: 'كلمة السر الجديدة على الأقل 6 أحرف.' };
      if (!currentPassword || !String(currentPassword).trim()) return { ok: false, msg: 'أدخل كلمة سر المستخدم الحالية لتغييرها.' };
      const authEmail = (current && current.authEmail) || currentEmailFor(uid);
      if (!authEmail) return { ok: false, msg: 'تعذّر تحديد بريد الدخول لهذا المستخدم.' };
      let factoryApp = null;
      const factoryName = 'mdro-user-factory-' + Date.now();
      try {
        factoryApp = firebase.initializeApp(firebaseConfig, factoryName);
        const fa = factoryApp.auth();
        const cred = await fa.signInWithEmailAndPassword(authEmail, String(currentPassword));
        await cred.user.updatePassword(String(newPassword));
        try { await fa.signOut(); } catch {}
      } catch (e) {
        return { ok: false, msg: 'فشل تغيير كلمة السر: كلمة السر الحالية غير صحيحة.' };
      } finally {
        if (factoryApp) { try { firebase.app(factoryName).delete(); } catch {} }
      }
    }

    try {
      if (Object.keys(update).length) await dbCompat.collection('users').doc(uid).update(update);
      return { ok: true, msg: 'تم تحديث بيانات المستخدم ✓' };
    } catch (e) { return { ok: false, msg: errorMsg(e) }; }
  }

  async function currentEmailFor(uid) {
    try {
      const m = await dbCompat.collection('ic-login-map').doc(uid).get();
      if (m.exists && m.data().authEmail) return m.data().authEmail;
    } catch {}
    try {
      const u = await dbCompat.collection('users').doc(uid).get();
      const d = u.data();
      return (d && (d.authEmail || d.email)) || null;
    } catch { return null; }
  }

  /* ---------- تعديل حساب المالك نفسه ---------- */
  async function updateOwnerAccount({ name, email, newPassword, currentPassword }, ownerCode) {
    if (!canManageUsers()) return { ok: false, msg: 'صلاحية المالك فقط.' };
    if (!currentUser || !currentUser.uid) return { ok: false, msg: 'لم يتم التعرف على الحساب.' };
    if (String(currentUser.uid).indexOf('owner-code-') === 0) {
      return { ok: false, msg: 'دخلت بكود المالك (جلسة محلية) — سجّل بحسابك الحقيقي لتعديل بياناتك.' };
    }
    const codeOk = await verifyOwnerCode(ownerCode);
    if (!codeOk) return { ok: false, msg: 'كود المالك غير صحيح.' };

    const uid = currentUser.uid;
    let current = null;
    try { current = (await dbCompat.collection('users').doc(uid).get()).data(); } catch {}
    const newEmail = (email !== undefined && email !== null) ? String(email).trim() : '';
    const emailChanged = !!newEmail && !!current && current.email !== newEmail && current.email !== currentUser.email;
    const authEmail = (current && (current.authEmail || current.email)) || currentUser.email;

    // تغيير البريد/كلمة السر على Firebase Auth عبر factory (بكلمة سر الحالية)
    if (emailChanged || newPassword) {
      if (!currentPassword || !String(currentPassword).trim()) {
        return { ok: false, msg: 'أدخل كلمة مرور المالك الحالية لتغيير البريد أو كلمة السر.' };
      }
      if (newPassword && String(newPassword).length < 6) return { ok: false, msg: 'كلمة السر الجديدة على الأقل 6 أحرف.' };
      let factoryApp = null;
      const factoryName = 'mdro-owner-factory-' + Date.now();
      try {
        factoryApp = firebase.initializeApp(firebaseConfig, factoryName);
        const fa = factoryApp.auth();
        const cred = await fa.signInWithEmailAndPassword(authEmail, String(currentPassword));
        if (newPassword) await cred.user.updatePassword(String(newPassword));
        if (emailChanged) await cred.user.updateEmail(newEmail);
        try { await fa.signOut(); } catch {}
      } catch (e) {
        return { ok: false, msg: 'فشل التعديل: كلمة السر الحالية غير صحيحة أو البريد مستخدم من قبل.' };
      } finally {
        if (factoryApp) { try { firebase.app(factoryName).delete(); } catch {} }
      }
    }

    const update = {};
    if (name !== undefined && name !== null && String(name).trim()) update.name = String(name).trim();
    if (emailChanged) { update.email = newEmail; update.authEmail = newEmail; }
    if (Object.keys(update).length) {
      try {
        await dbCompat.collection('users').doc(uid).update(update);
        await dbCompat.collection('ic-login-map').doc(uid).set({ email: emailChanged ? newEmail : currentUser.email, authEmail: emailChanged ? newEmail : authEmail });
      } catch (e) { return { ok: false, msg: errorMsg(e) }; }
    }
    // تحديث الكاش المحلي إن تغيّر الاسم/البريد
    if (currentUser) {
      const prev = { uid: currentUser.uid, email: emailChanged ? newEmail : currentUser.email, name: update.name || currentUser.name, role: currentUser.role };
      currentUser = prev;
      cacheSession(prev);
      if (emailChanged) { try { sessionStorage.setItem('mdro_display_email', newEmail); } catch {} }
    }
    // حافظ على جهة اتصال المالك محدّثة بعد أي تعديل على بياناته
    try {
      localStorage.setItem('mdro_owner_contact', JSON.stringify({ name: currentUser.name, email: currentUser.email, phone: '' }));
    } catch {}
    return { ok: true, msg: 'تم تحديث حسابك ✓' };
  }

  /* ---------- ترجمة خطأ Firebase ---------- */
  function errorMsg(e) {
    const c = (e && e.code) || '';
    const map = {
      'auth/user-not-found': 'لا يوجد حساب بهذا البريد.',
      'auth/wrong-password': 'كلمة السر غير صحيحة.',
      'auth/invalid-email': 'صيغة البريد غير صحيحة.',
      'auth/email-already-in-use': 'هذا البريد مستخدم من قبل.',
      'auth/weak-password': 'كلمة السر ضعيفة — على الأقل 6 أحرف.',
      'auth/requires-recent-login': 'الجلسة قديمة — يُرجى الدخول من جديد ثم أعد المحاولة.',
      'auth/too-many-requests': 'محاولات كثيرة — انتظر قليلاً وأعد المحاولة.',
      'auth/network-request-failed': 'مشكلة في الاتصال — تأكد من الإنترنت.',
      'permission-denied': 'لا تملك صلاحية تنفيذ هذه العملية.',
    };
    return map[c] || (e.message ? String(e.message).replace(/^Error:\s*/i, '') : 'حدث خطأ غير متوقع.');
  }

  /* ---------- ربط بالحالة المحلية للنواة الحالية ---------- */
  function _setLocalRole(role) {
    window._currentRole = role || 'pending';
    try { localStorage.setItem('mdro_device_role', role || 'pending'); } catch {}
  }
  function _clearOwnerPass() {
    this._ownerPass = null;
    try { sessionStorage.removeItem('mdro_owner_pass'); } catch {}
  }

  /* ---------- جلسة محلية (دخول كود المالك بدون حساب Firebase) ---------- */
  /** يربط جلسة owner محلية ليفتح "إدارة المستخدمين" كاملة دون إعادة تسجيل دخول. */
  function setLocalSession(account) {
    currentUser = {
      uid: (account && account.uid) || 'owner-code-local',
      email: (account && account.email) || '',
      name: (account && account.name) || '',
      role: (account && account.role) || 'owner',
    };
    cacheSession(currentUser);
    _setLocalRole(currentUser.role);
    return currentUser;
  }

  /** مصدر الحقيقة لاسم/بريد المالك: bootstrap/owner → users/{uid} من Firestore،
   *  مع تدرّج احتياطي (آخر حساب مالك معروف، ثم جهة الاتصال المحفوظة).
   *  يخزّن النتيجة دائماً في mdro_owner_contact لتعتمد عليها كل طبقات العرض. */
  async function getOwnerIdentFromBootstrap() {
    let name = '', email = '';
    try {
      const bs = await loadBootstrapOwner();
      const by = (bs && bs.by) ? bs.by : null;
      if (by) {
        const d = await fetchUserWithRetry(by);
        if (d) { name = d.name || ''; email = d.email || d.authEmail || ''; }
      }
    } catch {}
    if (!name || !email) {
      try {
        const lu = JSON.parse(localStorage.getItem('mdro_last_user') || 'null');
        if (lu && lu.role === 'owner') { if (!name) name = lu.name || ''; if (!email) email = lu.email || ''; }
      } catch {}
    }
    if (!name || !email) {
      try {
        const oc = JSON.parse(localStorage.getItem('mdro_owner_contact') || 'null');
        if (oc) { if (!name) name = oc.name || ''; if (!email) email = oc.email || ''; }
      } catch {}
    }
    if (name || email) {
      try { localStorage.setItem('mdro_owner_contact', JSON.stringify({ name: name, email: email, phone: '', at: Date.now() })); } catch {}
    }
    return { name, email };
  }

  let _ownerHydratePromise = null;
  /** شفاء ذاتي لهوية المالك: لو الجلسة الحية فاضية الاسم/البريد — نحضّرها من
   *  Firestore ونعيد رسم الواجهة حتى لا يفرغ سطر السايد بار أو قالب الحساب،
   *  حتى مع كاش محلي "مسموم" من جلسات قديمة. */
  async function ensureOwnerIdent() {
    if (!(window._currentRole === 'owner')) return currentUser || null;
    const cur = currentUser;
    if (cur && cur.name && cur.email) return cur;
    if (!_ownerHydratePromise) {
      _ownerHydratePromise = (async () => {
        try {
          const hid = await getOwnerIdentFromBootstrap();
          let changed = false;
          if (currentUser) {
            const nm = hid.name || currentUser.name || '';
            const em = hid.email || currentUser.email || '';
            if (nm !== currentUser.name || em !== currentUser.email) {
              currentUser = { uid: currentUser.uid, email: em, name: nm, role: currentUser.role };
              cacheSession(currentUser);
              changed = true;
            }
          } else if (hid.name || hid.email) {
            currentUser = { uid: 'owner-code-local', name: hid.name || '', email: hid.email || '', role: 'owner' };
            cacheSession(currentUser);
            changed = true;
          }
          if (changed) {
            try {
              if (typeof window.applyRoleUI === 'function') window.applyRoleUI();
              else if (typeof window.renderDrawerUser === 'function') window.renderDrawerUser();
            } catch {}
          }
        } finally {
          _ownerHydratePromise = null;
        }
      })();
    }
    return _ownerHydratePromise;
  }

  /** نسخة من جلسة كود المالك مبنية على اسم/بريد المالك الحقيقي من Firestore
   *  حتى لا يظهر سطر الحساب أو قالب بيانات المالك فارغاً عند الدخول بكود المالك. */
  async function setLocalOwnerSessionFromBootstrap() {
    const hid = await getOwnerIdentFromBootstrap();
    return setLocalSession({ uid: 'owner-code-local', name: hid.name || '', email: hid.email || '', role: 'owner' });
  }

  /* ---------- استرجاع جلسة سابقة / onAuthStateChanged ---------- */
  function initSessionListener(callback) {
    if (typeof sessionAuth === 'undefined') return;
    try {
      sessionAuth.onAuthStateChanged((user) => {
        if (user) {
          let disp = user.email || '';
          try { disp = sessionStorage.getItem('mdro_display_email') || disp; } catch {}
          fetchUserWithRetry(user.uid).then(d => {
            const cached = cachedSession();
            // لا نلمح بالـ viewer افتراضياً عند فشل جلب المستند — نتحسس أدق مصدر محفوظ
            let role = (d && d.role) || (cached && cached.uid === user.uid ? (cached.role || '') : '');
            if (!role) {
              try {
                const lr = localStorage.getItem('mdro_device_role');
                if (lr === 'owner' || lr === 'editor' || lr === 'viewer') role = lr;
              } catch {}
            }
            if (!role) role = 'pending';
            const name = (d && d.name) || (cached && cached.uid === user.uid && cached.name) || disp.split('@')[0];
            currentUser = { uid: user.uid, email: disp, name, role };
            cacheSession(currentUser);
            _setLocalRole(role);
            if (typeof callback === 'function') callback(true, { user: true });
            if (role === 'owner') {
              ensureOwnerCode();
              closeBootstrapIfNeeded();
            }
            // شفاء ذاتي: لو مستند المستخدم فشل جلبه لحظياً (شبكة) فبقي الاسم/البريد
            // فارغين — نملأهما من مصدر المالك الحقيقي فوراً.
            if (role === 'owner' && (!name || !email)) ensureOwnerIdent();
          });
        } else {
          const cached = cachedSession();
          let pendingLogout = false;
          try { pendingLogout = !!sessionStorage.getItem(MDRO_LOGOUT_FLAG); } catch {}
          // أبقِ آخر جلسة صالحة محفوظة إلا عند خروج صريح، أو جلسة أقدم من 7 أيام
          // مع اتصال فعلي — حتى لا تحوّل لحظة شبكة عابرة/تحديث توكن إلى "قيد الانتظار"
          // وتمسح بيانات الحساب من القالب.
          const cacheFresh = cached && cached.at && (Date.now() - cached.at) < 7 * 24 * 3600 * 1000;
          if (cached && cached.role && !pendingLogout && (navigator.onLine === false || cacheFresh)) {
            currentUser = { uid: cached.uid, email: cached.email, name: cached.name, role: cached.role };
            _setLocalRole(currentUser.role);
            if (typeof callback === 'function') callback(true, { offline: true });
            // شفاء ذاتي: استعادة جلسة قديمة بلا اسم/بريد (كاش مسموم من جلسات
            // كود المالك الأولى) — نحضّر من Firestore ونعيد الرسم.
            if (currentUser.role === 'owner' && (!currentUser.name || !currentUser.email)) ensureOwnerIdent();
          } else {
            currentUser = null;
            _setLocalRole('pending');
            if (typeof callback === 'function') callback(false, {});
          }
        }
      });
    } catch {}
  }

  return {
    currentUser, login, logout, isLoggedIn, get, canEdit, canPrint, canManageUsers,
    listUsers, createUser, setRole, deleteUser, updateUserData, updateOwnerAccount,
    verifyOwnerCode, setOwnerCode, ensureOwnerCode, fetchUser, closeBootstrapIfNeeded,
    setLocalSession, setLocalOwnerSessionFromBootstrap, getOwnerIdentFromBootstrap, ensureOwnerIdent,
    initSessionListener, errorMsg, cachedSession, cacheSession,
  };
})();

/* ---------- تصدير دوال متوافقة مع النواة الحالية ---------- */
async function MDRO_DoLogin(email, password) {
  const res = await window.MDROAuth.login(email, password);
  return res;
}

function MDRO_DoLogout() {
  window.MDROAuth.logout();
  try {
    localStorage.removeItem('mdro_session');
    localStorage.removeItem('mdro_session_active');
    localStorage.removeItem('mdro_last_tab');
  } catch {}
  const screen = document.getElementById('loginScreen');
  if (screen) {
    screen.style.display = 'flex';
    requestAnimationFrame(() => screen.classList.remove('hidden'));
  }
}
