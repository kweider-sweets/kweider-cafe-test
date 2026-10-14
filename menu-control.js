(() => {
  const SUPABASE_URL='https://fwjiceleybxhgetsvsvp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk';
  const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  const $=id=>document.getElementById(id);
  const els={
    loading:$('loading'),error:$('error'),categories:$('categories'),search:$('search'),statusFilter:$('statusFilter'),
    totalCount:$('totalCount'),availableCount:$('availableCount'),soldOutCount:$('soldOutCount'),hiddenCount:$('hiddenCount'),changeCount:$('changeCount'),
    editor:$('editor'),editorId:$('editorId'),nameEn:$('nameEn'),nameAr:$('nameAr'),price:$('price'),status:$('status'),sortOrder:$('sortOrder'),imagePath:$('imagePath'),descEn:$('descEn'),descAr:$('descAr'),allergy:$('allergy'),saveDraft:$('saveDraft'),publishItem:$('publishItem'),editorMessage:$('editorMessage'),editClose:$('editClose'),editCancel:$('editCancel'),
    loginForm:$('loginForm'),loginEmail:$('loginEmail'),loginPassword:$('loginPassword'),loginMessage:$('loginMessage'),signedOutBlock:$('signedOutBlock'),signedInBlock:$('signedInBlock'),signedInEmail:$('signedInEmail'),adminState:$('adminState'),logoutBtn:$('logoutBtn'),
    categoryControls:$('categoryControls'),addProductBtn:$('addProductBtn'),addCategoryBtn:$('addCategoryBtn'),
    newProductDialog:$('newProductDialog'),newProductCategory:$('newProductCategory'),newProductPrice:$('newProductPrice'),newProductNameEn:$('newProductNameEn'),newProductNameAr:$('newProductNameAr'),newProductImage:$('newProductImage'),newProductStatus:$('newProductStatus'),newProductDescEn:$('newProductDescEn'),newProductDescAr:$('newProductDescAr'),newProductAllergy:$('newProductAllergy'),newProductIsNew:$('newProductIsNew'),createProductBtn:$('createProductBtn'),newProductMessage:$('newProductMessage'),newProductClose:$('newProductClose'),newProductCancel:$('newProductCancel'),
    newCategoryDialog:$('newCategoryDialog'),newCategoryCode:$('newCategoryCode'),newCategoryOrder:$('newCategoryOrder'),newCategoryNameEn:$('newCategoryNameEn'),newCategoryNameAr:$('newCategoryNameAr'),newCategoryImage:$('newCategoryImage'),newCategorySection:$('newCategorySection'),createCategoryBtn:$('createCategoryBtn'),newCategoryMessage:$('newCategoryMessage'),newCategoryClose:$('newCategoryClose'),newCategoryCancel:$('newCategoryCancel')
  };

  let publishedItems=[],draftItems=new Map(),categoryRows=[],editingId=null,currentUser=null,isAdmin=false;
  const txt=v=>v==null?'':String(v), money=v=>Number.isFinite(Number(v))?`£${Number(v).toFixed(2)}`:'—';
  const esc=v=>txt(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
  const statusLabel=s=>s==='sold_out'?'Sold Out':s==='hidden'?'Hidden':'Available';
  const currentItem=b=>draftItems.get(b.product_id)||b;
  const slug=s=>txt(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);

  async function loadPublishedMenu(){const {data,error}=await client.from('kweider_menu_items').select('product_id,category_code,category_name,name_en,name_ar,price,portion_text,description_en,description_ar,allergy_information,image_path,availability_status,is_new,sort_order,version').order('category_code').order('sort_order').order('product_id');if(error)throw error;publishedItems=data||[];}
  async function loadCategories(){const {data,error}=await client.from('kweider_menu_categories').select('*').order('sort_order').order('category_code');if(error)throw error;categoryRows=data||[];populateCategorySelect();}
  async function loadDrafts(){if(!isAdmin){draftItems=new Map();return;}const {data,error}=await client.from('kweider_menu_drafts').select('*').order('category_code').order('sort_order').order('product_id');if(error)throw error;draftItems=new Map((data||[]).map(r=>[r.product_id,r]));}

  async function refreshAuthState(){
    const {data:{user}}=await client.auth.getUser();currentUser=user||null;isAdmin=false;
    if(!currentUser){els.signedOutBlock.hidden=false;els.signedInBlock.hidden=true;draftItems=new Map();setAdminButtons();render();return;}
    els.signedOutBlock.hidden=true;els.signedInBlock.hidden=false;els.signedInEmail.textContent=currentUser.email||currentUser.id;
    const {data,error}=await client.rpc('is_kweider_menu_admin');
    if(error){els.adminState.textContent='Unable to verify Menu Admin access.';return;}
    isAdmin=data===true;
    els.adminState.textContent=isAdmin?'Authorised Menu Admin — full menu controls enabled.':'Signed in, but this account is not authorised as a Menu Admin.';
    if(isAdmin)await loadDrafts();setAdminButtons();render();
  }

  function setAdminButtons(){els.addProductBtn.hidden=!isAdmin;els.addCategoryBtn.hidden=!isAdmin;}
  function populateCategorySelect(){els.newProductCategory.innerHTML=categoryRows.map(c=>`<option value="${esc(c.category_code)}">${esc(c.name_en)} (${esc(c.category_code)})</option>`).join('');}
  function filteredItems(){const q=els.search.value.trim().toLowerCase(),st=els.statusFilter.value,catOrder=new Map(categoryRows.map((c,i)=>[c.category_code,Number(c.sort_order??i*10)]));return publishedItems.map(currentItem).filter(i=>{const h=[i.product_id,i.name_en,i.name_ar,i.category_name].map(txt).join(' ').toLowerCase();return(!q||h.includes(q))&&(st==='all'||i.availability_status===st);}).sort((a,b)=>(catOrder.get(a.category_code)??9999)-(catOrder.get(b.category_code)??9999)||Number(a.sort_order||0)-Number(b.sort_order||0)||String(a.product_id).localeCompare(String(b.product_id)));}
  function jumpToCategory(code){els.search.value='';els.statusFilter.value='all';render();requestAnimationFrame(()=>{const details=document.getElementById(`category-${code}`);if(!details)return;details.open=true;details.scrollIntoView({behavior:'smooth',block:'start'});details.classList.add('category-focus');setTimeout(()=>details.classList.remove('category-focus'),1400);});}

  function renderCategoryControls(){
    if(!categoryRows.length){els.categoryControls.innerHTML='<span class="muted">No categories found.</span>';return;}
    els.categoryControls.innerHTML='';
    categoryRows.forEach(c=>{const wrap=document.createElement('div');wrap.className='category-control';wrap.innerHTML=`<div><button class="category-jump" data-code="${esc(c.category_code)}" type="button"><span class="category-code">${esc(c.category_code)}</span> <span>${esc(c.name_en)}</span></button><small>${esc(c.name_ar||'')} · order ${Number(c.sort_order||0)}</small></div><div class="category-control-actions"><span class="visibility-pill ${c.is_visible?'on':'off'}">${c.is_visible?'Visible':'Hidden'}</span>${isAdmin?`<button class="ghost-btn cat-toggle" data-code="${esc(c.category_code)}" type="button">${c.is_visible?'Hide':'Show'}</button>`:''}</div>`;els.categoryControls.appendChild(wrap);});
    els.categoryControls.querySelectorAll('.cat-toggle').forEach(b=>b.addEventListener('click',()=>toggleCategory(b.dataset.code)));
    els.categoryControls.querySelectorAll('.category-jump').forEach(b=>b.addEventListener('click',()=>jumpToCategory(b.dataset.code)));
  }

  function render(){
    const merged=publishedItems.map(currentItem);
    els.totalCount.textContent=merged.length;els.availableCount.textContent=merged.filter(x=>x.availability_status==='available').length;els.soldOutCount.textContent=merged.filter(x=>x.availability_status==='sold_out').length;els.hiddenCount.textContent=merged.filter(x=>x.availability_status==='hidden').length;
    els.changeCount.textContent=[...draftItems.values()].filter(d=>{const p=publishedItems.find(x=>x.product_id===d.product_id);if(!p)return true;return['name_en','name_ar','price','description_en','description_ar','allergy_information','availability_status','category_code','category_name','portion_text','image_path','is_new','sort_order'].some(k=>String(d[k]??'')!==String(p[k]??''));}).length;
    renderCategoryControls();
    const items=filteredItems(),groups=new Map();items.forEach(i=>{const k=`${i.category_code}|||${i.category_name}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i);});
    els.categories.innerHTML='';if(!items.length){els.categories.innerHTML='<div class="state-card">No products match your search/filter.</div>';return;}
    for(const [k,rows] of groups){const [code,name]=k.split('|||'),details=document.createElement('details');details.className='category';details.id=`category-${code}`;details.open=true;details.innerHTML=`<summary><span class="category-title"><span class="category-code">${esc(code)}</span>${esc(name)}</span><span class="category-count">${rows.length} products</span></summary><div class="product-list"></div>`;const list=details.querySelector('.product-list');rows.forEach(item=>{const pub=publishedItems.find(x=>x.product_id===item.product_id),changed=pub&&['name_en','name_ar','price','description_en','description_ar','allergy_information','availability_status','image_path','sort_order'].some(z=>String(item[z]??'')!==String(pub[z]??'')),row=document.createElement('div');row.className=`product-row${changed?' changed':''}`;row.innerHTML=`<div class="product-id">${esc(item.product_id)}<small class="order-label">Order ${Number(item.sort_order||0)}</small></div><div class="name-en">${esc(item.name_en)}</div><div class="name-ar">${esc(item.name_ar)}</div><div class="price">${money(item.price)}</div><div><span class="status-pill status-${esc(item.availability_status)}">${statusLabel(item.availability_status)}</span></div><div><button type="button" class="primary-btn edit-btn" data-id="${esc(item.product_id)}">${isAdmin?'Edit':'View'}</button></div>`;list.appendChild(row);});els.categories.appendChild(details);}
    els.categories.querySelectorAll('.edit-btn').forEach(b=>b.addEventListener('click',()=>openEditor(b.dataset.id)));
  }

  async function toggleCategory(code){if(!isAdmin)return;const c=categoryRows.find(x=>x.category_code===code);if(!c)return;const next=!c.is_visible;const action=next?'show':'hide';if(!confirm(`${action[0].toUpperCase()+action.slice(1)} the entire ${c.name_en} category on the live menu?`))return;const {error}=await client.from('kweider_menu_categories').update({is_visible:next,updated_at:new Date().toISOString()}).eq('category_code',code);if(error){alert(error.message);return;}c.is_visible=next;render();}

  function openEditor(id){
    const base=publishedItems.find(x=>x.product_id===id);if(!base)return;const item=currentItem(base);editingId=id;
    els.editorId.textContent=id;els.nameEn.value=txt(item.name_en);els.nameAr.value=txt(item.name_ar);els.price.value=Number(item.price).toFixed(2);els.status.value=item.availability_status||'available';els.sortOrder.value=Number(item.sort_order||0);els.imagePath.value=txt(item.image_path);els.descEn.value=txt(item.description_en);els.descAr.value=txt(item.description_ar);els.allergy.value=txt(item.allergy_information);
    [els.nameEn,els.nameAr,els.price,els.status,els.sortOrder,els.imagePath,els.descEn,els.descAr,els.allergy].forEach(x=>x.disabled=!isAdmin);
    els.saveDraft.hidden=!isAdmin;els.publishItem.hidden=!isAdmin;els.editorMessage.textContent=isAdmin?'Save Draft keeps the change unpublished. Publish updates the live customer menu.':'Read-only view.';els.editor.showModal();
  }

  function draftPayload(){
    const base=publishedItems.find(x=>x.product_id===editingId),existing=draftItems.get(editingId)||base;if(!base||!existing)throw new Error('Product not found.');
    const price=Number(els.price.value),sortOrder=Number(els.sortOrder.value);
    if(!els.nameEn.value.trim())throw new Error('English name is required.');if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price.');if(!Number.isFinite(sortOrder))throw new Error('Enter a valid display order.');
    return{product_id:base.product_id,category_code:existing.category_code,category_name:existing.category_name,name_en:els.nameEn.value.trim(),name_ar:els.nameAr.value.trim()||null,price,portion_text:existing.portion_text||null,description_en:els.descEn.value.trim()||null,description_ar:els.descAr.value.trim()||null,allergy_information:els.allergy.value.trim()||null,image_path:els.imagePath.value.trim()||null,availability_status:els.status.value,is_new:Boolean(existing.is_new),sort_order:Math.trunc(sortOrder),base_version:Number(base.version||1),updated_at:new Date().toISOString()};
  }

  async function saveDraft(show=true){if(!isAdmin||!currentUser)throw new Error('Menu Admin authorisation required.');const p=draftPayload();const {error}=await client.from('kweider_menu_drafts').upsert(p,{onConflict:'product_id'});if(error)throw error;await client.from('kweider_menu_change_log').insert({product_id:p.product_id,action:'draft_saved',changed_fields:{name_en:p.name_en,name_ar:p.name_ar,price:p.price,availability_status:p.availability_status,sort_order:p.sort_order,image_path:p.image_path},changed_by:currentUser.id});draftItems.set(p.product_id,p);render();if(show)els.editorMessage.textContent='Draft saved successfully.';return p;}
  async function publishCurrent(){if(!confirm('Publish this product change to the live customer menu?'))return;const p=await saveDraft(false);const {data,error}=await client.rpc('publish_kweider_menu_item',{p_product_id:p.product_id});if(error)throw error;const published=Array.isArray(data)?data[0]:data;if(published){const i=publishedItems.findIndex(x=>x.product_id===p.product_id);if(i>=0)publishedItems[i]=published;draftItems.set(p.product_id,{...p,base_version:Number(published.version||p.base_version)});}else{await loadPublishedMenu();await loadDrafts();}render();els.editorMessage.textContent='Published successfully to live menu.';if(els.editor.open)els.editor.close();editingId=null;}

  async function createProduct(){if(!isAdmin)return;const price=Number(els.newProductPrice.value);if(!els.newProductNameEn.value.trim())throw new Error('English name is required.');if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price.');const {data,error}=await client.rpc('create_kweider_menu_item',{p_category_code:els.newProductCategory.value,p_name_en:els.newProductNameEn.value.trim(),p_name_ar:els.newProductNameAr.value.trim()||null,p_price:price,p_description_en:els.newProductDescEn.value.trim()||null,p_description_ar:els.newProductDescAr.value.trim()||null,p_allergy_information:els.newProductAllergy.value.trim()||null,p_image_path:els.newProductImage.value.trim()||null,p_availability_status:els.newProductStatus.value,p_is_new:els.newProductIsNew.checked});if(error)throw error;await loadPublishedMenu();await loadDrafts();render();els.newProductMessage.textContent=`Added ${data?.product_id||'product'} successfully at the top of its category.`;setTimeout(()=>els.newProductDialog.close(),700);}
  async function createCategory(){if(!isAdmin)return;const code=els.newCategoryCode.value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(!/^[A-Z0-9]{2,6}$/.test(code))throw new Error('Category code must be 2–6 letters/numbers.');const name=els.newCategoryNameEn.value.trim();if(!name)throw new Error('English category name is required.');const section=(els.newCategorySection.value.trim()||slug(name));if(!section)throw new Error('Section ID is required.');const max=Math.max(0,...categoryRows.map(c=>Number(c.sort_order||0)));const order=els.newCategoryOrder.value===''?max+10:Number(els.newCategoryOrder.value);const {error}=await client.from('kweider_menu_categories').insert({category_code:code,name_en:name,name_ar:els.newCategoryNameAr.value.trim()||null,section_id:section,image_path:els.newCategoryImage.value.trim()||null,is_visible:false,show_in_home:true,sort_order:order});if(error)throw error;await loadCategories();render();els.newCategoryMessage.textContent='Category added as Hidden. Use Show when ready.';setTimeout(()=>els.newCategoryDialog.close(),600);}

  els.saveDraft.addEventListener('click',async()=>{try{els.saveDraft.disabled=true;await saveDraft();}catch(e){els.editorMessage.textContent=e.message||'Unable to save.';}finally{els.saveDraft.disabled=false;}});
  els.publishItem.addEventListener('click',async()=>{try{els.publishItem.disabled=true;await publishCurrent();}catch(e){els.editorMessage.textContent=e.message||'Unable to publish.';}finally{els.publishItem.disabled=false;}});
  els.loginForm.addEventListener('submit',async e=>{e.preventDefault();els.loginMessage.textContent='Signing in…';const {error}=await client.auth.signInWithPassword({email:els.loginEmail.value.trim(),password:els.loginPassword.value});if(error){els.loginMessage.textContent=error.message;return;}els.loginPassword.value='';els.loginMessage.textContent='';await refreshAuthState();});
  els.logoutBtn.addEventListener('click',async()=>{await client.auth.signOut();await refreshAuthState();});
  els.search.addEventListener('input',render);els.statusFilter.addEventListener('change',render);
  els.addProductBtn.addEventListener('click',()=>{els.newProductMessage.textContent='';els.newProductStatus.value='hidden';els.newProductDialog.showModal();});
  els.addCategoryBtn.addEventListener('click',()=>{els.newCategoryMessage.textContent='';els.newCategoryOrder.value='';els.newCategoryDialog.showModal();});
  els.newCategoryNameEn.addEventListener('input',()=>{if(!els.newCategorySection.dataset.manual)els.newCategorySection.value=slug(els.newCategoryNameEn.value);});
  els.newCategorySection.addEventListener('input',()=>els.newCategorySection.dataset.manual='1');
  els.createProductBtn.addEventListener('click',async()=>{try{els.createProductBtn.disabled=true;await createProduct();}catch(e){els.newProductMessage.textContent=e.message||'Unable to add product.';}finally{els.createProductBtn.disabled=false;}});
  els.createCategoryBtn.addEventListener('click',async()=>{try{els.createCategoryBtn.disabled=true;await createCategory();}catch(e){els.newCategoryMessage.textContent=e.message||'Unable to add category.';}finally{els.createCategoryBtn.disabled=false;}});

  const closeDialog=dialog=>{if(dialog?.open)dialog.close();};
  els.editClose?.addEventListener('click',()=>closeDialog(els.editor));
  els.editCancel?.addEventListener('click',()=>closeDialog(els.editor));
  els.newProductClose?.addEventListener('click',()=>closeDialog(els.newProductDialog));
  els.newProductCancel?.addEventListener('click',()=>closeDialog(els.newProductDialog));
  els.newCategoryClose?.addEventListener('click',()=>closeDialog(els.newCategoryDialog));
  els.newCategoryCancel?.addEventListener('click',()=>closeDialog(els.newCategoryDialog));

  (async()=>{try{await Promise.all([loadPublishedMenu(),loadCategories()]);await refreshAuthState();els.loading.hidden=true;els.categories.hidden=false;setAdminButtons();render();}catch(e){els.loading.hidden=true;els.error.hidden=false;els.error.textContent=e.message||'Unable to load menu control data.';}})();
})();