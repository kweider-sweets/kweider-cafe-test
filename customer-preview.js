(() => {
  const SUPABASE_URL = 'https://fwjiceleybxhgetsvsvp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk';
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const els = {
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    menu: document.getElementById('menu'),
    search: document.getElementById('search'),
    categoryFilter: document.getElementById('categoryFilter')
  };

  let items = [];

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  const money = value => `£${Number(value || 0).toFixed(2)}`;

  function populateCategories() {
    const seen = new Map();
    for (const item of items) {
      if (!seen.has(item.category_code)) seen.set(item.category_code, item.category_name);
    }
    for (const [code, name] of seen) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = name;
      els.categoryFilter.appendChild(option);
    }
  }

  function render() {
    const q = els.search.value.trim().toLowerCase();
    const category = els.categoryFilter.value;
    const visible = items.filter(item => {
      if (item.availability_status === 'hidden') return false;
      if (category !== 'all' && item.category_code !== category) return false;
      const hay = [item.name_en, item.name_ar, item.description_en, item.description_ar, item.category_name, item.product_id]
        .map(v => String(v ?? '').toLowerCase()).join(' ');
      return !q || hay.includes(q);
    });

    const groups = new Map();
    for (const item of visible) {
      const key = `${item.category_code}|||${item.category_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    els.menu.innerHTML = '';
    if (!visible.length) {
      els.menu.innerHTML = '<div class="state">No menu items match this view.</div>';
      return;
    }

    for (const [key, rows] of groups) {
      const [, categoryName] = key.split('|||');
      const section = document.createElement('section');
      section.className = 'category';
      section.innerHTML = `<h2>${esc(categoryName)}</h2><div class="grid"></div>`;
      const grid = section.querySelector('.grid');

      for (const item of rows) {
        const soldOut = item.availability_status === 'sold_out';
        const card = document.createElement('article');
        card.className = `item${soldOut ? ' sold-out' : ''}`;
        card.innerHTML = `
          <h3>${esc(item.name_en)}</h3>
          <div class="ar">${esc(item.name_ar)}</div>
          <div class="desc">${esc(item.description_en || '')}</div>
          <div class="price">${money(item.price)}</div>
          ${soldOut ? '<div class="sold-label"><span>Sold Out | نفد حالياً</span></div>' : ''}
        `;
        grid.appendChild(card);
      }
      els.menu.appendChild(section);
    }
  }

  async function init() {
    try {
      const { data, error } = await client
        .from('kweider_menu_items')
        .select('product_id,category_code,category_name,name_en,name_ar,price,description_en,description_ar,availability_status,sort_order')
        .order('category_code', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('product_id', { ascending: true });
      if (error) throw error;
      items = Array.isArray(data) ? data : [];
      populateCategories();
      render();
      els.loading.hidden = true;
      els.menu.hidden = false;
    } catch (err) {
      els.loading.hidden = true;
      els.error.hidden = false;
      els.error.textContent = err?.message || 'Unable to load customer preview.';
    }
  }

  els.search.addEventListener('input', render);
  els.categoryFilter.addEventListener('change', render);
  init();
})();
