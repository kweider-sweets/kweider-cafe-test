(() => {
  const SUPABASE_URL = 'https://fwjiceleybxhgetsvsvp.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3amljZWxleWJ4aGdldHN2c3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0ODEzNjIsImV4cCI6MjEwMDA1NzM2Mn0.ggZLFIU5y7iaiyj0wZqORpFWOyZFDLSEQhb41VKOsqU';
  const LOCAL_KEY = 'kweider-menu-control-test-changes-v1';

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
    resetLocal: document.getElementById('resetLocal'),
    editor: document.getElementById('editor'),
    editorForm: document.getElementById('editorForm'),
    editorId: document.getElementById('editorId'),
    nameEn: document.getElementById('nameEn'),
    nameAr: document.getElementById('nameAr'),
    price: document.getElementById('price'),
    status: document.getElementById('status'),
    descEn: document.getElementById('descEn'),
    descAr: document.getElementById('descAr'),
    allergy: document.getElementById('allergy'),
    saveLocal: document.getElementById('saveLocal')
  };

  let sourceItems = [];
  let editingId = null;
  let localChanges = loadLocalChanges();

  function loadLocalChanges() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveLocalChanges() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(localChanges));
  }

  function mergedItem(item) {
    return { ...item, ...(localChanges[item.product_id] || {}) };
  }

  async function loadMenu() {
    const fields = [
      'product_id','category_code','category_name','name_en','name_ar','price','portion_text',
      'description_en','description_ar','allergy_information','image_path','availability_status','is_new','sort_order'
    ].join(',');
    const url = `${SUPABASE_URL}/rest/v1/kweider_menu_items?select=${encodeURIComponent(fields)}&order=category_code.asc,sort_order.asc,product_id.asc`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json'
      }
    });
    if (!response.ok) throw new Error(`Unable to load menu data (${response.status})`);
    sourceItems = await response.json();
    if (!Array.isArray(sourceItems)) throw new Error('Unexpected menu data response.');
  }

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

  function filteredItems() {
    const q = els.search.value.trim().toLowerCase();
    const status = els.statusFilter.value;
    return sourceItems.map(mergedItem).filter(item => {
      const hay = [item.product_id,item.name_en,item.name_ar,item.category_name].map(text).join(' ').toLowerCase();
      const queryOk = !q || hay.includes(q);
      const statusOk = status === 'all' || item.availability_status === status;
      return queryOk && statusOk;
    });
  }

  function render() {
    const mergedAll = sourceItems.map(mergedItem);
    els.totalCount.textContent = mergedAll.length;
    els.availableCount.textContent = mergedAll.filter(x => x.availability_status === 'available').length;
    els.soldOutCount.textContent = mergedAll.filter(x => x.availability_status === 'sold_out').length;
    els.hiddenCount.textContent = mergedAll.filter(x => x.availability_status === 'hidden').length;
    els.changeCount.textContent = Object.keys(localChanges).length;

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
        const changed = Boolean(localChanges[item.product_id]);
        const row = document.createElement('div');
        row.className = `product-row${changed ? ' changed' : ''}`;
        row.innerHTML = `
          <div class="product-id">${escapeHtml(item.product_id)}</div>
          <div class="name-en">${escapeHtml(item.name_en)}</div>
          <div class="name-ar">${escapeHtml(item.name_ar)}</div>
          <div class="price">${money(item.price)}</div>
          <div><span class="status-pill status-${escapeHtml(item.availability_status)}">${statusLabel(item.availability_status)}</span></div>
          <div><button type="button" class="primary-btn edit-btn" data-id="${escapeHtml(item.product_id)}">Edit</button></div>`;
        list.appendChild(row);
      }
      els.categories.appendChild(details);
    }

    els.categories.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditor(btn.dataset.id));
    });
  }

  function openEditor(productId) {
    const base = sourceItems.find(x => x.product_id === productId);
    if (!base) return;
    const item = mergedItem(base);
    editingId = productId;
    els.editorId.textContent = productId;
    els.nameEn.value = text(item.name_en);
    els.nameAr.value = text(item.name_ar);
    els.price.value = Number(item.price).toFixed(2);
    els.status.value = item.availability_status || 'available';
    els.descEn.value = text(item.description_en);
    els.descAr.value = text(item.description_ar);
    els.allergy.value = text(item.allergy_information);
    els.editor.showModal();
  }

  function storeEditorChange() {
    if (!editingId) return;
    const base = sourceItems.find(x => x.product_id === editingId);
    if (!base) return;
    const candidate = {
      name_en: els.nameEn.value.trim(),
      name_ar: els.nameAr.value.trim(),
      price: Number(els.price.value),
      availability_status: els.status.value,
      description_en: els.descEn.value.trim(),
      description_ar: els.descAr.value.trim(),
      allergy_information: els.allergy.value.trim()
    };
    if (!candidate.name_en || !Number.isFinite(candidate.price) || candidate.price < 0) return;

    const normalized = {};
    for (const [key, value] of Object.entries(candidate)) {
      const baseValue = key === 'price' ? Number(base[key]) : text(base[key]);
      if (value !== baseValue) normalized[key] = value;
    }
    if (Object.keys(normalized).length) localChanges[editingId] = normalized;
    else delete localChanges[editingId];
    saveLocalChanges();
    render();
  }

  els.editorForm.addEventListener('submit', event => {
    const submitter = event.submitter;
    if (submitter && submitter.id === 'saveLocal') storeEditorChange();
    editingId = null;
  });

  els.search.addEventListener('input', render);
  els.statusFilter.addEventListener('change', render);
  els.resetLocal.addEventListener('click', () => {
    if (!Object.keys(localChanges).length) return;
    if (!confirm('Reset all browser-only test changes? Nothing on the live menu will be affected.')) return;
    localChanges = {};
    localStorage.removeItem(LOCAL_KEY);
    render();
  });

  (async () => {
    try {
      await loadMenu();
      els.loading.hidden = true;
      els.categories.hidden = false;
      render();
    } catch (err) {
      els.loading.hidden = true;
      els.error.hidden = false;
      els.error.textContent = err && err.message ? err.message : 'Unable to load menu control data.';
    }
  })();
})();
