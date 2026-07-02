import { 
  collection, 
  doc, 
  setDoc,
  updateDoc,
  deleteDoc,
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from './firebase.js';
import { fileToBase64, createNotification } from './chat.js';

/**
 * 1. Initiate a GeeDrop File Transfer
 */
export async function sendGeeDropTransfer(receiverId, file) {
  if (!auth.currentUser) throw new Error("Unauthenticated transfer request.");
  if (file.size > 800 * 1024) {
    throw new Error("GeeDrop transfers are restricted to 800KB due to database document size bounds.");
  }

  const transferId = doc(collection(db, 'transfers')).id;
  const path = `transfers/${transferId}`;

  try {
    const base64Content = await fileToBase64(file);

    const payload = {
      transferId: transferId,
      senderId: auth.currentUser.uid,
      senderName: auth.currentUser.displayName || "Unknown Node",
      receiverId: receiverId,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      fileContent: base64Content,
      status: 'pending',
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, 'transfers', transferId), payload);

    // Notify the receiver immediately
    await createNotification(
      receiverId,
      "GeeDrop Transfer Invitation",
      `${auth.currentUser.displayName || 'Nearby user'} sent you a file: ${file.name}`,
      'geedrop',
      transferId
    );

    return transferId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * 2. Accept GeeDrop Transfer and download on the receiver's device
 */
export async function acceptGeeDropTransfer(transferId) {
  const path = `transfers/${transferId}`;
  try {
    const transferDocRef = doc(db, 'transfers', transferId);
    await updateDoc(transferDocRef, {
      status: 'accepted'
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 3. Decline GeeDrop Transfer
 */
export async function declineGeeDropTransfer(transferId) {
  const path = `transfers/${transferId}`;
  try {
    const transferDocRef = doc(db, 'transfers', transferId);
    await updateDoc(transferDocRef, {
      status: 'declined'
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * 4. Update Transfer to Completed once downloaded
 */
export async function completeGeeDropTransfer(transferId) {
  const path = `transfers/${transferId}`;
  try {
    const transferDocRef = doc(db, 'transfers', transferId);
    await updateDoc(transferDocRef, {
      status: 'completed'
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Helper: Download a Base64 string as a file on client
 */
export function triggerFileDownload(fileName, base64Content, fileType) {
  try {
    // Extract base64 clean data (strip data:image/png;base64, etc.)
    const parts = base64Content.split(';base64,');
    const contentType = parts[0].split(':')[1] || fileType;
    const rawBase64 = parts[1] || parts[0];
    
    const byteCharacters = atob(rawBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: contentType });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error("Local file compilation or trigger download failed: ", error);
    throw new Error("Unable to download transfer. Base64 compilation failed.");
  }
}
