(() => {
 const root=document.documentElement,panel=document.getElementById("site-settings-panel"),button=document.getElementById("site-settings-toggle"),dark=document.getElementById("dark-mode-toggle"),night=document.getElementById("night-mode-toggle");
 if(!panel||!button||!dark||!night)return;
 const read=k=>localStorage.getItem(k)==="true";
 const apply=()=>{root.classList.toggle("zenura-light-mode",dark.checked);root.classList.toggle("zenura-night-mode",night.checked);localStorage.setItem("zenura-dark-mode",String(dark.checked));localStorage.setItem("zenura-night-mode",String(night.checked));};
 dark.checked=read("zenura-dark-mode");night.checked=read("zenura-night-mode");apply();
 button.addEventListener("click",()=>{const open=panel.hidden;panel.hidden=!open;button.setAttribute("aria-expanded",String(open));});
 dark.addEventListener("change",apply);night.addEventListener("change",apply);
})();
