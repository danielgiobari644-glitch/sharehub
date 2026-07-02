import { 
  collection, 
  doc, 
  addDoc, 
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query, 
  where, 
  orderBy, 
  limit, 
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase.js';

/**
 * Utility: Convert a browser file to a Base64 string
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

/**
 * 1. Send 1-on-1 Direct Message (with optional attachment)
 */
export async function sendDirectMessage(receiverId, text, file = null, replyTo = null) {
  if (!auth.currentUser) throw new Error("Unauthenticated write request.");
  
  const messageId = doc(collection(db, 'chats')).id;
  const path = `chats/${messageId}`;
  
  try {
    let fileId = null;

    // Handle File Attachment
    if (file) {
      if (file.size > 800 * 1024) {
        throw new Error("File size exceeds 800KB limit for database-direct file sharing.");
      }

      const base64Data = await fileToBase64(file);
      fileId = doc(collection(db, 'files')).id;
      
      const filePayload = {
        fileId: fileId,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        senderId: auth.currentUser.uid,
        senderName: auth.currentUser.displayName || "Unknown Node",
        receiverId: receiverId,
        isGroup: false,
        content: base64Data,
        createdAt: serverTimestamp(),
        pinned: false
      };

      await setDoc(doc(db, 'files', fileId), filePayload);
    }

    const messagePayload = {
      messageId: messageId,
      senderId: auth.currentUser.uid,
      receiverId: receiverId,
      text: text.trim() || (file ? `Shared a file: ${file.name}` : ''),
      timestamp: serverTimestamp(),
      read: false,
      delivered: true
    };

    if (fileId) messagePayload.fileId = fileId;
    if (replyTo) messagePayload.replyTo = replyTo;

    await setDoc(doc(db, 'chats', messageId), messagePayload);

    // Create Notification for the receiver
    await createNotification(
      receiverId, 
      "New Direct Message", 
      `${auth.currentUser.displayName || 'Someone'}: ${messagePayload.text.substring(0, 50)}`, 
      'message', 
      messageId
    );

    return messageId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * 2. Send Group Channel Message (with optional attachment)
 */
export async function sendGroupMessage(groupId, text, file = null) {
  if (!auth.currentUser) throw new Error("Unauthenticated write request.");
  
  const messageId = doc(collection(db, 'groupMessages')).id;
  const path = `groupMessages/${messageId}`;

  try {
    let fileId = null;

    if (file) {
      if (file.size > 800 * 1024) {
        throw new Error("File size exceeds 800KB limit for database-direct file sharing.");
      }

      const base64Data = await fileToBase64(file);
      fileId = doc(collection(db, 'files')).id;
      
      const filePayload = {
        fileId: fileId,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        senderId: auth.currentUser.uid,
        senderName: auth.currentUser.displayName || "Unknown",
        receiverId: groupId,
        isGroup: true,
        content: base64Data,
        createdAt: serverTimestamp(),
        pinned: false
      };

      await setDoc(doc(db, 'files', fileId), filePayload);
    }

    const messagePayload = {
      messageId: messageId,
      groupId: groupId,
      senderId: auth.currentUser.uid,
      senderName: auth.currentUser.displayName || "Unknown User",
      senderPhoto: auth.currentUser.photoURL || "",
      text: text.trim() || (file ? `Shared a file: ${file.name}` : ''),
      timestamp: serverTimestamp()
    };

    if (fileId) messagePayload.fileId = fileId;

    await setDoc(doc(db, 'groupMessages', messageId), messagePayload);
    return messageId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * 3. Create Group Channel
 */
export async function createGroupChannel(name, description, photoSeed) {
  if (!auth.currentUser) throw new Error("Unauthenticated group creation.");
  const groupId = doc(collection(db, 'groups')).id;
  const path = `groups/${groupId}`;

  try {
    const payload = {
      groupId: groupId,
      name: name.trim(),
      description: description.trim() || "No description specified.",
      photoURL: `https://api.dicebear.com/7.x/identicon/svg?seed=${photoSeed}`,
      createdBy: auth.currentUser.uid,
      createdAt: serverTimestamp(),
      members: [auth.currentUser.uid],
      admins: [auth.currentUser.uid]
    };

    await setDoc(doc(db, 'groups', groupId), payload);
    return groupId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * 4. Invite member to group
 */
export async function inviteMemberToGroup(groupId, memberUid) {
  const path = `groups/${groupId}`;
  try {
    const groupDocRef = doc(db, 'groups', groupId);
    await updateDoc(groupDocRef, {
      members: arrayUnion(memberUid)
    });

    // Notify user
    await createNotification(
      memberUid,
      "Group Invitation",
      `You have been added to a group channel!`,
      'group_invite',
      groupId
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 5. Leave group channel
 */
export async function leaveGroupChannel(groupId) {
  const path = `groups/${groupId}`;
  try {
    const groupDocRef = doc(db, 'groups', groupId);
    await updateDoc(groupDocRef, {
      members: arrayRemove(auth.currentUser.uid),
      admins: arrayRemove(auth.currentUser.uid)
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 6. Mark message as Read
 */
export async function markMessageRead(messageId) {
  const path = `chats/${messageId}`;
  try {
    const chatDocRef = doc(db, 'chats', messageId);
    await updateDoc(chatDocRef, { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 7. Reaction to messages
 */
export async function reactToMessage(messageId, reaction) {
  const path = `chats/${messageId}`;
  try {
    const chatDocRef = doc(db, 'chats', messageId);
    await updateDoc(chatDocRef, { reaction: reaction });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 8. Pin/unpin a shared file
 */
export async function togglePinFile(fileId, pinned) {
  const path = `files/${fileId}`;
  try {
    const fileDocRef = doc(db, 'files', fileId);
    await updateDoc(fileDocRef, { pinned: pinned });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 9. Delete files
 */
export async function deleteSharedFile(fileId) {
  const path = `files/${fileId}`;
  try {
    await deleteDoc(doc(db, 'files', fileId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * 10. Create Real-Time notifications
 */
export async function createNotification(userId, title, body, type, relatedId = "") {
  const notifId = doc(collection(db, 'notifications')).id;
  const path = `notifications/${notifId}`;
  try {
    const payload = {
      notificationId: notifId,
      userId: userId,
      title: title,
      body: body,
      type: type,
      relatedId: relatedId,
      read: false,
      createdAt: serverTimestamp()
    };
    await setDoc(doc(db, 'notifications', notifId), payload);
    return notifId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
