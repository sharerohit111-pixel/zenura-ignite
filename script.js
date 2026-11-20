const menu=document.getElementById('menu'),nav=document.getElementById('nav'),backdrop=document.getElementById('sidebar-backdrop'),closeButton=document.getElementById('sidebar-close');
function setMenuOpen(open){
  if(!nav||!menu)return;
  nav.classList.toggle('open',open);
  if(open) nav.scrollTop=0;
  document.body.classList.toggle('sidebar-open',open);
  menu.setAttribute('aria-expanded',String(open));
  menu.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');
  if(backdrop)backdrop.classList.toggle('visible',open);
  if(open)closeButton?.focus({preventScroll:true});else menu.focus({preventScroll:true});
}
menu?.addEventListener('click',()=>setMenuOpen(!nav.classList.contains('open')));
closeButton?.addEventListener('click',()=>setMenuOpen(false));
backdrop?.addEventListener('click',()=>setMenuOpen(false));
nav?.querySelectorAll('a[href]').forEach(a=>a.addEventListener('click',()=>setMenuOpen(false)));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&nav?.classList.contains('open'))setMenuOpen(false)});
window.addEventListener('resize',()=>{if(window.innerWidth>1000&&nav?.classList.contains('open'))setMenuOpen(false)});
const year=document.getElementById('year');if(year)year.textContent=new Date().getFullYear();

// Floating back-to-top control
const backToTop=document.getElementById('back-to-top');
if(backToTop){
 const updateBackToTop=()=>backToTop.classList.toggle('visible',window.scrollY>320);
 window.addEventListener('scroll',updateBackToTop,{passive:true});
 updateBackToTop();
 backToTop.addEventListener('click',()=>window.scrollTo({top:0,behavior:'smooth'}));
}
