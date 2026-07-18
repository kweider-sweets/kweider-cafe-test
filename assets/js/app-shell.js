(function(){
  'use strict';
  let deferredPrompt=null;
  const installButtons=()=>document.querySelectorAll('[data-install-app]');
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;installButtons().forEach(b=>b.style.display='inline-flex');const t=document.getElementById('installToast');if(t)t.classList.remove('hidden')});
  document.addEventListener('click',async e=>{const btn=e.target.closest('[data-install-app]');if(!btn)return;if(!deferredPrompt){alert('On iPhone: tap Share, then “Add to Home Screen”.\nعلى الآيفون: اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية.');return}deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installButtons().forEach(b=>b.style.display='none');const t=document.getElementById('installToast');if(t)t.classList.add('hidden')});
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error))}
  function updateHomeBadge(){const el=document.querySelector('[data-rewards-chip]');if(!el||!window.KweiderRewards)return;const m=KweiderRewards.getCurrent();el.textContent=m&&m.id?`${m.points||0} pts`:'Join now'}
  document.addEventListener('DOMContentLoaded',()=>{updateHomeBadge();setTimeout(()=>{const l=document.getElementById('appLoading');if(l){l.style.opacity='0';setTimeout(()=>l.remove(),380)}},250)});
  window.addEventListener('kweider-rewards-updated',updateHomeBadge);window.addEventListener('storage',updateHomeBadge);
})();