import { isFirebaseConfigured } from "./firebase-config.js";

const form = document.getElementById("form");
if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const enquiry = {
      name: String(data.get("name") || "").trim(),
      reply: String(data.get("reply") || "").trim(),
      projectType: String(data.get("projectType") || "").trim(),
      budget: String(data.get("budget") || "").trim(),
      message: String(data.get("message") || "").trim()
    };

    const button = form.querySelector('button[type="submit"], button:not([type])');
    const original = button?.textContent || "Submit Enquiry ↗";
    if (button) { button.disabled = true; button.textContent = "Submitting…"; }

    const openEmailDraft = () => {
      const subject = encodeURIComponent("Project enquiry — ZENURA IGNITE TECHNOLOGIES");
      const body = encodeURIComponent(
        "Name: " + enquiry.name + "\nEmail or phone: " + enquiry.reply +
        "\nService: " + enquiry.projectType + "\nEstimated budget: " +
        enquiry.budget + "\nProject details: " + enquiry.message
      );
      window.location.href = "mailto:zenuraignite@gmail.com?subject=" + subject + "&body=" + body;
    };

    try {
      if (!isFirebaseConfigured()) {
        openEmailDraft();
        return;
      }
      const [{ db }, { addDoc, collection, serverTimestamp }] = await Promise.all([
        import("./firebase-client.js"),
        import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js")
      ]);
      await addDoc(collection(db, "enquiries"), {
        ...enquiry, status: "new", createdAt: serverTimestamp()
      });
      form.reset();
      alert("Thank you! Your enquiry has been submitted successfully.");
    } catch (error) {
      console.error("ZENURA enquiry submission failed:", error);
      alert("Online saving is not available right now. Your filled enquiry will open in your email app so you can send it.");
      openEmailDraft();
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  });
}
