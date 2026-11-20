import { ADMIN_EMAIL, isFirebaseConfigured } from "./firebase-config.js";

const link = document.getElementById("account-nav-link");
if (link && isFirebaseConfigured()) {
  const [{ auth }, { onAuthStateChanged, signOut }] = await Promise.all([
    import("./firebase-client.js"),
    import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js")
  ]);

  const signedOutLabel = () => {
    link.href = "customer.html";
    link.textContent = "Sign In";
    link.dataset.en = "Sign In";
    link.dataset.hi = "साइन इन";
    link.removeAttribute("aria-busy");
    link.onclick = null;
  };

  onAuthStateChanged(auth, user => {
    if (!user) {
      signedOutLabel();
      return;
    }
    link.href = "#";
    link.textContent = "Sign Out";
    link.dataset.en = "Sign Out";
    link.dataset.hi = "साइन आउट";
    link.setAttribute("aria-label", "Sign out of your ZENURA IGNITE account");
    link.onclick = async event => {
      event.preventDefault();
      if (link.getAttribute("aria-busy") === "true") return;
      link.setAttribute("aria-busy", "true");
      try {
        await signOut(auth);
        signedOutLabel();
        window.location.href = "index.html";
      } catch (error) {
        link.removeAttribute("aria-busy");
        link.textContent = "Sign Out (retry)";
        console.error("Sign out failed", error);
      }
    };
  });
}
