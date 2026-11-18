/* Indian Stock Market mode — deliberately isolated from ../crypto/. No demo quotes are fabricated. */
(function(){
  'use strict';
  const tabs=[...document.querySelectorAll('[data-list]')];
  const title=document.getElementById('selected-name');
  const symbol=document.getElementById('selected-symbol');
  const search=document.getElementById('instrument-search');
  const list=document.getElementById('instrument-list');
  let activeList='indices';
  const labels={indices:'Indices',equities:'Equities',futures:'Futures',options:'Options'};
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    tabs.forEach(item=>item.classList.toggle('active',item===tab));
    activeList=tab.dataset.list;
    list.innerHTML='<div class="empty">'+labels[activeList]+' will load from the authorized Upstox instrument master. No sample symbols or prices are presented as live data.</div>';
    title.textContent='No instrument selected';
    symbol.textContent='Connect data feed to load market instruments';
    document.getElementById('selected-price').textContent='—';
  }));
  search.addEventListener('input',()=>{
    if(search.value.trim()) list.innerHTML='<div class="empty">Instrument search becomes available after the official instrument master is securely loaded. Search: '+escapeText(search.value.trim())+'</div>';
    else list.innerHTML='<div class="empty">'+labels[activeList]+' will load from the authorized Upstox instrument master.</div>';
  });
  function escapeText(value){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  window.ZENURA_INDIAN_MARKET={mode:'indian-stocks',provider:'upstox',status:'awaiting-server-oauth',activeList:()=>activeList};
})();