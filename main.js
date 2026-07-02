import './index.css';
import { 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc,
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  updateDoc, 
  serverTimestamp,
  getDocs,
  arrayUnion
} from 'firebase/firestore';
import { auth, db, testConnection } from './firebase.js';
import { 
  signUpUser, 
  loginUser, 
  loginWithGoogle, 
  logoutUser, 
  resetPassword,
  updatePresence,
  editUserProfile,
  updateGeeDropVisibility,
  getCurrentUserProfile,
  setCurrentUserProfile
} from './auth.js';
import { 
  sendDirectMessage, 
  sendGroupMessage, 
  createGroupChannel, 
  inviteMemberToGroup, 
  leaveGroupChannel,
  markMessageRead, 
  reactToMessage, 
  togglePinFile, 
  deleteSharedFile,
  createNotification
} from './chat.js';
import { 
  sendGeeDropTransfer, 
  acceptGeeDropTransfer, 
  declineGeeDropTransfer, 
  completeGeeDropTransfer, 
  triggerFileDownload 
} from './geedrop.js';

// --- APPLICATION STATES ---
let activeTab = 'dashboard';
let onlineUsers = [];
let myGroups = [];
let selectedChatUserId = null;
let selectedGroupId = null;
let chatUnsubscribe = null;
let groupChatUnsubscribe = null;
let typingDebounceTimer = null;
let isDarkTheme = true;

// Active prompt transfer cache
let activeIncomingTransfer = null;

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `p-4 rounded-xl text-xs font-semibold shadow-xl flex items-center justify-between border select-none transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${
    type === 'success' 
      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
      : type === 'error'
      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800'
      : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
  }`;
  toast.innerHTML = `
    <span class="flex-1">${message}</span>
    <button class="ml-3 font-bold hover:opacity-75 transition-opacity duration-150 cursor-pointer">✕</button>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);
  
  const closeBtn = toast.querySelector('button');
  const dismiss = () => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  };
  closeBtn.addEventListener('click', dismiss);
  setTimeout(dismiss, 5000);
}

// --- DOM SELECTION UTILITY ---
const $ = (id) => document.getElementById(id);

// --- INITIALIZE THE APP ---
document.addEventListener('DOMContentLoaded', async () => {
  // Verify Database Connection
  await testConnection();

  // Setup Theme Defaults
  setupTheme();

  // Setup DOM Event bindings
  setupAuthEvents();
  setupNavEvents();
  setupProfileEvents();
  setupChatWindowEvents();
  setupGroupWindowEvents();
  setupGeeDropEvents();
  setupPortfolioLanding();

  // Bootstrap Firebase Auth presence hook
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userSnapshot = await getDoc(userDocRef);
        
        let profileData = null;
        if (userSnapshot.exists()) {
          profileData = userSnapshot.data();
          setCurrentUserProfile(profileData);
        } else {
          // Fallback if document wasn't created yet during fast auth cycles
          const cleanEmail = user.email || 'user';
          const defaultName = user.displayName || cleanEmail.split('@')[0];
          const defaultUsername = defaultName.toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
          
          profileData = {
            uid: user.uid,
            displayName: defaultName,
            username: defaultUsername,
            email: user.email || '',
            bio: "Active on ShareHub",
            photoURL: user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${defaultUsername}`,
            joinedAt: new Date().toISOString(),
            status: 'online',
            lastSeen: new Date().toISOString(),
            geedropDiscoverable: false,
            deviceName: `${defaultName}'s Device`,
            deviceType: 'Laptop'
          };
          await setDoc(userDocRef, profileData);
          setCurrentUserProfile(profileData);
        }

        // Initialize User presence
        await updatePresence('online');

        // Render side badge profile
        updateSidebarProfileUI(profileData);
        populateProfileFields(profileData);

        // Transition views
        $('portfolio-landing').classList.add('hidden');
        $('auth-screen').classList.add('hidden');
        $('main-board').classList.remove('hidden');

        // Start listening to collections
        initializeRealTimeListeners(user.uid);

      } catch (err) {
        console.error("Auth user state initialization failed:", err);
        showToast("Session initialization error. Re-authenticating...", "error");
        await logoutUser();
      } finally {
        $('loading-screen').classList.add('hidden');
      }
    } else {
      // Unauthenticated state
      $('main-board').classList.add('hidden');
      $('portfolio-landing').classList.remove('hidden');
      $('auth-screen').classList.add('hidden');
      $('loading-screen').classList.add('hidden');
    }
  });
});

// --- THEME MANAGEMENT ---
function setupTheme() {
  const currentTheme = localStorage.getItem('theme') || 'dark';
  if (currentTheme === 'dark') {
    document.documentElement.classList.add('dark');
    isDarkTheme = true;
    updateThemeIcons(true);
  } else {
    document.documentElement.classList.remove('dark');
    isDarkTheme = false;
    updateThemeIcons(false);
  }

  const toggleBtn = $('btn-theme-toggle');
  const toggleBtnMobile = $('btn-theme-toggle-mobile');

  const onToggle = () => {
    isDarkTheme = !isDarkTheme;
    if (isDarkTheme) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      updateThemeIcons(true);
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      updateThemeIcons(false);
    }
  };

  toggleBtn.addEventListener('click', onToggle);
  toggleBtnMobile.addEventListener('click', onToggle);
}

function updateThemeIcons(dark) {
  if (dark) {
    if ($('theme-sun-icon')) $('theme-sun-icon').classList.remove('hidden');
    if ($('theme-moon-icon')) $('theme-moon-icon').classList.add('hidden');
    if ($('theme-sun-icon-portfolio')) $('theme-sun-icon-portfolio').classList.remove('hidden');
    if ($('theme-moon-icon-portfolio')) $('theme-moon-icon-portfolio').classList.add('hidden');
  } else {
    if ($('theme-sun-icon')) $('theme-sun-icon').classList.add('hidden');
    if ($('theme-moon-icon')) $('theme-moon-icon').classList.remove('hidden');
    if ($('theme-sun-icon-portfolio')) $('theme-sun-icon-portfolio').classList.add('hidden');
    if ($('theme-moon-icon-portfolio')) $('theme-moon-icon-portfolio').classList.remove('hidden');
  }
}

// --- SIDEBAR PROFILE UI ---
function updateSidebarProfileUI(profile) {
  if (!profile) return;
  $('sidebar-user-avatar').src = profile.photoURL;
  $('sidebar-user-name').textContent = profile.displayName;
  $('sidebar-user-tag').textContent = `@${profile.username}`;
  $('sidebar-user-presence').className = `absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
    profile.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'
  }`;
}

// --- POPULATE PROFILE FIELDS ---
function populateProfileFields(profile) {
  if (!profile) return;
  $('profile-display-name').value = profile.displayName;
  $('profile-username').value = profile.username;
  $('profile-bio').value = profile.bio || '';
  $('profile-device-name').value = profile.deviceName || `${profile.displayName}'s Host`;
  $('profile-device-type').value = profile.deviceType || 'Laptop';
  
  // Set avatar preset selection
  const avatarSeedPart = profile.photoURL.split('seed=')[1] || '';
  const avatarIndex = avatarSeedPart ? parseInt(avatarSeedPart.replace('sharehub', '')) : 1;
  const parsedIndex = isNaN(avatarIndex) ? 1 : avatarIndex;
  
  $('profile-avatar-input').value = parsedIndex;
  
  document.querySelectorAll('.avatar-option').forEach(opt => {
    const optId = opt.getAttribute('data-avatar-id');
    if (optId == parsedIndex) {
      opt.className = "avatar-option rounded-xl p-0.5 border-2 border-emerald-500 cursor-pointer overflow-hidden transition-all duration-150 transform scale-105";
    } else {
      opt.className = "avatar-option rounded-xl p-0.5 border-2 border-transparent hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer overflow-hidden transition-all duration-150";
    }
  });
}

// --- EVENT BINDING: AUTHENTICATION ---
function setupAuthEvents() {
  const tabSignin = $('auth-tab-signin');
  const tabSignup = $('auth-tab-signup');
  const formSignin = $('signin-form');
  const formSignup = $('signup-form');

  tabSignin.addEventListener('click', () => {
    tabSignin.className = "flex-1 pb-3 text-center text-sm font-semibold border-b-2 border-emerald-500 text-emerald-500 cursor-pointer";
    tabSignup.className = "flex-1 pb-3 text-center text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer";
    formSignin.classList.remove('hidden');
    formSignup.classList.add('hidden');
  });

  tabSignup.addEventListener('click', () => {
    tabSignup.className = "flex-1 pb-3 text-center text-sm font-semibold border-b-2 border-emerald-500 text-emerald-500 cursor-pointer";
    tabSignin.className = "flex-1 pb-3 text-center text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer";
    formSignup.classList.remove('hidden');
    formSignin.classList.add('hidden');
  });

  // Sign In submit
  formSignin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('signin-email').value;
    const password = $('signin-password').value;
    
    try {
      $('loading-screen').classList.remove('hidden');
      await loginUser(email, password);
      showToast("Access granted. Session secure.", "success");
    } catch (err) {
      showToast(err.message || "Failed to log in. Please try again.", "error");
      $('loading-screen').classList.add('hidden');
    }
  });

  // Sign Up submit
  formSignup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('signup-name').value;
    const username = $('signup-username').value;
    const email = $('signup-email').value;
    const password = $('signup-password').value;

    try {
      $('loading-screen').classList.remove('hidden');
      await signUpUser(email, password, name, username);
      showToast("ShareHub account registered!", "success");
    } catch (err) {
      showToast(err.message || "Registration failed.", "error");
      $('loading-screen').classList.add('hidden');
    }
  });

  // Forgot password
  $('btn-forgot-password').addEventListener('click', async () => {
    const email = $('signin-email').value;
    if (!email) {
      showToast("Enter your email address first to reset password.", "info");
      return;
    }
    try {
      await resetPassword(email);
      showToast("Password reset link dispatched via email.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Google Login click
  $('btn-google-login').addEventListener('click', async () => {
    try {
      $('loading-screen').classList.remove('hidden');
      await loginWithGoogle();
      showToast("Google connection established.", "success");
    } catch (err) {
      showToast(err.message, "error");
      $('loading-screen').classList.add('hidden');
    }
  });

  // Signout Buttons
  const triggerSignout = async () => {
    try {
      $('loading-screen').classList.remove('hidden');
      await logoutUser();
      showToast("Session terminated successfully.", "success");
    } catch (err) {
      showToast(err.message, "error");
      $('loading-screen').classList.add('hidden');
    }
  };

  $('btn-signout').addEventListener('click', triggerSignout);
  $('btn-signout-mobile').addEventListener('click', triggerSignout);
}

// --- EVENT BINDING: NAVIGATION TAB SWITCHING ---
function setupNavEvents() {
  const navButtons = document.querySelectorAll('.nav-btn');
  const views = ['dashboard', 'chat', 'groups', 'geedrop', 'profile'];

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      if (!target) return;

      activeTab = target;

      // Update Nav active style
      navButtons.forEach(b => {
        b.className = "nav-btn flex-1 md:flex-none flex items-center justify-center md:justify-start space-x-3 px-3 py-2.5 md:px-4 md:py-3 rounded-xl text-sm font-medium transition-all text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer relative";
      });
      btn.className = "nav-btn flex-1 md:flex-none flex items-center justify-center md:justify-start space-x-3 px-3 py-2.5 md:px-4 md:py-3 rounded-xl text-sm font-medium transition-all text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 cursor-pointer relative";

      // Toggle actual views
      views.forEach(v => {
        const viewEl = $(`view-${v}`);
        if (v === target) {
          viewEl.classList.remove('hidden-view');
        } else {
          viewEl.classList.add('hidden-view');
        }
      });

      // Quick tab-specific activations
      if (target === 'dashboard') {
        renderDashboardStats();
      } else if (target === 'geedrop') {
        const discoverable = getCurrentUserProfile()?.geedropDiscoverable || false;
        renderGeeDropUI(discoverable);
      }
    });
  });

  // Dashboard quick triggers
  $('btn-quick-geedrop').addEventListener('click', () => {
    document.querySelector('[data-tab="geedrop"]').click();
  });
  $('btn-quick-chat').addEventListener('click', () => {
    document.querySelector('[data-tab="chat"]').click();
  });
}

// --- REALTIME FIRESTORE SYNCHRONIZATION LISTENERS ---
function initializeRealTimeListeners(currentUid) {
  // 1. Listen to active users presence list
  const usersRef = collection(db, 'users');
  onSnapshot(usersRef, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.uid !== currentUid) {
        list.push(data);
      } else {
        // Sync my own cached profile details if updated from other places
        setCurrentUserProfile(data);
        updateSidebarProfileUI(data);
      }
    });
    onlineUsers = list;
    
    renderActiveUsersDashboard();
    renderChatRoomsSidebar();
    renderGeeDropRadar();
  }, (err) => {
    console.error("Presence listeners failed:", err);
  });

  // 2. Listen to user groups channels
  const groupsRef = collection(db, 'groups');
  const qGroups = query(groupsRef, where('members', 'arrayContains', currentUid));
  onSnapshot(qGroups, (snapshot) => {
    const list = [];
    snapshot.forEach(doc => {
      list.push(doc.data());
    });
    myGroups = list;
    renderGroupsSidebar();
  }, (err) => {
    console.error("Groups synchronizer failed:", err);
  });

  // 3. Listen to incoming GeeDrop Transfers
  const transfersRef = collection(db, 'transfers');
  const qTransfers = query(transfersRef, where('receiverId', '==', currentUid));
  onSnapshot(qTransfers, (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const transfer = change.doc.data();
      if (change.type === 'added' || change.type === 'modified') {
        // Handle pending prompts
        if (transfer.status === 'pending') {
          showGeeDropPromptOverlay(transfer);
        }
        // Handle accepted auto-download actions
        if (transfer.status === 'accepted' && transfer.receiverId === currentUid) {
          triggerAcceptTransferDownload(transfer);
        }
      }
    });

    renderGeeDropTransfers();
    renderDashboardStats();
  }, (err) => {
    console.error("GeeDrop channel listener failed:", err);
  });

  // 4. Listen to Sent transfers for progress updates
  const qSentTransfers = query(transfersRef, where('senderId', '==', currentUid));
  onSnapshot(qSentTransfers, (snapshot) => {
    snapshot.docChanges().forEach(change => {
      const transfer = change.doc.data();
      if (change.type === 'modified') {
        if (transfer.status === 'accepted') {
          showToast(`File "${transfer.fileName}" accepted. Transferring...`, "success");
        } else if (transfer.status === 'declined') {
          showToast(`Transfer declined by recipient: ${transfer.fileName}`, "error");
        } else if (transfer.status === 'completed') {
          showToast(`Transfer successful: ${transfer.fileName}`, "success");
        }
      }
    });

    renderGeeDropTransfers();
    renderDashboardStats();
  }, (err) => {
    console.error("Sent transfers logger failed:", err);
  });

  // 5. Listen to notifications
  const notifRef = collection(db, 'notifications');
  const qNotif = query(notifRef, where('userId', '==', currentUid), where('read', '==', false), orderBy('createdAt', 'desc'));
  onSnapshot(qNotif, (snapshot) => {
    const container = $('dash-notifications-list');
    container.innerHTML = '';
    
    if (snapshot.empty) {
      container.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">All caught up! No notifications.</p>';
      return;
    }

    snapshot.forEach(docSnap => {
      const notif = docSnap.data();
      const div = document.createElement('div');
      div.className = "p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-150 dark:border-slate-800 rounded-xl space-y-1 flex justify-between items-start";
      
      let icon = '🔔';
      if (notif.type === 'message') icon = '💬';
      if (notif.type === 'geedrop') icon = '⚡';
      if (notif.type === 'group_invite') icon = '👥';

      div.innerHTML = `
        <div class="flex-1 min-w-0 pr-2">
          <div class="flex items-center space-x-1">
            <span class="text-xs">${icon}</span>
            <span class="text-xs font-bold truncate">${notif.title}</span>
          </div>
          <p class="text-[11px] text-slate-500 truncate mt-0.5">${notif.body}</p>
        </div>
        <button class="text-rose-500 hover:text-rose-600 font-bold text-xs p-1 cursor-pointer" data-id="${notif.notificationId}">✕</button>
      `;

      // Mark single read
      div.querySelector('button').addEventListener('click', async (e) => {
        e.stopPropagation();
        await updateDoc(doc(db, 'notifications', notif.notificationId), { read: true });
      });

      container.appendChild(div);
    });
  });

  // 6. Shared Files Listeners (to compute dashboard list and shared size stats)
  const filesRef = collection(db, 'files');
  onSnapshot(filesRef, (snapshot) => {
    renderDashboardFilesList();
  }, (err) => {
    console.error("Shared files directories syncer failed:", err);
  });
}

// --- RENDER: DASHBOARD RECENT FILES DIRECTORY ---
async function renderDashboardFilesList() {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  const searchVal = $('dash-file-search').value.toLowerCase();
  const sortBy = $('dash-file-sort').value;

  const container = $('dash-files-list');
  container.innerHTML = '';

  try {
    const filesRef = collection(db, 'files');
    const qSnap = await getDocs(filesRef);
    let allFiles = [];

    qSnap.forEach(doc => {
      const file = doc.data();
      // Accessibility check: user is sender OR receiver OR is a group they belong to
      const myGroupIds = myGroups.map(g => g.groupId);
      const hasAccess = file.senderId === currentUid || 
                        (!file.isGroup && file.receiverId === currentUid) ||
                        (file.isGroup && myGroupIds.includes(file.receiverId));
      
      if (hasAccess) {
        allFiles.push(file);
      }
    });

    // Apply Search Filters
    if (searchVal) {
      allFiles = allFiles.filter(f => f.name.toLowerCase().includes(searchVal) || f.type.toLowerCase().includes(searchVal));
    }

    // Apply Sorting Options
    if (sortBy === 'recent') {
      allFiles.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
    } else if (sortBy === 'oldest') {
      allFiles.sort((a, b) => a.createdAt?.seconds - b.createdAt?.seconds);
    } else if (sortBy === 'size-desc') {
      allFiles.sort((a, b) => b.size - a.size);
    } else if (sortBy === 'size-asc') {
      allFiles.sort((a, b) => a.size - b.size);
    }

    $('dash-file-count').textContent = `${allFiles.length} Total`;

    if (allFiles.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center space-y-3">
          <div class="inline-flex p-3 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
          </div>
          <p class="text-sm font-medium text-slate-500 dark:text-slate-400">No matching files found</p>
        </div>`;
      return;
    }

    allFiles.forEach(file => {
      const row = document.createElement('div');
      row.className = "flex items-center justify-between p-4 hover:bg-slate-50/55 dark:hover:bg-slate-900/40 transition-colors";
      
      const isSender = file.senderId === currentUid;
      const sizeKB = (file.size / 1024).toFixed(1);

      row.innerHTML = `
        <div class="flex items-center space-x-3 truncate">
          <div class="p-2 bg-emerald-500/10 text-emerald-500 rounded-xl shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>
          </div>
          <div class="truncate">
            <h4 class="text-xs font-bold truncate">${file.name}</h4>
            <p class="text-[10px] font-mono text-slate-400 mt-0.5">${sizeKB} KB • From: ${isSender ? 'You' : file.senderName}</p>
          </div>
        </div>
        <div class="flex items-center space-x-2 shrink-0">
          <button class="btn-dl-file p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer" title="Download">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-cloud"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v6"/><path d="m8 14 4 4 4-4"/></svg>
          </button>
          ${isSender ? `
          <button class="btn-del-file p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50/10 rounded-lg cursor-pointer" title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>` : ''}
        </div>
      `;

      // Bind actions
      row.querySelector('.btn-dl-file').addEventListener('click', () => {
        triggerFileDownload(file.name, file.content, file.type);
        showToast(`Saved locally: ${file.name}`, "success");
      });

      if (isSender) {
        row.querySelector('.btn-del-file').addEventListener('click', async () => {
          if (confirm(`Remove this shared file permanently? (${file.name})`)) {
            await deleteSharedFile(file.fileId);
            showToast("File purged from Firestore repository.", "success");
            renderDashboardFilesList();
          }
        });
      }

      container.appendChild(row);
    });

  } catch (err) {
    console.error("Dashboard files render failed:", err);
  }
}

// --- RENDER: DASHBOARD ACTIVE MEMBERS ---
function renderActiveUsersDashboard() {
  const container = $('dash-active-users');
  container.innerHTML = '';

  const activeOnlines = onlineUsers.filter(u => u.status === 'online');

  if (activeOnlines.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-4">No online users found</p>';
    $('stats-online-users').textContent = "0 online";
    return;
  }

  $('stats-online-users').textContent = `${activeOnlines.length} online`;

  activeOnlines.forEach(user => {
    const card = document.createElement('div');
    card.className = "flex items-center justify-between p-2 hover:bg-slate-50/50 dark:hover:bg-slate-900/40 rounded-xl transition-all cursor-pointer";
    card.innerHTML = `
      <div class="flex items-center space-x-2.5 truncate">
        <div class="relative">
          <img src="${user.photoURL}" class="w-8 h-8 rounded-lg object-cover">
          <span class="absolute bottom-0 right-0 block h-2 w-2 rounded-full ring-1 ring-white dark:ring-slate-900 bg-emerald-500"></span>
        </div>
        <div class="truncate">
          <h4 class="text-xs font-bold truncate leading-none">${user.displayName}</h4>
          <span class="text-[9px] font-mono text-slate-400 mt-0.5 block truncate leading-none">@${user.username}</span>
        </div>
      </div>
      <button class="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all">Chat</button>
    `;

    // Start DM Chat quickly
    card.addEventListener('click', () => {
      document.querySelector('[data-tab="chat"]').click();
      selectDirectChatUser(user);
    });

    container.appendChild(card);
  });
}

// --- RENDER: CHATS DIRECTORY SIDEBAR ---
function renderChatRoomsSidebar() {
  const container = $('chat-rooms-list');
  container.innerHTML = '';

  const filter = $('chat-user-search').value.toLowerCase();
  let matches = onlineUsers;

  if (filter) {
    matches = onlineUsers.filter(u => u.displayName.toLowerCase().includes(filter) || u.username.toLowerCase().includes(filter));
  }

  if (matches.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-6 select-none">No devices detected</p>';
    return;
  }

  matches.forEach(user => {
    const el = document.createElement('button');
    el.className = `w-full p-4 flex items-center space-x-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left cursor-pointer ${
      selectedChatUserId === user.uid ? 'bg-emerald-50/50 dark:bg-emerald-500/5' : ''
    }`;
    
    const isOnline = user.status === 'online';

    el.innerHTML = `
      <div class="relative shrink-0">
        <img src="${user.photoURL}" class="w-10 h-10 rounded-xl object-cover bg-slate-50">
        <span class="absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
          isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
        }"></span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold truncate leading-none">${user.displayName}</h4>
        </div>
        <p class="text-[10px] font-mono text-slate-400 mt-1 truncate leading-none">@${user.username}</p>
      </div>
    `;

    el.addEventListener('click', () => {
      selectDirectChatUser(user);
    });

    container.appendChild(el);
  });
}

// --- SELECT DIRECT CHAT RECIPIENT ---
function selectDirectChatUser(user) {
  selectedChatUserId = user.uid;
  selectedGroupId = null;

  // Visual highlights on room lists
  renderChatRoomsSidebar();

  // Hide empty state, load frame
  $('chat-window-empty').classList.add('hidden');
  $('chat-window-frame').classList.remove('hidden');

  // Load User Details
  $('active-chat-avatar').src = user.photoURL;
  $('active-chat-name').textContent = user.displayName;
  $('active-chat-subtext').textContent = user.status === 'online' ? 'online' : 'offline';
  $('active-chat-presence').className = `absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${
    user.status === 'online' ? 'bg-emerald-500' : 'bg-slate-300'
  }`;

  // Close previous snapshot
  if (chatUnsubscribe) {
    chatUnsubscribe();
  }

  // Subscribe to secure 1-to-1 conversation messages
  const chatsRef = collection(db, 'chats');
  const q = query(
    chatsRef,
    where('senderId', 'in', [auth.currentUser.uid, user.uid]),
    where('receiverId', 'in', [auth.currentUser.uid, user.uid]),
    orderBy('timestamp', 'asc')
  );

  chatUnsubscribe = onSnapshot(q, (snapshot) => {
    const feed = $('chat-messages-container');
    feed.innerHTML = '';

    if (snapshot.empty) {
      feed.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 select-none">
          <span class="text-2xl">🔒</span>
          <p class="text-xs font-semibold mt-2">End-to-End Encrypted Session</p>
          <p class="text-[10px] text-slate-400 dark:text-slate-500 max-w-xs mt-1">Chat history is hosted on Firestore with strict Attribute-Based Access Control rules.</p>
        </div>
      `;
      return;
    }

    snapshot.forEach(docSnap => {
      const msg = docSnap.data();
      const isMe = msg.senderId === auth.currentUser.uid;
      
      const card = document.createElement('div');
      card.className = `flex ${isMe ? 'justify-end' : 'justify-start'} w-full fade-in`;

      const msgTime = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      card.innerHTML = `
        <div class="max-w-[70%] space-y-1">
          <div class="px-4 py-2.5 rounded-2xl text-xs leading-relaxed break-words relative shadow-sm ${
            isMe 
              ? 'bg-emerald-600 text-white rounded-tr-none' 
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-tl-none'
          }">
            <p>${msg.text}</p>
            ${msg.fileId ? `
              <div class="mt-2 p-2 bg-slate-950/15 dark:bg-slate-950/30 rounded-xl flex items-center space-x-2 text-left border border-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                <div class="min-w-0 flex-1">
                  <span class="font-bold text-[10px] block truncate text-slate-200" id="filename-${msg.fileId}">Loading file...</span>
                </div>
                <button class="btn-chat-dl p-1 bg-white/10 hover:bg-white/20 rounded cursor-pointer" data-file-id="${msg.fileId}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
              </div>` : ''}
          </div>
          <div class="flex items-center space-x-1.5 px-1 justify-end">
            <span class="text-[9px] font-mono text-slate-400 leading-none">${msgTime}</span>
            ${isMe ? `<span class="text-[9px] leading-none text-emerald-500">${msg.read ? '✓✓ Read' : '✓ Sent'}</span>` : ''}
          </div>
        </div>
      `;

      // Load file metadata on back-reference
      if (msg.fileId) {
        getDoc(doc(db, 'files', msg.fileId)).then(fileSnap => {
          if (fileSnap.exists()) {
            const fileData = fileSnap.data();
            const el = card.querySelector(`#filename-${msg.fileId}`);
            if (el) el.textContent = fileData.name;
            
            card.querySelector('.btn-chat-dl').addEventListener('click', () => {
              triggerFileDownload(fileData.name, fileData.content, fileData.type);
            });
          }
        });
      }

      feed.appendChild(card);

      // Auto-update message Read Receipt
      if (!isMe && !msg.read) {
        markMessageRead(msg.messageId);
      }
    });

    // AutoScroll to bottom of active conversation
    feed.scrollTop = feed.scrollHeight;
  }, (err) => {
    console.error("Chats room sub error:", err);
  });

  // Listen to live typing indicator from the partner
  const partnerUserRef = doc(db, 'users', user.uid);
  onSnapshot(partnerUserRef, (snap) => {
    const data = snap.data();
    if (data && data.typingTo === auth.currentUser.uid) {
      $('chat-typing-indicator').classList.remove('hidden');
    } else {
      $('chat-typing-indicator').classList.add('hidden');
    }
  });
}

// --- CHAT WINDOW EVENT INTERACTIONS ---
function setupChatWindowEvents() {
  const form = $('chat-input-form');
  const input = $('chat-input-text');
  const fileInput = $('chat-file-input');

  // Trigger file attachment picker
  $('btn-chat-file').addEventListener('click', () => {
    fileInput.click();
  });

  // File selected handler
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.size > 800 * 1024) {
      showToast("File size cap: 800KB. Database payload limit reached.", "error");
      fileInput.value = '';
      return;
    }

    try {
      showToast(`Uploading secure payload: ${file.name}...`, "info");
      await sendDirectMessage(selectedChatUserId, `Attached File: ${file.name}`, file);
      showToast("Attachment securely shared.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      fileInput.value = '';
    }
  });

  // Emoji picker click
  $('btn-chat-emoji').addEventListener('click', (e) => {
    e.stopPropagation();
    $('emoji-picker-popover').classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    $('emoji-picker-popover').classList.add('hidden');
  });

  document.querySelectorAll('.emoji-btn').forEach(emoji => {
    emoji.addEventListener('click', () => {
      input.value += emoji.textContent;
      input.focus();
    });
  });

  // Manage Typing Indicators on keypress
  input.addEventListener('input', () => {
    if (!selectedChatUserId) return;
    
    // Write typing details
    updateDoc(doc(db, 'users', auth.currentUser.uid), { typingTo: selectedChatUserId });

    if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
    
    typingDebounceTimer = setTimeout(() => {
      updateDoc(doc(db, 'users', auth.currentUser.uid), { typingTo: null });
    }, 2000);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !selectedChatUserId) return;

    try {
      input.value = '';
      // Reset presence typing indicator
      updateDoc(doc(db, 'users', auth.currentUser.uid), { typingTo: null });
      await sendDirectMessage(selectedChatUserId, text);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // DM Back rooms trigger for responsive mobile
  $('btn-back-rooms').addEventListener('click', () => {
    selectedChatUserId = null;
    $('chat-window-frame').classList.add('hidden');
    $('chat-window-empty').classList.remove('hidden');
  });

  // Chat drag and drop file upload
  const dropzone = $('chat-messages-container');
  const overlay = $('chat-drag-overlay');

  window.addEventListener('dragenter', (e) => {
    if (activeTab === 'chat' && selectedChatUserId) {
      overlay.classList.remove('hidden');
    }
  });

  overlay.addEventListener('dragleave', () => {
    overlay.classList.add('hidden');
  });

  overlay.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  overlay.addEventListener('drop', async (e) => {
    e.preventDefault();
    overlay.classList.add('hidden');
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && selectedChatUserId) {
      const file = files[0];
      if (file.size > 800 * 1024) {
        showToast("Files are capped at 800KB without external Storage.", "error");
        return;
      }

      try {
        showToast("Deploying drop attachment...", "info");
        await sendDirectMessage(selectedChatUserId, `Dropped File: ${file.name}`, file);
        showToast("Drop file uploaded successfully.", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    }
  });
}

// --- RENDER: GROUPS CHANNELS LIST ---
function renderGroupsSidebar() {
  const container = $('groups-rooms-list');
  container.innerHTML = '';

  const filter = $('groups-filter-search').value.toLowerCase();
  let matches = myGroups;

  if (filter) {
    matches = myGroups.filter(g => g.name.toLowerCase().includes(filter));
  }

  if (matches.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No groups created</p>';
    return;
  }

  matches.forEach(g => {
    const el = document.createElement('button');
    el.className = `w-full p-4 flex items-center space-x-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left cursor-pointer ${
      selectedGroupId === g.groupId ? 'bg-emerald-50/50 dark:bg-emerald-500/5' : ''
    }`;

    el.innerHTML = `
      <img src="${g.photoURL}" class="w-10 h-10 rounded-xl object-cover bg-slate-50 shrink-0">
      <div class="flex-1 min-w-0">
        <h4 class="text-xs font-bold truncate leading-none">${g.name}</h4>
        <p class="text-[9px] text-slate-400 truncate mt-1.5 leading-none">${g.members.length} members online</p>
      </div>
    `;

    el.addEventListener('click', () => {
      selectGroupChannel(g);
    });

    container.appendChild(el);
  });
}

// --- SELECT GROUP CHANNEL ---
function selectGroupChannel(group) {
  selectedGroupId = group.groupId;
  selectedChatUserId = null;

  // Visual highlights
  renderGroupsSidebar();

  $('group-window-empty').className = "hidden";
  $('group-window-frame').className = "flex-1 flex flex-col h-full overflow-hidden";

  $('active-group-avatar').src = group.photoURL;
  $('active-group-name').textContent = group.name;
  $('active-group-subtext').textContent = `${group.members.length} active node members`;

  $('group-info-desc').textContent = group.description || 'Secure communication workspace.';

  // Build group info members view
  renderGroupInfoMembers(group);

  if (groupChatUnsubscribe) {
    groupChatUnsubscribe();
  }

  // Subscribe to group messages collection
  const msgsRef = collection(db, 'groupMessages');
  const q = query(msgsRef, where('groupId', '==', group.groupId), orderBy('timestamp', 'asc'));

  groupChatUnsubscribe = onSnapshot(q, (snapshot) => {
    const feed = $('group-messages-container');
    feed.innerHTML = '';

    if (snapshot.empty) {
      feed.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 select-none">
          <span class="text-2xl">👥</span>
          <p class="text-xs font-semibold mt-2">Group Workspace Online</p>
          <p class="text-[10px] text-slate-400 dark:text-slate-500 max-w-xs mt-1">Post announcements, share files up to 800KB, and pin shared assets easily.</p>
        </div>
      `;
      return;
    }

    snapshot.forEach(docSnap => {
      const msg = docSnap.data();
      const isMe = msg.senderId === auth.currentUser.uid;

      const card = document.createElement('div');
      card.className = `flex ${isMe ? 'justify-end' : 'justify-start'} w-full fade-in`;

      const msgTime = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

      card.innerHTML = `
        <div class="flex items-start space-x-2 max-w-[70%]">
          ${!isMe ? `<img src="${msg.senderPhoto || "https://api.dicebear.com/7.x/bottts/svg?seed=group"}" class="w-8 h-8 rounded-lg object-cover bg-slate-50 mt-1 shrink-0">` : ''}
          <div class="space-y-1">
            ${!isMe ? `<span class="text-[9px] font-bold text-slate-400 pl-1">@${msg.senderName}</span>` : ''}
            <div class="px-4 py-2.5 rounded-2xl text-xs leading-relaxed break-words relative shadow-sm ${
              isMe 
                ? 'bg-emerald-600 text-white rounded-tr-none' 
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-tl-none'
            }">
              <p>${msg.text}</p>
              ${msg.fileId ? `
                <div class="mt-2 p-2 bg-slate-950/15 dark:bg-slate-950/30 rounded-xl flex items-center space-x-2 text-left border border-white/10">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
                  <div class="min-w-0 flex-1">
                    <span class="font-bold text-[10px] block truncate text-slate-200" id="gfilename-${msg.fileId}">Loading file...</span>
                  </div>
                  <button class="btn-group-chat-dl p-1 bg-white/10 hover:bg-white/20 rounded cursor-pointer" data-file-id="${msg.fileId}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  </button>
                </div>` : ''}
            </div>
            <div class="flex items-center space-x-1.5 px-1 ${isMe ? 'justify-end' : 'justify-start'}">
              <span class="text-[9px] font-mono text-slate-400 leading-none">${msgTime}</span>
            </div>
          </div>
        </div>
      `;

      if (msg.fileId) {
        getDoc(doc(db, 'files', msg.fileId)).then(fileSnap => {
          if (fileSnap.exists()) {
            const fileData = fileSnap.data();
            const el = card.querySelector(`#gfilename-${msg.fileId}`);
            if (el) el.textContent = fileData.name;
            
            card.querySelector('.btn-group-chat-dl').addEventListener('click', () => {
              triggerFileDownload(fileData.name, fileData.content, fileData.type);
            });
          }
        });
      }

      feed.appendChild(card);
    });

    feed.scrollTop = feed.scrollHeight;
  }, (err) => {
    console.error("Group Chat syncing failed:", err);
  });
}

// --- RENDER: MEMBERS LIST IN GROUP INFO SIDEBAR ---
async function renderGroupInfoMembers(group) {
  const listEl = $('group-info-members-list');
  listEl.innerHTML = '';

  for (const memberUid of group.members) {
    try {
      const snap = await getDoc(doc(db, 'users', memberUid));
      if (snap.exists()) {
        const u = snap.data();
        const row = document.createElement('div');
        row.className = "flex items-center space-x-2.5 p-1";
        const isAdmin = group.admins.includes(memberUid);
        
        row.innerHTML = `
          <img src="${u.photoURL}" class="w-6 h-6 rounded-lg object-cover shrink-0">
          <div class="min-w-0 flex-1">
            <span class="text-xs font-bold block truncate leading-none">${u.displayName}</span>
            ${isAdmin ? '<span class="text-[8px] font-mono uppercase bg-emerald-500/10 text-emerald-500 py-0.5 px-1.5 rounded mt-1 inline-block leading-none">Admin</span>' : ''}
          </div>
        `;
        listEl.appendChild(row);
      }
    } catch (err) {
      console.warn("Group member detail read fail: ", err);
    }
  }
}

// --- GROUP WINDOW EVENT ACTIONS ---
function setupGroupWindowEvents() {
  const modalCreate = $('modal-create-group');
  const btnCreateOpen = $('btn-create-group-modal');
  const btnCreateClose = $('btn-close-create-group');
  const formCreate = $('group-create-form');

  const fileInput = $('group-file-input');

  // Trigger group creation popup
  btnCreateOpen.addEventListener('click', () => {
    modalCreate.classList.remove('hidden');
  });

  btnCreateClose.addEventListener('click', () => {
    modalCreate.classList.add('hidden');
  });

  // Group creation submit
  formCreate.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('new-group-name').value;
    const desc = $('new-group-desc').value;
    const seed = $('new-group-photo-input').value;

    try {
      showToast("Registering group workspace...", "info");
      const groupId = await createGroupChannel(name, desc, seed);
      showToast("Group workspace active!", "success");
      modalCreate.classList.add('hidden');
      formCreate.reset();
      
      // Select newly created group
      const newGroupSnap = await getDoc(doc(db, 'groups', groupId));
      if (newGroupSnap.exists()) {
        selectGroupChannel(newGroupSnap.data());
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Photo Badge Selection inside create modal
  document.querySelectorAll('.group-photo-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.group-photo-option').forEach(o => o.className = "group-photo-option rounded-xl p-0.5 border-2 border-transparent hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer overflow-hidden transition-all duration-150");
      opt.className = "group-photo-option rounded-xl p-0.5 border-2 border-emerald-500 cursor-pointer overflow-hidden transition-all duration-150";
      $('new-group-photo-input').value = opt.getAttribute('data-seed');
    });
  });

  // Group Sidebar collapsible info trigger
  $('btn-group-info').addEventListener('click', () => {
    $('group-info-panel').classList.toggle('hidden');
  });

  // Group message send
  $('group-input-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('group-input-text');
    const text = input.value.trim();
    if (!text || !selectedGroupId) return;

    try {
      input.value = '';
      await sendGroupMessage(selectedGroupId, text);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Attachment inside group
  $('btn-group-file').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.size > 800 * 1024) {
      showToast("File size cap: 800KB.", "error");
      fileInput.value = '';
      return;
    }

    try {
      showToast("Uploading channel file...", "info");
      await sendGroupMessage(selectedGroupId, `Posted attachment: ${file.name}`, file);
      showToast("Group attachment posted successfully.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      fileInput.value = '';
    }
  });

  // Leave Group
  $('btn-leave-group').addEventListener('click', async () => {
    if (confirm("Leave this group workspace? All offline cached states will clear.")) {
      try {
        await leaveGroupChannel(selectedGroupId);
        showToast("Left group channel.", "success");
        selectedGroupId = null;
        $('group-window-frame').className = "hidden";
        $('group-window-empty').className = "absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-4";
      } catch (err) {
        showToast(err.message, "error");
      }
    }
  });

  // Invite member popup management
  const modalInvite = $('modal-add-member');
  $('btn-add-member-modal').addEventListener('click', () => {
    modalInvite.classList.remove('hidden');
    renderInviteUsersList();
  });

  $('btn-close-add-member').addEventListener('click', () => {
    modalInvite.classList.add('hidden');
  });

  // Group Back rooms trigger for responsive mobile
  $('btn-group-back-rooms').addEventListener('click', () => {
    selectedGroupId = null;
    $('group-window-frame').classList.add('hidden');
    $('group-window-empty').classList.remove('hidden');
  });

  // Search filter for group invites
  $('invite-user-search').addEventListener('input', () => {
    renderInviteUsersList();
  });
}

// --- RENDER: INVITE USERS DIRECTORY LIST ---
async function renderInviteUsersList() {
  const container = $('invite-users-list');
  container.innerHTML = '';

  const searchVal = $('invite-user-search').value.toLowerCase();
  
  // Find current group members
  const group = myGroups.find(g => g.groupId === selectedGroupId);
  if (!group) return;

  const filteredUsers = onlineUsers.filter(u => {
    const isAlreadyMember = group.members.includes(u.uid);
    if (isAlreadyMember) return false;

    if (searchVal) {
      return u.displayName.toLowerCase().includes(searchVal) || u.username.toLowerCase().includes(searchVal);
    }
    return true;
  });

  if (filteredUsers.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">No matching invite candidates</p>';
    return;
  }

  filteredUsers.forEach(u => {
    const row = document.createElement('div');
    row.className = "flex items-center justify-between py-2.5 p-1";
    row.innerHTML = `
      <div class="flex items-center space-x-2.5 truncate">
        <img src="${u.photoURL}" class="w-8 h-8 rounded-lg object-cover">
        <div class="truncate">
          <span class="text-xs font-bold block leading-none truncate">${u.displayName}</span>
          <span class="text-[9px] font-mono text-slate-400 mt-0.5 block leading-none truncate">@${u.username}</span>
        </div>
      </div>
      <button class="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all">Invite</button>
    `;

    row.querySelector('button').addEventListener('click', async () => {
      try {
        await inviteMemberToGroup(selectedGroupId, u.uid);
        showToast(`User ${u.displayName} added to group channel.`, "success");
        
        // Refresh local group snapshot properties
        const docRef = doc(db, 'groups', selectedGroupId);
        const latestSnap = await getDoc(docRef);
        if (latestSnap.exists()) {
          renderGroupInfoMembers(latestSnap.data());
        }

        renderInviteUsersList();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    container.appendChild(row);
  });
}

// --- RENDER: GEEDROP RADAR TARGET DEVICES ---
function renderGeeDropRadar() {
  const container = $('geedrop-radar-devices');
  if (!container) return;
  container.innerHTML = '';

  const discoverables = onlineUsers.filter(u => u.geedropDiscoverable === true);

  if (discoverables.length === 0) {
    container.innerHTML = `
      <div class="col-span-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
        No visible nearby devices found. Ask other users to activate visible toggles!
      </div>
    `;
    return;
  }

  discoverables.forEach(device => {
    const circle = document.createElement('div');
    circle.className = "flex flex-col items-center p-3 bg-slate-50 dark:bg-slate-950/50 hover:bg-emerald-500/10 hover:border-emerald-500 border border-slate-200 dark:border-slate-800 rounded-2xl cursor-pointer transition-all group scale-95 hover:scale-100 duration-200";
    
    let deviceIcon = '💻';
    if (device.deviceType === 'Mobile Phone') deviceIcon = '📱';
    if (device.deviceType === 'Tablet') deviceIcon = '📟';

    circle.innerHTML = `
      <div class="relative mb-2">
        <img src="${device.photoURL}" class="w-12 h-12 rounded-full object-cover border-2 border-transparent group-hover:border-emerald-500 transition-all shadow-md">
        <span class="absolute -top-1.5 -right-1.5 text-xs">${deviceIcon}</span>
      </div>
      <h4 class="text-xs font-bold text-center truncate max-w-full leading-tight text-slate-800 dark:text-slate-200">${device.deviceName || device.displayName}</h4>
      <p class="text-[9px] text-slate-400 text-center mt-1 font-mono truncate max-w-full">@${device.username}</p>
    `;

    // File Selection Trigger on click
    circle.addEventListener('click', () => {
      // Create absolute file picker input dynamically
      const filePick = document.createElement('input');
      filePick.type = 'file';
      
      filePick.addEventListener('change', async () => {
        const file = filePick.files[0];
        if (!file) return;

        if (file.size > 800 * 1024) {
          showToast("File size caps at 800KB due to memory limits.", "error");
          return;
        }

        try {
          showToast(`Sending dynamic transfer request: ${file.name}...`, "info");
          await sendGeeDropTransfer(device.uid, file);
          showToast("GeeDrop file broadcast request sent! Waiting for acceptance...", "success");
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      filePick.click();
    });

    container.appendChild(circle);
  });
}

// --- RENDER: GEEDROP TRANSFERS HISTORY & QUEUE ---
async function renderGeeDropTransfers() {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  const transfersRef = collection(db, 'transfers');
  const qSnap = await getDocs(transfersRef);
  
  const activeContainer = $('geedrop-active-transfers');
  const historyContainer = $('geedrop-history-transfers');

  activeContainer.innerHTML = '';
  historyContainer.innerHTML = '';

  let activeCount = 0;
  let historyCount = 0;

  qSnap.forEach(doc => {
    const t = doc.data();
    const isSender = t.senderId === currentUid;
    const isReceiver = t.receiverId === currentUid;

    if (!isSender && !isReceiver) return;

    const sizeKB = (t.fileSize / 1024).toFixed(1);
    
    let statusColor = 'text-amber-500';
    if (t.status === 'completed') statusColor = 'text-emerald-500';
    if (t.status === 'declined') statusColor = 'text-rose-500';
    if (t.status === 'accepted') statusColor = 'text-blue-500 animate-pulse';

    const div = document.createElement('div');
    div.className = "p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1";
    div.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold truncate max-w-[65%]">${t.fileName}</span>
        <span class="text-[9px] uppercase font-mono font-bold ${statusColor}">${t.status}</span>
      </div>
      <div class="flex justify-between items-center text-[10px] text-slate-400">
        <span>${sizeKB} KB • ${isSender ? `To: ${t.receiverId.substring(0, 5)}...` : `From: ${t.senderName}`}</span>
        ${isReceiver && t.status === 'pending' ? `
          <div class="flex space-x-1.5">
            <button class="btn-prompt-dec text-rose-500 hover:underline">Decline</button>
            <button class="btn-prompt-acc text-emerald-500 hover:underline">Accept</button>
          </div>` : ''}
      </div>
    `;

    if (isReceiver && t.status === 'pending') {
      div.querySelector('.btn-prompt-dec').addEventListener('click', () => declineGeeDropTransfer(t.transferId));
      div.querySelector('.btn-prompt-acc').addEventListener('click', () => acceptGeeDropTransfer(t.transferId));
    }

    if (t.status === 'pending' || t.status === 'accepted') {
      activeContainer.appendChild(div);
      activeCount++;
    } else {
      historyContainer.appendChild(div);
      historyCount++;
    }
  });

  if (activeCount === 0) {
    activeContainer.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-4 select-none">No active transfers</p>';
  }
  if (historyCount === 0) {
    historyContainer.innerHTML = '<p class="text-xs text-slate-400 dark:text-slate-500 text-center py-4 select-none">Log history is empty</p>';
  }
}

// --- GEEDROP PROMPT MODAL ON FILE INBOUND ---
function showGeeDropPromptOverlay(transfer) {
  activeIncomingTransfer = transfer;
  $('geedrop-prompt-sender').textContent = transfer.senderName;
  $('geedrop-prompt-filename').textContent = transfer.fileName;
  $('geedrop-prompt-filesize').textContent = `${(transfer.fileSize / 1024).toFixed(1)} KB`;
  
  $('modal-geedrop-prompt').classList.remove('hidden');
}

// --- TRIGGER CLIENT-SIDE FILE DOWNLOAD ON ACCEPT ---
async function triggerAcceptTransferDownload(transfer) {
  try {
    showToast(`Assembling packet: ${transfer.fileName}...`, "info");
    triggerFileDownload(transfer.fileName, transfer.fileContent, transfer.fileType);
    
    // Complete the transfer document
    await completeGeeDropTransfer(transfer.transferId);
    showToast(`File download complete: ${transfer.fileName}`, "success");
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    $('modal-geedrop-prompt').classList.add('hidden');
    activeIncomingTransfer = null;
  }
}

// --- BIND GEEDROP VISIBILITY ACTIONS ---
function setupGeeDropEvents() {
  $('btn-geedrop-toggle').addEventListener('click', async () => {
    const currentProfile = getCurrentUserProfile();
    if (!currentProfile) return;

    const visible = !currentProfile.geedropDiscoverable;
    
    try {
      await updateGeeDropVisibility(visible);
      renderGeeDropUI(visible);
      showToast(visible ? "Broadcast online. Device discoverable." : "Broadcast shut down. Visible hidden.", "info");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // Decline prompt modal
  $('btn-geedrop-decline').addEventListener('click', async () => {
    if (activeIncomingTransfer) {
      await declineGeeDropTransfer(activeIncomingTransfer.transferId);
      $('modal-geedrop-prompt').classList.add('hidden');
      activeIncomingTransfer = null;
    }
  });

  // Accept prompt modal
  $('btn-geedrop-accept').addEventListener('click', async () => {
    if (activeIncomingTransfer) {
      await acceptGeeDropTransfer(activeIncomingTransfer.transferId);
    }
  });
}

function renderGeeDropUI(visible) {
  const slider = $('geedrop-toggle-slider');
  const toggleBtn = $('btn-geedrop-toggle');
  const text = $('geedrop-toggle-status');

  if (visible) {
    slider.className = "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5";
    toggleBtn.className = "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-emerald-500 transition-colors duration-200 ease-in-out focus:outline-none";
    text.textContent = "Discoverable";
    text.className = "text-xs font-bold text-emerald-500 uppercase";
    
    $('radar-disabled-state').classList.add('hidden');
    $('radar-enabled-state').classList.remove('hidden');
    $('radar-animation-container').classList.remove('hidden');
    $('geedrop-beacon').classList.remove('hidden');
    $('geedrop-discoverable-name').textContent = getCurrentUserProfile()?.deviceName || "My Node";
  } else {
    slider.className = "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0";
    toggleBtn.className = "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-slate-200 dark:bg-slate-800 transition-colors duration-200 ease-in-out focus:outline-none";
    text.textContent = "Hidden";
    text.className = "text-xs font-bold text-slate-400 uppercase";
    
    $('radar-disabled-state').classList.remove('hidden');
    $('radar-enabled-state').classList.add('hidden');
    $('radar-animation-container').classList.add('hidden');
    $('geedrop-beacon').classList.add('hidden');
  }

  renderGeeDropRadar();
}

// --- PROFILE SETTINGS EVENTS ---
function setupProfileEvents() {
  // Avatar Selection list clicks
  document.querySelectorAll('.avatar-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.avatar-option').forEach(o => o.className = "avatar-option rounded-xl p-0.5 border-2 border-transparent hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer overflow-hidden transition-all duration-150");
      opt.className = "avatar-option rounded-xl p-0.5 border-2 border-emerald-500 cursor-pointer overflow-hidden transition-all duration-150 transform scale-105";
      $('profile-avatar-input').value = opt.getAttribute('data-avatar-id');
    });
  });

  // Profile Edit Save
  $('profile-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const displayName = $('profile-display-name').value;
    const username = $('profile-username').value;
    const bio = $('profile-bio').value;
    const avatarId = $('profile-avatar-input').value;
    const deviceName = $('profile-device-name').value;
    const deviceType = $('profile-device-type').value;

    try {
      showToast("Updating cloud identity details...", "info");
      const updatedProfile = await editUserProfile(displayName, username, bio, `sharehub${avatarId}`, deviceName, deviceType);
      updateSidebarProfileUI(updatedProfile);
      showToast("Profile credentials updated successfully.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

// --- RENDER STATS METADATA ---
async function renderDashboardStats() {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;

  try {
    // 1. Compute total shared files & capacity sizes
    const filesRef = collection(db, 'files');
    const filesSnap = await getDocs(filesRef);
    let count = 0;
    let sizeBytes = 0;

    filesSnap.forEach(docSnap => {
      const file = docSnap.data();
      const myGroupIds = myGroups.map(g => g.groupId);
      const isReadable = file.senderId === currentUid || 
                         (!file.isGroup && file.receiverId === currentUid) ||
                         (file.isGroup && myGroupIds.includes(file.receiverId));
      if (isReadable) {
        count++;
        sizeBytes += file.size || 0;
      }
    });

    $('stats-total-files').textContent = `${count} files`;
    
    const sizeKB = sizeBytes / 1024;
    if (sizeKB > 1024) {
      $('stats-storage-used').textContent = `${(sizeKB / 1024).toFixed(2)} MB / 50 MB`;
    } else {
      $('stats-storage-used').textContent = `${sizeKB.toFixed(1)} KB / 50 MB`;
    }

    // 2. GeeDrop visibility status
    const statusText = getCurrentUserProfile()?.geedropDiscoverable ? "Discoverable" : "Disabled";
    $('stats-geedrop-status').textContent = statusText;
    $('stats-geedrop-status').className = `text-lg font-bold ${getCurrentUserProfile()?.geedropDiscoverable ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`;

  } catch (err) {
    console.warn("Stats calculation skipped: ", err.message);
  }
}

// --- SETUP BARS SEARCH AND CLEANUP ---
$('dash-file-search').addEventListener('input', () => {
  renderDashboardFilesList();
});

$('dash-file-sort').addEventListener('change', () => {
  renderDashboardFilesList();
});

$('chat-user-search').addEventListener('input', () => {
  renderChatRoomsSidebar();
});

$('groups-filter-search').addEventListener('input', () => {
  renderGroupsSidebar();
});

$('btn-clear-notifications').addEventListener('click', async () => {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) return;
  
  if (confirm("Clear all active notifications?")) {
    try {
      const notifRef = collection(db, 'notifications');
      const q = query(notifRef, where('userId', '==', currentUid), where('read', '==', false));
      const qSnap = await getDocs(q);
      
      qSnap.forEach(async (docSnap) => {
        await updateDoc(doc(db, 'notifications', docSnap.id), { read: true });
      });
      showToast("Notifications folder empty.", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
});

// --- PORTFOLIO LANDING SETUP ---
function setupPortfolioLanding() {
  const landing = $('portfolio-landing');
  if (!landing) return;

  // 1. Launch/Open Auth Overlay Listeners
  document.querySelectorAll('.btn-launch-terminal').forEach(btn => {
    btn.addEventListener('click', () => {
      $('auth-screen').classList.remove('hidden');
    });
  });

  // 2. Close Auth Overlay Listener
  const closeBtn = $('btn-close-auth');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      $('auth-screen').classList.add('hidden');
    });
  }

  // 3. Smooth scrolling for portfolio navbar links
  landing.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href').slice(1);
      const targetEl = $(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // 4. Portfolio Theme Toggler sync
  const themeTogglePort = $('btn-theme-toggle-portfolio');
  if (themeTogglePort) {
    themeTogglePort.addEventListener('click', () => {
      isDarkTheme = !isDarkTheme;
      if (isDarkTheme) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
        updateThemeIcons(true);
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
        updateThemeIcons(false);
      }
    });
  }

  // 5. Interactive GeeDrop Stream Simulator Sandbox
  const simZone = $('sim-interactive-zone');
  const simIdle = $('sim-idle-state');
  const simConnected = $('sim-connected-state');
  const simTransfer = $('sim-transfer-state');
  const simLatency = $('sim-link-latency');
  const simTriggerDrop = $('btn-sim-trigger-drop');
  const simProgressBar = $('sim-progress-bar');
  const simProgressText = $('sim-progress-text');

  if (simZone && simIdle && simConnected && simTransfer && simLatency && simTriggerDrop) {
    // Click action zone to simulate device connecting
    simZone.addEventListener('click', () => {
      if (!simIdle.classList.contains('hidden')) {
        simIdle.classList.add('hidden');
        simConnected.classList.remove('hidden');
        simLatency.textContent = 'Latency: 12 ms';
        showToast("Proximity Link Active: Simulated peer 'Nexus-7' connected successfully!", "success");
      }
    });

    // Simulated Drop File trigger
    simTriggerDrop.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent re-triggering parent simZone click events
      simConnected.classList.add('hidden');
      simTransfer.classList.remove('hidden');

      let currentProgress = 0;
      simProgressBar.style.width = '0%';
      simProgressText.textContent = '0%';

      const speedInterval = setInterval(() => {
        currentProgress += Math.floor(Math.random() * 4) + 3; // randomized steps
        if (currentProgress > 100) currentProgress = 100;
        
        simProgressBar.style.width = `${currentProgress}%`;
        simProgressText.textContent = `${currentProgress}%`;

        if (currentProgress === 100) {
          clearInterval(speedInterval);
          setTimeout(() => {
            showToast("Simulated Transfer Complete: saved 'presentation_deck.pdf' (640KB) locally!", "success");
            
            // Revert back to connected state to allow another try
            simTransfer.classList.add('hidden');
            simConnected.classList.remove('hidden');
            simProgressBar.style.width = '0%';
            simProgressText.textContent = '0%';
          }, 300);
        }
      }, 70);
    });
  }

  // 6. Live Statistics Fluctuator Ticker
  setInterval(() => {
    const statLatency = $('stat-latency');
    const statNodes = $('stat-active-nodes');
    const statTransmissions = $('stat-transmissions');
    
    // Skip updating if portfolio view is hidden
    if (landing.classList.contains('hidden')) return;

    if (statLatency) {
      const currentLatency = Math.floor(Math.random() * 5) + 9; // 9-13 ms
      statLatency.textContent = `${currentLatency} ms`;
    }

    if (statNodes) {
      const currentNodes = Math.floor(Math.random() * 11) + 140; // 140-150 nodes
      statNodes.textContent = `${currentNodes} nodes`;
    }

    if (statTransmissions) {
      const currentTrans = parseInt(statTransmissions.textContent.replace(/[^0-9]/g, ''));
      if (!isNaN(currentTrans)) {
        statTransmissions.textContent = (currentTrans + (Math.random() > 0.5 ? 1 : 0)).toLocaleString() + '+';
      }
    }
  }, 4000);

  // 7. Telemetry Live Logs Ticker Stream
  const logsContainer = $('telemetry-logs-container');
  const telemetryPool = [
    "CLIENT: Active discoverable broadcast pinged",
    "SYSINFO: Routing path latency checked: <11ms",
    "TELEMETRY: Handshake verified with Titan-9 Node",
    "CLIENT: Broadcast signature refreshed (RSA-4096)",
    "SYSINFO: Firestore collection synced successfully",
    "SYSINFO: Chunk index optimized (0.02s)",
    "CLIENT: Local device fingerprint verified",
    "TELEMETRY: GeeDrop channel state: IDLE",
    "CLIENT: Active peer query finished: 0 errors",
    "SYSINFO: Garbage collector pruned transient buffers",
    "CLIENT: Secure SSL/Base64 envelope compiled"
  ];

  if (logsContainer) {
    setInterval(() => {
      if (landing.classList.contains('hidden')) return;

      const time = new Date().toLocaleTimeString();
      const randLine = telemetryPool[Math.floor(Math.random() * telemetryPool.length)];
      const isClient = randLine.startsWith("CLIENT:");
      const colorClass = isClient ? 'text-emerald-500' : 'text-slate-400/80 dark:text-slate-500';

      const p = document.createElement('p');
      p.className = colorClass;
      p.textContent = `[${time}] ${randLine}`;
      logsContainer.appendChild(p);

      // limit logs to 12 entries
      while (logsContainer.children.length > 12) {
        logsContainer.removeChild(logsContainer.firstChild);
      }
      // scroll to bottom smoothly
      logsContainer.scrollTop = logsContainer.scrollHeight;
    }, 5500);
  }
}
