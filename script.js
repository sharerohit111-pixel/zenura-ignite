const menu=document.getElementById('menu'),nav=document.getElementById('nav');menu.addEventListener('click',()=>nav.classList.toggle('open'));nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')));document.getElementById('year').textContent=new Date().getFullYear();

// Floating back-to-top control
const backToTop = document.getElementById("back-to-top");
if (backToTop) {
  const updateBackToTop = () => backToTop.classList.toggle("visible", window.scrollY > 320);
  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();
  backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}
