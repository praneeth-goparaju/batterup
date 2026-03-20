import { initializeApp } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, where } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDXWkwoDZaTyjb1mh3hHaHMmdin1RGG4fU",
  authDomain: "batter-automations.firebaseapp.com",
  projectId: "batter-automations",
  storageBucket: "batter-automations.firebasestorage.app",
  messagingSenderId: "495832925688",
  appId: "1:495832925688:web:af65def00c947688aec20d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({})
});

// Re-export Firebase utilities used by other modules
export { GoogleAuthProvider, signInWithPopup, fbSignOut, onAuthStateChanged };
export { collection, doc, addDoc, getDocs, getDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, where };

export const ICON_EDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
export const ICON_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>`;

export const DELIVERY_FEE = 2;

export const rmUnitOpts = '<option value="kg">kg</option><option value="grams">grams</option><option value="liters">liters</option><option value="ml">ml</option><option value="pieces">pieces</option>';

export const state = {
  products: [],
  customers: [],
  allOrders: [],
  optimizedRoute: null,
  cachedConfig: null,
  formDirty: false,
  editingOrderId: null,
  editingProductId: null,
  editingCustomerId: null,
  fullOrdersLoaded: false,
  _drStops: null,
  _homeEditId: null,
};
