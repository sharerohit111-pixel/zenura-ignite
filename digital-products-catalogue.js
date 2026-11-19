import { db } from "./firebase-client.js";
import { DEFAULT_DIGITAL_PRODUCTS } from "./digital-products-data.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const root = document.getElementById("digital-products-catalogue");
if (root) {
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? "");
    return node;
  };
  const safeUrl = value => {
    try {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (raw.startsWith("./") || raw.startsWith("/")) return raw;
      const url = new URL(raw);
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  };
  const image = (url, alt, className = "") => {
    const src = safeUrl(url);
    if (!src) return null;
    const node = document.createElement("img");
    node.src = src;
    node.alt = String(alt || "Product image");
    node.loading = "lazy";
    if (className) node.className = className;
    return node;
  };
  let activeEscapeHandler = null;
  const closeModal = () => {
    if (activeEscapeHandler) document.removeEventListener("keydown", activeEscapeHandler);
    activeEscapeHandler = null;
    document.getElementById("digital-product-modal")?.remove();
  };

  function showDetails(product) {
    closeModal();
    const backdrop = document.createElement("div");
    backdrop.id = "digital-product-modal";
    backdrop.className = "digital-product-modal";
    backdrop.setAttribute("role", "presentation");
    const dialog = document.createElement("section");
    dialog.className = "digital-product-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", product.name || "Product details");

    const header = document.createElement("header");
    header.className = "digital-product-dialog-head";
    const heading = document.createElement("div");
    heading.append(text("small", product.category || "ZENURA IGNITE PRODUCT", "digital-product-kicker"));
    heading.append(text("h2", product.name || "Product details"));
    if (product.subtitle) heading.append(text("p", product.subtitle, "digital-product-subtitle"));
    const close = text("button", "Close ✕", "digital-product-close");
    close.type = "button";
    close.addEventListener("click", closeModal);
    header.append(heading, close);
    dialog.append(header);

    const media = document.createElement("div");
    media.className = "digital-product-gallery";
    const urls = [product.imageUrl, ...(Array.isArray(product.gallery) ? product.gallery : [])]
      .map(safeUrl).filter(Boolean);
    urls.forEach((url, index) => {
      const item = image(url, (product.name || "Product") + " image " + (index + 1));
      if (item) media.append(item);
    });
    if (media.childElementCount) dialog.append(media);

    if (product.description) dialog.append(text("p", product.description, "digital-product-description"));
    if (product.details) dialog.append(text("p", product.details, "digital-product-full-details"));

    if (Array.isArray(product.features) && product.features.length) {
      const featureSection = document.createElement("section");
      featureSection.className = "digital-product-features";
      featureSection.append(text("h3", "Features"));
      const list = document.createElement("ul");
      product.features.forEach(feature => list.append(text("li", feature)));
      featureSection.append(list);
      dialog.append(featureSection);
    }
    if (Array.isArray(product.tags) && product.tags.length) {
      const tags = document.createElement("div");
      tags.className = "digital-product-tags";
      product.tags.forEach(tag => tags.append(text("span", tag)));
      dialog.append(tags);
    }
    const videoUrl = safeUrl(product.videoUrl);
    if (videoUrl) {
      const video = document.createElement("video");
      video.src = videoUrl;
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.className = "digital-product-video";
      dialog.append(video);
    }
    const websiteUrl = safeUrl(product.websiteUrl);
    if (websiteUrl) {
      const link = text("a", "Visit product website ↗", "digital-product-visit");
      link.href = websiteUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      dialog.append(link);
    }
    backdrop.append(dialog);
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) closeModal();
    });
    activeEscapeHandler = event => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", activeEscapeHandler);
    document.body.append(backdrop);
    close.focus();
  }

  function render(products) {
    root.replaceChildren();
    const visible = products.filter(product => product && product.visible !== false);
    if (!visible.length) {
      root.append(text("p", "No published digital products are available right now.", "digital-products-empty"));
      return;
    }
    const grid = document.createElement("div");
    grid.className = "digital-products-grid";
    visible.forEach(product => {
      const card = document.createElement("article");
      card.className = "digital-product-card";
      const media = document.createElement("div");
      media.className = "digital-product-card-media";
      const cover = image(product.imageUrl || product.gallery?.[0], product.name || "Product cover");
      if (cover) media.append(cover);
      else media.append(text("span", "✦", "digital-product-placeholder"));
      card.append(media);
      const body = document.createElement("div");
      body.className = "digital-product-card-body";
      body.append(text("small", product.category || "DIGITAL PRODUCT", "digital-product-kicker"));
      body.append(text("h3", product.name || "Untitled product"));
      if (product.subtitle) body.append(text("p", product.subtitle, "digital-product-subtitle"));
      if (product.description) body.append(text("p", product.description, "digital-product-description"));
      if (Array.isArray(product.features) && product.features.length) {
        const list = document.createElement("ul");
        product.features.slice(0, 3).forEach(feature => list.append(text("li", feature)));
        body.append(list);
      }
      const button = text("button", "View details & features ↗", "digital-product-details-button");
      button.type = "button";
      button.addEventListener("click", () => showDetails(product));
      body.append(button);
      card.append(body);
      grid.append(card);
    });
    root.append(grid);
  }

  async function load() {
    try {
      const snapshot = await getDoc(doc(db, "publicCatalog", "digitalProducts"));
      if (!snapshot.exists() || snapshot.data().published !== true || !Array.isArray(snapshot.data().products)) {
        render(DEFAULT_DIGITAL_PRODUCTS);
        return;
      }
      render(snapshot.data().products);
    } catch (error) {
      render(DEFAULT_DIGITAL_PRODUCTS);
      console.warn("Using built-in Product Samples because the published catalogue is unavailable.", error);
    }
  }
  load();
}
