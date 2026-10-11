(() => {
  const SUPABASE_URL='https://fwjiceleybxhgetsvsvp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk';
  const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  let isAdmin=false;
  let archivedProducts=new Set();
  let archivedCategories=new Set();

  function style(){
    if(document.getElementById('kweider-archive-style')) return;
    const s=document.createElement('style');
    s.id='kweider-archive-style';
    s.textContent=`.danger-btn{background:#8E1D1D;color:#fff;border:0;border-radius:10px;padding:10px 13px;font:inherit;font-weight:800;cursor:pointer}.danger-btn[disabled]{opacity:.45;cursor:not-allowed}.product-delete-wrap{display:flex;gap:7px;align-items:center;justify-content:flex-end}.category-control-actions .danger-btn{padding:8px 10px}@media(max-width:900px){.product-delete-wrap{justify-content:flex-start}}`;
    document.head.appendChild(s);
  }

  async function refreshState(){
    const {data:{user}}=await client.auth.getUser();
    if(!user){isAdmin=false;return;}
    const {data:admin,error:adminError}=await client.rpc('is_kweider_menu_admin');
    isAdmin=!adminError && admin===true;
    const [{data:items},{data:cats}]=await Promise.all([
      client.from('kweider_menu_items').select('product_id,availability_status,archived_at'),
      client.from('kweider_menu_categories').select('category_code,is_archived')
    ]);
    archivedProducts=new Set((items||[]).filter(x=>x.archived_at).map(x=>x.product_id));
    archivedCategories=new Set((cats||[]).filter(x=>x.is_archived).map(x=>x.category_code));
    const live=(items||[]).filter(x=>!x.archived_at);
    const total=document.getElementById('totalCount');
    const available=document.getElementById('availableCount');
    const sold=document.getElementById('soldOutCount');
    const hidden=document.getElementById('hiddenCount');
    if(total) total.textContent=live.length;
    if(available) available.textContent=live.filter(x=>x.availability_status==='available').length;
    if(sold) sold.textContent=live.filter(x=>x.availability_status==='sold_out').length;
    if(hidden) hidden.textContent=live.filter(x=>x.availability_status==='hidden').length;
  }

  async function archiveProduct(id){
    if(!isAdmin) return;
    if(!confirm(`Delete ${id} from the menu?\n\nFor safety this archives the product instead of destroying its record.`)) return;
    const typed=prompt(`Type the exact Product ID to confirm:\n${id}`,'');
    if(typed!==id){alert('Cancelled: Product ID did not match.');return;}
    const now=new Date().toISOString();
    const {error}=await client.from('kweider_menu_items').update({availability_status:'hidden',archived_at:now,updated_at:now}).eq('product_id',id);
    if(error){alert(error.message);return;}
    await client.from('kweider_menu_drafts').update({availability_status:'hidden',updated_at:now}).eq('product_id',id);
    const {data:{user}}=await client.auth.getUser();
    await client.from('kweider_menu_change_log').insert({product_id:id,action:'hidden',changed_fields:{archived:true},changed_by:user?.id||null});
    alert(`${id} removed from the menu.`);
    window.location.reload();
  }

  async function archiveCategory(code){
    if(!isAdmin) return;
    const {data:cat,error}=await client.from('kweider_menu_categories').select('category_code,name_en,is_visible,is_archived').eq('category_code',code).maybeSingle();
    if(error){alert(error.message);return;}
    if(!cat||cat.is_archived) return;
    if(cat.is_visible){alert('Hide the category first.');return;}
    const {count,error:countError}=await client.from('kweider_menu_items').select('product_id',{count:'exact',head:true}).eq('category_code',code).is('archived_at',null);
    if(countError){alert(countError.message);return;}
    if((count||0)>0){alert(`Remove all products in ${cat.name_en} first. ${count} product(s) remain.`);return;}
    if(!confirm(`Delete ${cat.name_en} (${code}) from the menu?\n\nFor safety this archives the category.`)) return;
    const typed=prompt(`Type the exact Category Code to confirm:\n${code}`,'');
    if(typed!==code){alert('Cancelled: Category Code did not match.');return;}
    const {error:updateError}=await client.from('kweider_menu_categories').update({is_visible:false,is_archived:true,updated_at:new Date().toISOString()}).eq('category_code',code);
    if(updateError){alert(updateError.message);return;}
    alert(`${code} removed from the menu.`);
    window.location.reload();
  }

  function cleanArchivedRows(){
    document.querySelectorAll('.edit-btn[data-id]').forEach(edit=>{
      if(archivedProducts.has(edit.dataset.id)) edit.closest('.product-row')?.remove();
    });
    document.querySelectorAll('.category').forEach(section=>{
      if(!section.querySelector('.product-row')) section.remove();
    });
    document.querySelectorAll('.cat-toggle[data-code]').forEach(toggle=>{
      if(archivedCategories.has(toggle.dataset.code)) toggle.closest('.category-control')?.remove();
    });
  }

  function inject(){
    if(!isAdmin) return;
    cleanArchivedRows();
    document.querySelectorAll('.edit-btn[data-id]').forEach(edit=>{
      const parent=edit.parentElement,id=edit.dataset.id;
      if(!parent||!id||archivedProducts.has(id)||parent.querySelector('.product-archive-btn')) return;
      parent.classList.add('product-delete-wrap');
      const btn=document.createElement('button');
      btn.type='button';btn.className='danger-btn product-archive-btn';btn.textContent='Delete';
      btn.addEventListener('click',()=>archiveProduct(id));
      parent.appendChild(btn);
    });
    document.querySelectorAll('.cat-toggle[data-code]').forEach(toggle=>{
      const holder=toggle.parentElement,code=toggle.dataset.code;
      if(!holder||!code||archivedCategories.has(code)||holder.querySelector('.category-archive-btn')) return;
      const btn=document.createElement('button');
      btn.type='button';btn.className='danger-btn category-archive-btn';btn.textContent='Delete';
      const hidden=toggle.textContent.trim().toLowerCase()==='show';
      btn.disabled=!hidden;
      btn.title=hidden?'Delete an empty hidden category':'Hide category before deleting';
      btn.addEventListener('click',()=>archiveCategory(code));
      holder.appendChild(btn);
    });
  }

  async function init(){
    style();
    await refreshState();
    inject();
    const observer=new MutationObserver(()=>inject());
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>void init(),{once:true});
  else void init();
})();
