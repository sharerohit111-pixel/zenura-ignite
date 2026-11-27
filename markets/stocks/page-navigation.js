(function(){
  const links=[...document.querySelectorAll('[data-terminal-page]')];
  const workspace=document.querySelector('.workspace');
  const panels={
    chart:['.stock-hero','.notice','.workspace'],
    watchlist:['.workspace'],
    balance:['.workspace'],
    orders:['.paper-order-book','.protective-orders-panel'],
    positions:['.portfolio-panel','.futures-portfolio-panel'],
    pnl:['.portfolio-panel'],
    derivatives:['.futures-margin-panel','.futures-order-panel','.futures-limit-panel','.options-limit-panel','.option-panel']
  };
  const pageElements=['.stock-hero','.notice','.workspace','.paper-order-book','.protective-orders-panel','.portfolio-panel','.futures-margin-panel','.futures-order-panel','.futures-limit-panel','.options-limit-panel','.option-panel'];
  function show(page,updateHash){
    if(!panels[page]) page='chart';
    document.body.dataset.terminalPage=page;
    pageElements.forEach(sel=>document.querySelectorAll(sel).forEach(el=>el.dataset.pageHidden=String(!panels[page].includes(sel))));
    if(workspace){
      const children=[...workspace.children];
      children.forEach(el=>{
        const keep=page==='chart'||(page==='watchlist'&&el.classList.contains('watch'))||(page==='balance'&&el.classList.contains('order-panel'));
        el.dataset.pageHidden=String(!keep);
      });
    }
    links.forEach(a=>{const active=a.dataset.terminalPage===page;if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    if(updateHash&&location.hash!=='#'+page) history.replaceState(null,'','#'+page);
    window.scrollTo({top:0,behavior:'auto'});
  }
  links.forEach(a=>a.addEventListener('click',e=>{e.preventDefault();show(a.dataset.terminalPage,true)}));
  window.addEventListener('hashchange',()=>show(location.hash.slice(1),false));
  show(location.hash.slice(1)||'chart',false);
})();