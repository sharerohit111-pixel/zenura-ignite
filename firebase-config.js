// Fill this file with the Web App configuration from the separate ZENURA Firebase project.
// Firebase client config is not a password. Never put service-account keys or private keys here.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: ""
};
export const ADMIN_EMAIL = "sharerohit111@gmail.com";
export const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
