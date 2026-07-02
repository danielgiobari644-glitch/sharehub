import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc, 
  serverTimestamp,
  collection,
  query,
  where,
  getDocs
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase.js';

// Google OAuth Provider
const googleProvider = new GoogleAuthProvider();

// Current User profile document cache
let currentUserProfile = null;

export function getCurrentUserProfile() {
  return currentUserProfile;
}

export function setCurrentUserProfile(profile) {
  currentUserProfile = profile;
}

/**
 * Generate a clean username from a name or email
 */
function cleanUsername(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 30) + Math.floor(Math.random() * 1000);
}

/**
 * Sign up a new user with email, password, and custom details
 */
export async function signUpUser(email, password, fullName, username) {
  try {
    // 1. Check if username is already taken
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '==', username.trim().toLowerCase()));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
      throw new Error("Username is already taken by another device.");
    }

    // 2. Create user with Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // 3. Setup Firestore user profile
    const profilePath = `users/${user.uid}`;
    const userProfile = {
      uid: user.uid,
      displayName: fullName.trim(),
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      bio: "Sharing files on ShareHub!",
      photoURL: "https://api.dicebear.com/7.x/bottts/svg?seed=" + cleanUsername(fullName),
      joinedAt: serverTimestamp(),
      status: 'online',
      lastSeen: serverTimestamp(),
      geedropDiscoverable: false,
      deviceName: `${fullName}'s Terminal`,
      deviceType: 'Laptop'
    };

    await setDoc(doc(db, 'users', user.uid), userProfile);
    currentUserProfile = userProfile;
    return user;
  } catch (error) {
    console.error("Sign Up Error: ", error);
    throw error;
  }
}

/**
 * Login user with email and password
 */
export async function loginUser(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    console.error("Login Error: ", error);
    throw error;
  }
}

/**
 * Reset password via email
 */
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error("Password Reset Error: ", error);
    throw error;
  }
}

/**
 * Google Single Sign-On flow with default profile creation
 */
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    // Check if user already exists in Firestore
    const userDocRef = doc(db, 'users', user.uid);
    const userSnapshot = await getDoc(userDocRef);

    if (!userSnapshot.exists()) {
      // Create profile with Google credentials
      const generatedUsername = cleanUsername(user.displayName || user.email || "hubuser");
      const userProfile = {
        uid: user.uid,
        displayName: user.displayName || "Anonymous User",
        username: generatedUsername,
        email: user.email,
        bio: "Connected via Google Auth",
        photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${generatedUsername}`,
        joinedAt: serverTimestamp(),
        status: 'online',
        lastSeen: serverTimestamp(),
        geedropDiscoverable: false,
        deviceName: `${user.displayName || 'ShareHub'}'s Device`,
        deviceType: 'Laptop'
      };

      await setDoc(userDocRef, userProfile);
      currentUserProfile = userProfile;
    } else {
      currentUserProfile = userSnapshot.data();
      // Set to online
      await updatePresence('online');
    }
    return user;
  } catch (error) {
    console.error("Google Auth Error: ", error);
    throw error;
  }
}

/**
 * Update real-time Presence status
 */
export async function updatePresence(status) {
  if (!auth.currentUser) return;
  try {
    const userDocRef = doc(db, 'users', auth.currentUser.uid);
    const updates = {
      status: status,
      lastSeen: serverTimestamp()
    };
    await updateDoc(userDocRef, updates);
    if (currentUserProfile) {
      currentUserProfile.status = status;
    }
  } catch (error) {
    console.warn("Presence Sync skipped: ", error.message);
  }
}

/**
 * Edit User Settings details
 */
export async function editUserProfile(displayName, username, bio, photoSeed, deviceName, deviceType) {
  if (!auth.currentUser) throw new Error("Unauthenticated write request blocked.");
  const path = `users/${auth.currentUser.uid}`;
  try {
    // Check username uniqueness if they changed it
    if (username.trim().toLowerCase() !== currentUserProfile.username) {
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', username.trim().toLowerCase()));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        throw new Error("This username is already occupied by another node.");
      }
    }

    const userDocRef = doc(db, 'users', auth.currentUser.uid);
    const updates = {
      displayName: displayName.trim(),
      username: username.trim().toLowerCase(),
      bio: bio.trim(),
      photoURL: `https://api.dicebear.com/7.x/bottts/svg?seed=${photoSeed}`,
      deviceName: deviceName.trim(),
      deviceType: deviceType,
      lastSeen: serverTimestamp()
    };

    await updateDoc(userDocRef, updates);
    currentUserProfile = { ...currentUserProfile, ...updates };
    return currentUserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Update Discoverability status for GeeDrop
 */
export async function updateGeeDropVisibility(visible) {
  if (!auth.currentUser) return;
  const path = `users/${auth.currentUser.uid}`;
  try {
    const userDocRef = doc(db, 'users', auth.currentUser.uid);
    await updateDoc(userDocRef, {
      geedropDiscoverable: visible,
      lastSeen: serverTimestamp()
    });
    if (currentUserProfile) {
      currentUserProfile.geedropDiscoverable = visible;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Safe logout and clean presence
 */
export async function logoutUser() {
  try {
    await updatePresence('offline');
    await signOut(auth);
    currentUserProfile = null;
  } catch (error) {
    console.error("Sign Out Error: ", error);
    throw error;
  }
}
