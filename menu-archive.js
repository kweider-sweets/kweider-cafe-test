(() => {
  const SUPABASE_URL='https://fwjiceleybxhgetsvsvp.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_yNgSShCyeQ6FfSy30T6-hg_9dLXXpwk';
  const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  let isAdmin=false;

  function style(){
    if(document.getElementById('kweider-delete-style')) return;
    const s=document.createElement('style');
    s.id='kweider-delete-style';
    s.textContent=`.danger-btn{background:#8E1D1D;color:#fff;border:0;border-radius:10px;padding:10px 13px;font:inherit;font-weight:800;cursor:pointer}.danger-btn[disabled]{opacity:.45;cursor:not-allowed}.product-delete-wrap{display:flex;gap:7px;align-items:center;justify-content:flex-end}.category-control-actions .danger-btn{padding:8px 10px}@media(max-width:900px){.product-delete-wrap{justify-content:flex-start}}`;
    document.head.appendChild(s);
  }

  async function refreshAdmin(){
    const {data:{user}}=await client.auth.getUser();
    if(!user){isAdmin=false;return;}
    const {data,error}=await client.rpc('is_kweider_menu_admin');
    isAdmin=!error && data===true;
  }

  async function deleteProduct(id){
    if(!isAdmin) return;
    if(!confirm(`Delete ${id} from the Preview menu?`)) return;
    const typed=prompt(`Type the exact Product ID to confirm:\n${id}`,'');
    if(typed!==id){alert('Cancelled: Product ID did not match.');return;}
    const {data,error}=await client.rpc('delete_kweider_menu_item',{p_product_id:id,p_confirm_product_id:typed});
    if(error){alert(`Delete failed: ${error.message}`);return;}
    if(data!==true){alert('Delete failed: no confirmation returned.');return;}
    alert(`${id} deleted successfully.`);
    window.location.reload();
  }

  async function deleteCategory(code){
    if(!isAdmin) return;
    const {data:cat,error:catError}=await client.from('kweider_menu_categories').select('category_code,name_en,is_visible').eq('category_code',code).maybeSingle();
    if(catError){alert(catError.message);return;}
    if(!cat) return;
    if(cat.is_visible){alert('Hide the category first.');return;}
    const {count,error:countError}=await client.from('kweider_menu_items').select('product_id',{count:'exact',head:true}).eq('category_code',code);
    if(countError){alert(countError.message);return;}
    if((count||0)>0){alert(`Delete all products in ${cat.name_en} first. ${count} product(s) remain.`);return;}
    if(!confirm(`Delete ${cat.name_en} (${code}) from the Preview menu?`)) return;
    const typed=prompt(`Type the exact Category Code to confirm:\n${code}`,'');
    if(typed!==code){alert('Cancelled: Category Code did not match.');return;}
    const {data,error}=await client.rpc('delete_kweider_menu_category',{p_category_code:code,p_confirm_category_code:typed});
    if(error){alert(`Delete failed: ${error.message}`);return;}
    if(data!==true){alert('Delete failed: no confirmation returned.');return;}
    alert(`${code} deleted successfully.`);
    window.location.reload();
  }

  function inject(){
    if(!isAdmin) return;
    document.querySelectorAll('.edit-btn[data-id]').forEach(edit=>{
      const parent=edit.parentElement,id=edit.dataset.id;
      if(!parent||!id||parent.querySelector('.product-delete-btn')) return;
      parent.classList.add('product-delete-wrap');
      const btn=document.createElement('button');
      btn.type='button';btn.className='danger-btn product-delete-btn';btn.textContent='Delete';
      btn.addEventListener('click',()=>void deleteProduct(id));
      parent.appendChild(btn);
    });
    document.querySelectorAll('.cat-toggle[data-code]').forEach(toggle=>{
      const holder=toggle.parentElement,code=toggle.dataset.code;
      if(!holder||!code||holder.querySelector('.category-delete-btn')) return;
      const btn=document.createElement('button');
      btn.type='button';btn.className='danger-btn category-delete-btn';btn.textContent='Delete';
      const hidden=toggle.textContent.trim().toLowerCase()==='show';
      btn.disabled=!hidden;
      btn.title=hidden?'Delete an empty hidden category':'Hide category before deleting';
      btn.addEventListener('click',()=>void deleteCategory(code));
      holder.appendChild(btn);
    });
  }

  async function init(){
    style();
    await refreshAdmin();
    inject();
    const observer=new MutationObserver(()=>inject());
    observer.observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>void init(),{once:true});
  else void init();
})();
