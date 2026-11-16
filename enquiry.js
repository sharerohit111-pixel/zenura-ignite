import { isFirebaseConfigured } from "./firebase-config.js";

const form = document.getElementById("form");
if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const enquiry = {
      name: String(data.get("name") || "").trim(),
      reply: String(data.get("reply") || "").trim(),
      projectType: String(data.get("projectType") || "").trim(),
      budget: String(data.get("budget") || "").trim(),
      message: String(data.get("message") || "").trim()
    };
    const button = form.querySelector('button[type="submit"], button:not([type])');
    const original = button?.textContent || "Prepare Enquiry ↗";
    if (button) { button.disabled = true; button.textContent = "Submitting…"; }

    try {
      if (isFirebaseConfigured()) {
        const [{ db }, { addDoc, collection, serverTimestamp }] = await Promise.all([
          import("./firebase-client.js"),
          import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js")
        ]);
        await addDoc(collection(db, "enquiries"), {
          ...enquiry, status: "new", createdAt: serverTimestamp()
        });
        form.reset();
        alert("Thank you! Your enquiry has been submitted successfully.");
      } else {
        const subject = encodeURIComponent("Project enquiry — ZENURA IGNITE TECHNOLOGIES");
        const body = encodeURIComponent(
          "Name: " + enquiry.name + "\nEmail or phone: " + enquiry.reply +
          "\nService: " + enquiry.projectType + "\nEstimated budget: " +
          enquiry.budget + "\nProject details: " + enquiry.message
        );
        window.location.href = "mailto:zenuraignite@gmail.com?subject=" + subject + "&body=" + body;
      }
    } catch (error) {
      console.error("ZENURA enquiry submission failed:", error);
      alert("Enquiry could not be saved. Please try again or email zenuraignite@gmail.com.");
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  });
}
