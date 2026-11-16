// ZENURA IGNITE TECHNOLOGIES — Firebase Web App configuration.
// This client configuration is public by design. Never place service-account keys here.
export const firebaseConfig = {
  apiKey: "AIzaSyAtZbXMqxT_G3Bars_u85c2JigjGidP4zc",
  authDomain: "zenura-ignite-technologies.firebaseapp.com",
  projectId: "zenura-ignite-technologies",
  storageBucket: "zenura-ignite-technologies.firebasestorage.app",
  messagingSenderId: "963568165217",
  appId: "1:963568165217:web:04721d87c30a183ac0e520",
  measurementId: "G-3K1636YV19"
};
export const ADMIN_EMAIL = "sharerohit111@gmail.com";
export const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
