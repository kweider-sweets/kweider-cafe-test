(() => {
  const SUPABASE_URL = 'https://fwjiceleybxhgetsvsvp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk';

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const els = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    categories: document.getElementById('categories'),
    search: document.getElementById('search'),
    statusFilter: document.getElementById('statusFilter'),
    totalCount: document.getElementById('totalCount'),
    availableCount: document.getElementById('availableCount'),
    soldOutCount: document.getElementById('soldOutCount'),
    hiddenCount: document.getElementById('hiddenCount'),
    changeCount: document.getElementById('changeCount'),
    editor: document.getElementById('editor'),
    editorId: document.getElementById('editorId'),
    nameEn: document.getElementById('nameEn'),
    nameAr: document.getElementById('nameAr'),
    price: document.getElementById('price'),
    status: document.getElementById('status'),
    descEn: document.getElementById('descEn'),
    descAr: document.getElementById('descAr'),
    allergy: document.getElementById('allergy'),
    saveDraft: document.getElementById('saveDraft'),
    publishItem: document.getElementById('publishItem'),
    editorMessage: document.getElementById('editorMessage'),
    loginForm: document.getElementById('loginForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginMessage: document.getElementById('loginMessage'),
    signedOutBlock: document.getElementById('signedOutBlock'),
    signedInBlock: document.getElementById('signedInBlock'),
    signedInEmail: document.getElementById('signedInEmail'),
    adminState: document.getElementById('adminState'),
    logoutBtn: document.getElementById('logoutBtn')
  };

  let publishedItems = [];
  let draftItems = new Map();
  let editingId = null;
  let currentUser = null;
  let isAdmin = false;

  function text(value) { return value == null ? '' : String(value); }
  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `£${n.toFixed(2)}` : '—';
  }
  function escapeHtml(value) {
    return text(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[ch]));
  }
  function statusLabel(status) {
    if (status === 'sold_out') return 'Sold Out';
    if (status === 'hidden') return 'Hidden';
    return 'Available';
  }

  function currentItem(base) {
    return draftItems.get(base.product_id) || base;
  }

  async function loadPublishedMenu() {
    const { data, error } = await client
      .from('kweider_menu_items')
      .select('product_id,category_code,category_name,name_en,name_ar,price,portion_text,description_en,description_ar,allergy_information,image_path,availability_status,is_new,sort_order,version')
      .order('category_code', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('product_id', { ascending: true });
    if (error) throw error;
    publishedItems = Array.isArray(data) ? data : [];
  }

  async function refreshAuthState() {
    const { data: { user } } = await client.auth.getUser();
    currentUser = user || null;
    isAdmin = false;

    if (!currentUser) {
      els.signedOutBlock.hidden = false;
      els.signedInBlock.hidden = true;
      draftItems = new Map();
      render();
      return;
    }

    els.signedOutBlock.hidden = true;
    els.signedInBlock.hidden = false;
    els.signedInEmail.textContent = currentUser.email || currentUser.id;

    const { data, error } = await client.rpc('is_kweider_menu_admin');
    if (error) {
      els.adminState.textContent = 'Unable to verify Menu Admin access.';
      draftItems = new Map();
      render();
      return;
    }

    isAdmin = data === true;
    if (!isAdmin) {
      els.adminState.textContent = 'Signed in, but this account is not authorised as a Menu Admin.';
      draftItems = new Map();
      render();
      return;
    }

    els.adminState.textContent = 'Authorised Menu Admin — Draft and Publish enabled.';
    await loadDrafts();
    render();
  }

  async function loadDrafts() {
    if (!isAdmin) {
      draftItems = new Map();
      return;
    }
    const { data, error } = await client
      .from('kweider_menu_drafts')
      .select('*')
      .order('category_code', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('product_id', { ascending: true });
    if (error) throw error;
    draftItems = new Map((data || []).map(row => [row.product_id, row]));
  }

  function filteredItems() {
    const q = els.search.value.trim().toLowerCase();
    const status = els.statusFilter.value;
    return publishedItems.map(currentItem).filter(item => {
      const hay = [item.product_id,item.name_en,item.name_ar,item.category_name].map(text).join(' ').toLowerCase();
      return (!q || hay.includes(q)) && (status === 'all' || item.availability_status === status);
    });
  }

  function render() {
    const mergedAll = publishedItems.map(currentItem);
    els.totalCount.textContent = mergedAll.length;
    els.availableCount.textContent = mergedAll.filter(x => x.availability_status === 'available').length;
    els.soldOutCount.textContent = mergedAll.filter(x => x.availability_status === 'sold_out').length;
    els.hiddenCount.textContent = mergedAll.filter(x => x.availability_status === 'hidden').length;
    els.changeCount.textContent = [...draftItems.values()].filter(draft => {
      const pub = publishedItems.find(x => x.product_id === draft.product_id);
      if (!pub) return true;
      return ['name_en','name_ar','price','description_en','description_ar','allergy_information','availability_status','category_code','category_name','portion_text','image_path','is_new','sort_order']
        .some(key => String(draft[key] ?? '') !== String(pub[key] ?? ''));
    }).length;

    const items = filteredItems();
    const groups = new Map();
    for (const item of items) {
      const key = `${item.category_code}|||${item.category_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    els.categories.innerHTML = '';
    if (!items.length) {
      els.categories.innerHTML = '<div class="state-card">No products match your search/filter.</div>';
      return;
    }

    for (const [key, rows] of groups) {
      const [code, name] = key.split('|||');
      const details = document.createElement('details');
      details.className = 'category';
      details.open = true;
      details.innerHTML = `
        <summary>
          <span class="category-title"><span class="category-code">${escapeHtml(code)}</span>${escapeHtml(name)}</span>
          <span class="category-count">${rows.length} products</span>
        </summary>
        <div class="product-list"></div>`;
      const list = details.querySelector('.product-list');
      for (const item of rows) {
        const pub = publishedItems.find(x => x.product_id === item.product_id);
        const changed = pub && ['name_en','name_ar','price','description_en','description_ar','allergy_information','availability_status']
          .some(k => String(item[k] ?? '') !== String(pub[k] ?? ''));
        const row = document.createElement('div');
        row.className = `product-row${changed ? ' changed' : ''}`;
        row.innerHTML = `
          <div class="product-id">${escapeHtml(item.product_id)}</div>
          <div class="name-en">${escapeHtml(item.name_en)}</div>
          <div class="name-ar">${escapeHtml(item.name_ar)}</div>
          <div class="price">${money(item.price)}</div>
          <div><span class="status-pill status-${escapeHtml(item.availability_status)}">${statusLabel(item.availability_status)}</span></div>
          <div><button type="button" class="primary-btn edit-btn" data-id="${escapeHtml(item.product_id)}">${isAdmin ? 'Edit' : 'View'}</button></div>`;
        list.appendChild(row);
      }
      els.categories.appendChild(details);
    }

    els.categories.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openEditor(btn.dataset.id)));
  }

  function openEditor(productId) {
    const base = publishedItems.find(x => x.product_id === productId);
    if (!base) return;
    const item = currentItem(base);
    editingId = productId;
    els.editorId.textContent = productId;
    els.nameEn.value = text(item.name_en);
    els.nameAr.value = text(item.name_ar);
    els.price.value = Number(item.price).toFixed(2);
    els.status.value = item.availability_status || 'available';
    els.descEn.value = text(item.description_en);
    els.descAr.value = text(item.description_ar);
    els.allergy.value = text(item.allergy_information);
    [els.nameEn,els.nameAr,els.price,els.status,els.descEn,els.descAr,els.allergy].forEach(el => el.disabled = !isAdmin);
    els.saveDraft.hidden = !isAdmin;
    els.publishItem.hidden = !isAdmin;
    els.editorMessage.textContent = isAdmin
      ? 'Save Draft changes only the draft table. Publish copies the draft into the new published menu table. The customer-facing menu is not connected yet.'
      : 'Read-only view. Sign in with an authorised Menu Admin account to edit.';
    els.editor.showModal();
  }

  function draftPayload() {
    const base = publishedItems.find(x => x.product_id === editingId);
    const existing = draftItems.get(editingId) || base;
    if (!base || !existing) throw new Error('Product not found.');
    const price = Number(els.price.value);
    if (!els.nameEn.value.trim()) throw new Error('English name is required.');
    if (!Number.isFinite(price) || price < 0) throw new Error('Enter a valid price.');

    return {
      product_id: base.product_id,
      category_code: existing.category_code,
      category_name: existing.category_name,
      name_en: els.nameEn.value.trim(),
      name_ar: els.nameAr.value.trim() || null,
      price,
      portion_text: existing.portion_text || null,
      description_en: els.descEn.value.trim() || null,
      description_ar: els.descAr.value.trim() || null,
      allergy_information: els.allergy.value.trim() || null,
      image_path: existing.image_path || null,
      availability_status: els.status.value,
      is_new: Boolean(existing.is_new),
      sort_order: Number(existing.sort_order || 0),
      base_version: Number(base.version || 1),
      updated_at: new Date().toISOString()
    };
  }

  async function saveDraft(showMessage = true) {
    if (!isAdmin || !currentUser) throw new Error('Menu Admin authorisation required.');
    const payload = draftPayload();
    const { error } = await client.from('kweider_menu_drafts').upsert(payload, { onConflict: 'product_id' });
    if (error) throw error;
    await client.from('kweider_menu_change_log').insert({
      product_id: payload.product_id,
      action: 'draft_saved',
      changed_fields: {
        name_en: payload.name_en,
        name_ar: payload.name_ar,
        price: payload.price,
        availability_status: payload.availability_status
      },
      changed_by: currentUser.id
    });
    draftItems.set(payload.product_id, payload);
    render();
    if (showMessage) els.editorMessage.textContent = 'Draft saved successfully. The customer-facing menu is still unchanged.';
    return payload;
  }

  async function publishCurrent() {
    if (!confirm('Publish this draft to the new published menu table? The customer-facing menu is still not connected to it.')) return;
    const payload = await saveDraft(false);
    const { data, error } = await client.rpc('publish_kweider_menu_item', { p_product_id: payload.product_id });
    if (error) throw error;
    const published = Array.isArray(data) ? data[0] : data;
    if (published) {
      const index = publishedItems.findIndex(x => x.product_id === payload.product_id);
      if (index >= 0) publishedItems[index] = published;
      draftItems.set(payload.product_id, { ...payload, base_version: Number(published.version || payload.base_version) });
    } else {
      await loadPublishedMenu();
      await loadDrafts();
    }
    render();
    els.editorMessage.textContent = 'Published to the new menu database successfully. The customer-facing menu is still not connected.';
  }

  els.saveDraft.addEventListener('click', async () => {
    try {
      els.saveDraft.disabled = true;
      await saveDraft(true);
    } catch (err) {
      els.editorMessage.textContent = err?.message || 'Unable to save draft.';
    } finally {
      els.saveDraft.disabled = false;
    }
  });

  els.publishItem.addEventListener('click', async () => {
    try {
      els.publishItem.disabled = true;
      await publishCurrent();
    } catch (err) {
      els.editorMessage.textContent = err?.message || 'Unable to publish.';
    } finally {
      els.publishItem.disabled = false;
    }
  });

  els.loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    els.loginMessage.textContent = 'Signing in…';
    const { error } = await client.auth.signInWithPassword({
      email: els.loginEmail.value.trim(),
      password: els.loginPassword.value
    });
    if (error) {
      els.loginMessage.textContent = error.message;
      return;
    }
    els.loginPassword.value = '';
    els.loginMessage.textContent = '';
    await refreshAuthState();
  });

  els.logoutBtn.addEventListener('click', async () => {
    await client.auth.signOut();
    await refreshAuthState();
  });

  els.search.addEventListener('input', render);
  els.statusFilter.addEventListener('change', render);

  (async () => {
    try {
      await loadPublishedMenu();
      await refreshAuthState();
      els.loading.hidden = true;
      els.categories.hidden = false;
      render();
    } catch (err) {
      els.loading.hidden = true;
      els.error.hidden = false;
      els.error.textContent = err?.message || 'Unable to load menu control data.';
    }
  })();
})();
