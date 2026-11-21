import { isFirebaseConfigured } from "./firebase-config.js";

const link = document.getElementById("account-nav-link");
const nav = document.getElementById("nav");
const adminLink = document.getElementById("admin-nav-link");
if (adminLink) adminLink.hidden = true;
if (link && nav && isFirebaseConfigured()) {
  let nameTag = document.getElementById("account-user-name");
  if (!nameTag) {
    nameTag = document.createElement("a");
    nameTag.id = "account-user-name";
    nameTag.className = "account-user-name";
    nameTag.href = "customer.html";
    nameTag.hidden = true;
    nameTag.textContent = "My Account";
    nav.insertBefore(nameTag, link);
  }

  const signedOutLabel = () => {
    nameTag.hidden = true;
    nameTag.textContent = "My Account";
    link.href = "customer.html";
    link.textContent = "Sign In";
    link.dataset.en = "Sign In";
    link.dataset.hi = "साइन इन";
    link.removeAttribute("aria-busy");
    link.onclick = null;
  };

  const [{ auth, db }, { onAuthStateChanged, signOut }, { doc, getDoc }] = await Promise.all([
    import("./firebase-client.js"),
    import("https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js")
  ]);

  onAuthStateChanged(auth, async user => {
    // The private admin entry is visible only to the verified owner account.
    if (adminLink) adminLink.hidden = !(user && user.emailVerified && user.email?.toLowerCase() === "sharerohit111@gmail.com");
    if (!user) {
      signedOutLabel();
      return;
    }
    let displayName = user.email?.toLowerCase() === "sharerohit111@gmail.com" ? "Administrator" : (user.displayName || "");
    try {
      const profile = await getDoc(doc(db, "customerProfiles", user.uid));
      if (profile.exists()) displayName = profile.data().displayName || displayName;
    } catch (error) {
      console.warn("Could not load customer display name", error);
    }
    nameTag.textContent = displayName ? `Hello, ${displayName}` : (user.email || "My Account");
    nameTag.hidden = false;
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
        console.error("Sign out failed", error);
      }
    };
  });
}
