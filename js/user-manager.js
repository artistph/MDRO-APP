/**
 * user-manager.js — إدارة المستخدمين والأدوار (للمالك فقط).
 *
 * نفس منطق تطبيق "الإداريات":
 *  - "الحساب الخاص بي": بطاقة مميزة لبيانات المالك بجوارها أزرار تعديل.
 *  - زر "إدارة المستخدمين" يفتح شبكة كروت لكل مستخدم مضاف.
 *  - "إضافة مستخدم" — نموذج ينتهي بإدخال كود المالك للتأكيد.
 *  - كارت كل مستخدم: بروفايل فيه تعديل/حذف خلف تحقق كود المالك.
 */

const MDRO_ROLE_AR = { owner: 'مالك', editor: 'محرر', viewer: 'معاينة' };
const MDRO_ROLE_COLOR = { owner: '#C9A227', editor: '#1B7A78', viewer: '#64748B' };

function mdroRoleBadge(role) {
  return '<span style="background:' + (MDRO_ROLE_COLOR[role] || '#64748B') + ';color:#fff;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700">' + (MDRO_ROLE_AR[role] || role) + '</span>';
}
function mdroOwnerCodeField(id, placeholder) {
  return '<div class="settings-field"><label>كود المالك (للتأكيد)</label>' +
    '<input type="password" id="' + id + '" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="' + (placeholder || 'كود المالك — 6 أرقام') + '" /></div>';
}

/** عرض إدارة المستخدمين داخل صفحة الإعدادات (للمالك فقط) */
async function renderMDROUserManager() {
  const wrap = document.getElementById('mdroUserManagerWrap');
  if (!wrap) return;
  if (!window.MDROAuth || !window.MDROAuth.canManageUsers()) { wrap.innerHTML = ''; return; }

  const acc = window.MDROAuth.get();
  let dispName = acc.name || '';
  let dispEmail = acc.email || '';
  // ضمان: لو الجلسة فاضية الاسم/البريد (دخول كود مالك من جلسة قديمة) —
  // نرجع لآخر حساب مالك معروف حتى لا يفرغ قالب حساب المالك.
  if (!dispName || !dispEmail) {
    try {
      const lu = JSON.parse(localStorage.getItem('mdro_last_user') || 'null');
      if (lu && lu.role === 'owner') {
        if (!dispName) dispName = lu.name || '';
        if (!dispEmail) dispEmail = lu.email || '';
      }
    } catch {}
  }
  // شفاء ذاتي: لو ما زال فارغاً — نأخذ اسم/بريد المالك الحقيقي من Firestore
  // مباشرة حتى لا يظهر قالب بيانات المالك فارغاً (الكاش المحلي قد يكون قديماً).
  if (!dispName || !dispEmail) {
    try {
      const hid = await window.MDROAuth.getOwnerIdentFromBootstrap();
      if (hid) {
        if (!dispName) dispName = hid.name || '';
        if (!dispEmail) dispEmail = hid.email || '';
      }
    } catch {}
  }
  // حدّث الجلسة نفسها ليتعافى سطر السايد بار أيضاً.
  try { window.MDROAuth.ensureOwnerIdent(); } catch {}
  wrap.innerHTML =
    '<h3>الحساب الخاص بي <span style="font-size:11px;color:#C9A227;font-weight:700">(👑 المالك)</span></h3>' +
    '<div class="owner-profile">' +
      '<div class="owner-row"><span class="or-label">الاسم</span><span class="or-value" id="mdroOpName">' + escMDRO(dispName) + '</span><button class="btn btn-ghost btn-sm" data-medit="name">تعديل</button></div>' +
      '<div class="owner-row stack"><span class="or-label">البريد</span><span class="or-value" id="mdroOpEmail">' + escMDRO(dispEmail) + '</span><button class="btn btn-ghost btn-sm" data-medit="email">تعديل</button></div>' +
      '<div class="owner-row"><span class="or-label">كلمة السر</span><span class="or-value muted">••••••••</span><button class="btn btn-ghost btn-sm" data-medit="pass">تعديل</button></div>' +
      '<div class="owner-row"><span class="or-label">الدور</span><span class="or-value">' + mdroRoleBadge('owner') + '</span><span></span></div>' +
      '<div class="owner-edit-box" id="mdroOwnerEditBox" style="display:none"></div>' +
      '<div class="settings-msg" id="mdroOwnerMsg"></div>' +
    '</div>' +
    '<div style="margin:16px 0 6px;display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-primary" id="mdroManageUsersBtn">👥 إدارة المستخدمين</button>' +
    '</div>' +
    '<div id="mdroUsersArea" style="display:none"></div>';

  wrap.querySelectorAll('[data-medit]').forEach(btn => {
    btn.addEventListener('click', () => openMDROOwnerEdit(btn.dataset.medit));
  });

  document.getElementById('mdroManageUsersBtn').addEventListener('click', async () => {
    const area = document.getElementById('mdroUsersArea');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
    if (area.style.display !== 'none') await drawMDROUsersView();
  });
}

function openMDROOwnerEdit(field) {
  const box = document.getElementById('mdroOwnerEditBox');
  const msg = document.getElementById('mdroOwnerMsg');
  const labels = { name: 'الاسم', email: 'البريد', pass: 'كلمة السر الجديدة' };
  if (msg) { msg.className = 'settings-msg'; msg.textContent = ''; }
  box.style.display = 'block';
  const fieldLabel = labels[field] || field;
  const needCurPass = field === 'email' || field === 'pass';
  box.innerHTML =
    '<div class="settings-field"><label>' + fieldLabel + '</label>' +
    '<input type="' + (field === 'pass' ? 'password' : (field === 'email' ? 'email' : 'text')) + '" id="mdroOwnerEditVal" ' + (field === 'pass' ? 'placeholder="كلمة السر الجديدة (6 أحرف على الأقل)"' : '') + ' /></div>' +
    (needCurPass
      ? '<div class="settings-field"><label>كلمة المرور الحالية</label>' +
        '<input type="password" id="mdroOwnerCurPass" autocomplete="current-password" placeholder="للتأكيد عند تغيير البريد أو كلمة السر" /></div>'
      : '') +
    mdroOwnerCodeField('mdroOwnerEditCode') +
    '<div style="display:flex;gap:8px;margin-top:8px">' +
      '<button class="btn btn-primary" id="mdroOwnerEditSave">حفظ</button>' +
      '<button class="btn btn-ghost" id="mdroOwnerEditCancel">إلغاء</button>' +
    '</div>';
  document.getElementById('mdroOwnerEditSave').addEventListener('click', async () => {
    const code = document.getElementById('mdroOwnerEditCode').value;
    const val = document.getElementById('mdroOwnerEditVal').value;
    const curPass = needCurPass ? (document.getElementById('mdroOwnerCurPass').value || '') : '';
    if (!code) { msg.className = 'settings-msg err'; msg.textContent = 'أدخل كود المالك للتأكيد.'; return; }
    if (field === 'pass' && val.length < 6) { msg.className = 'settings-msg err'; msg.textContent = 'كلمة السر على الأقل 6 أحرف.'; return; }
    const payload = { currentPassword: curPass };
    if (field === 'name') payload.name = val;
    if (field === 'email') payload.email = val;
    if (field === 'pass') payload.newPassword = val;
    msg.className = 'settings-msg'; msg.textContent = '...جارٍ الحفظ';
    const res = await window.MDROAuth.updateOwnerAccount(payload, code)
      .catch(() => ({ ok: false, msg: 'تعذّر التعديل — جرّب من جديد.' }));
    msg.className = 'settings-msg ' + (res.ok ? 'ok' : 'err');
    msg.textContent = res.msg;
    if (res.ok) {
      box.style.display = 'none';
      try { renderMDROUserManager(); } catch {}
    }
  });
  document.getElementById('mdroOwnerEditCancel').addEventListener('click', () => { box.style.display = 'none'; });
}

async function drawMDROUsersView() {
  const area = document.getElementById('mdroUsersArea');
  if (!area) return;
  area.innerHTML =
    '<div class="users-toolbar"><b>المستخدمون المضافون</b>' +
    '<button class="btn btn-primary" id="mdroUsersAddNewBtn">➕ إضافة مستخدم</button></div>' +
    '<div id="mdroUsersGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin:12px 0"></div>' +
    '<div id="mdroAddUserForm" style="display:none"></div>';

  const users = await window.MDROAuth.listUsers();
  const me = (window.MDROAuth.get() || {}).uid;
  const others = users.filter(u => u.uid !== me);
  const grid = document.getElementById('mdroUsersGrid');
  grid.innerHTML = others.map(u =>
    '<div class="user-card" data-uid="' + escMDRO(u.uid) + '" role="button" tabindex="0" title="اضغط لفتح البروفايل">' +
      '<div class="uc-top"><span class="uc-avatar">' + escMDRO((u.name || u.email || '?')[0]) + '</span>' + mdroRoleBadge(u.role) + '</div>' +
      '<div class="uc-name">' + escMDRO(u.name || u.email) + '</div>' +
      '<div class="uc-email">' + escMDRO(u.email) + '</div>' +
    '</div>').join('') || '<p style="color:#6b7f96;font-size:13px">لا يوجد مستخدمون مضافون بعد.</p>';

  grid.querySelectorAll('.user-card').forEach(card => {
    const uid = card.dataset.uid;
    const open = () => openMDROUserProfile(uid);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });

  document.getElementById('mdroUsersAddNewBtn').addEventListener('click', () => {
    const f = document.getElementById('mdroAddUserForm');
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
    if (f.style.display !== 'none') renderMDROAddUserForm();
  });
}

function renderMDROAddUserForm() {
  const f = document.getElementById('mdroAddUserForm');
  f.innerHTML =
    '<div class="settings-panel" style="margin:0">' +
      '<h3>إضافة مستخدم</h3>' +
      '<div style="display:grid;gap:8px">' +
        '<div class="settings-field"><label>الاسم</label><input type="text" id="mdroAuName" /></div>' +
        '<div class="settings-field"><label>البريد</label><input type="email" id="mdroAuEmail" /></div>' +
        '<div class="settings-field"><label>كلمة السر</label><input type="password" id="mdroAuPass" placeholder="على الأقل 6 أحرف" /></div>' +
        '<div class="settings-field"><label>الدور</label>' +
          '<select id="mdroAuRole"><option value="editor">محرر</option><option value="viewer">معاينة</option><option value="owner">مالك</option></select></div>' +
        '<div class="settings-field"><label>كود المالك (لتأكيد الإضافة)</label>' +
          '<input type="password" id="mdroAuCode" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 أرقام" /></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px">' +
        '<button class="btn btn-primary" id="mdroAuSave">إضافة</button>' +
        '<button class="btn btn-ghost" id="mdroAuCancel">إلغاء</button>' +
      '</div>' +
      '<div class="settings-msg" id="mdroAuMsg"></div>' +
    '</div>';

  document.getElementById('mdroAuSave').addEventListener('click', async () => {
    const msg = document.getElementById('mdroAuMsg');
    const ownerCode = document.getElementById('mdroAuCode').value;
    if (!ownerCode) { msg.className = 'settings-msg err'; msg.textContent = 'أدخل كود المالك للتأكيد.'; return; }
    msg.className = 'settings-msg'; msg.textContent = '...جارٍ الإضافة';
    const res = await window.MDROAuth.createUser({
      name: document.getElementById('mdroAuName').value,
      email: document.getElementById('mdroAuEmail').value,
      password: document.getElementById('mdroAuPass').value,
      role: document.getElementById('mdroAuRole').value,
      ownerCode,
    });
    msg.className = 'settings-msg ' + (res.ok ? 'ok' : 'err');
    msg.textContent = res.msg;
    if (res.ok) { f.style.display = 'none'; await drawMDROUsersView(); }
  });
  document.getElementById('mdroAuCancel').addEventListener('click', () => { f.style.display = 'none'; });
}

function openMDROUserProfile(uid) {
  window.MDROAuth.listUsers().then(users => {
    const u = users.find(x => x.uid === uid);
    if (!u) return;
    const d = document.createElement('div');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    d.className = 'user-profile-modal';
    d.innerHTML =
      '<div class="settings-panel" style="margin:0;width:100%;max-width:360px">' +
        '<h3>بروفايل المستخدم</h3>' +
        '<div class="uc-top" style="justify-content:center;margin-bottom:10px"><span class="uc-avatar" style="font-size:26px;width:64px;height:64px">' + escMDRO((u.name || u.email || '?')[0]) + '</span></div>' +
        '<div class="settings-field"><label>الاسم</label><input type="text" id="mdroProfName" value="' + escMDRO(u.name || '') + '" /></div>' +
        '<div class="settings-field"><label>البريد</label><input type="email" id="mdroProfEmail" value="' + escMDRO(u.email || '') + '" /></div>' +
        '<div class="settings-field"><label>الدور</label>' +
          '<select id="mdroProfRole">' +
            '<option value="editor" ' + (u.role === 'editor' ? 'selected' : '') + '>محرر</option>' +
            '<option value="viewer" ' + (u.role === 'viewer' ? 'selected' : '') + '>معاينة</option>' +
          '</select></div>' +
        '<div class="settings-field"><label>كلمة السر الحالية</label>' +
          '<input type="password" id="mdroProfCurPass" autocomplete="new-password" placeholder="••••••••" /></div>' +
        '<div class="settings-field"><label>كلمة السر الجديدة (اختياري)</label>' +
          '<input type="password" id="mdroProfNewPass" autocomplete="new-password" placeholder="6 أحرف على الأقل" /></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px">' +
          '<button class="btn btn-primary" id="mdroProfSave" style="flex:1 1 0">تعديل</button>' +
          '<button class="btn btn-danger" id="mdroProfDel" style="flex:1 1 0">حذف</button>' +
        '</div>' +
        '<div class="settings-field" style="margin-top:10px"><label>كود المالك (لتأكيد التعديل أو الحذف)</label>' +
          '<input type="password" id="mdroProfCode" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 أرقام" /></div>' +
        '<p style="font-size:11.5px;color:#6b7f96;margin:6px 0 0">لتغيير كلمة السر أدخل كلمة السر الحالية ثم الجديدة — لا يمكن عرض كلمة سر المستخدم لأنه لا يُخزّن نصّها.</p>' +
        '<div class="settings-msg" id="mdroProfMsg"></div>' +
      '</div>';
    overlay.appendChild(d);
    document.body.appendChild(overlay);

    const msg = d.querySelector('#mdroProfMsg');
    const codeInput = d.querySelector('#mdroProfCode');
    const showMsg = (cls, txt) => { msg.className = 'settings-msg ' + cls; msg.textContent = txt; };

    d.querySelector('#mdroProfSave').addEventListener('click', async () => {
      const ownerCode = codeInput.value;
      if (!ownerCode) { showMsg('err', 'أدخل كود المالك للتأكيد.'); return; }
      const name = d.querySelector('#mdroProfName').value.trim();
      const email = d.querySelector('#mdroProfEmail').value.trim();
      const role = d.querySelector('#mdroProfRole').value;
      const currentPassword = d.querySelector('#mdroProfCurPass').value;
      const newPassword = d.querySelector('#mdroProfNewPass').value;
      showMsg('', '...جارٍ الحفظ');
      const res = await window.MDROAuth.updateUserData(uid, { name, email, role, newPassword, currentPassword }, ownerCode);
      showMsg(res.ok ? 'ok' : 'err', res.msg);
      if (res.ok) { setTimeout(() => overlay.remove(), 900); await drawMDROUsersView(); }
    });

    d.querySelector('#mdroProfDel').addEventListener('click', async () => {
      const ownerCode = codeInput.value;
      if (!ownerCode) { showMsg('err', 'أدخل كود المالك لتأكيد الحذف.'); return; }
      if (!window.confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
      showMsg('', '...جارٍ الحذف');
      const res = await window.MDROAuth.deleteUser(uid, ownerCode);
      showMsg(res.ok ? 'ok' : 'err', res.msg);
      if (res.ok) { setTimeout(() => overlay.remove(), 900); await drawMDROUsersView(); }
    });
  });
}

function escMDRO(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
