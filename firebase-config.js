// firebase-config.js — paste your Firebase web-app keys below
// (Firebase Console > Project settings > Your apps > Web app > SDK config)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_d0vCHuxLlbrvrqXCYdfH063JqsfXSQs",
  authDomain: "motolola-c69f6.firebaseapp.com",
  projectId: "motolola-c69f6",
  storageBucket: "motolola-c69f6.firebasestorage.app",
  messagingSenderId: "709064905843",
  appId: "1:709064905843:web:366a01659cedd69d39c606",
  measurementId: "G-TJ52PDKMVV"
};

// EmailJS (https://www.emailjs.com) — create a service + template, then paste IDs.
// Template variables used: {{to_email}}, {{booking_id}}, {{customer}}, {{bike}}, {{service}}, {{date}}, {{payment}}, {{notes}}
export const emailjsConfig = {
  publicKey: "_zhleolBx5BkMd5jd",
  serviceId: "service_7md8q2e",
  templateId: "template_kjllvka",
  adminEmail: "timmothygerona@gmail.com"
};

export const configured = !firebaseConfig.apiKey.startsWith("PASTE");
const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app && getAuth(app);
export const db = app && getFirestore(app);
export const storage = app && getStorage(app);

/* Suggested Firestore rules (Firebase Console > Firestore > Rules):
rules_version = '2';
service cloud.firestore { match /databases/{d}/documents {
  function isAdmin(){ return request.auth != null &&
    get(/databases/$(d)/documents/users/$(request.auth.uid)).data.role == "admin"; }
  match /{col}/{id} {
    allow read: if col in ["services","motors","parts","accomplishments","bookings"];
    allow create: if col in ["bookings","messages"];
    allow write: if isAdmin();
    allow read: if isAdmin();
  }
  match /users/{uid} { allow read: if request.auth.uid == uid; }
}}
To make an admin: create the user in Authentication, then add a Firestore doc users/<uid> with { role: "admin" }.
*/
