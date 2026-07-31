// =============================================================
// storage.js
// Local: raiz do projeto (mesma pasta do index.html)
//
// Responsabilidade: upload da foto de perfil para o Firebase Storage.
// Valida tipo e tamanho do arquivo, redimensiona a imagem no navegador
// (antes de enviar, para economizar espaço e banda) e devolve a URL
// pública para ser salva no documento do usuário no Firestore.
// =============================================================

import { storage } from "./firebase.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_DIMENSION = 512; // px — suficiente para um avatar nítido em qualquer tela

export class PhotoValidationError extends Error {}

function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new PhotoValidationError("Envie uma imagem em JPG, PNG ou WEBP.");
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new PhotoValidationError("A imagem deve ter no máximo 5 MB.");
  }
}

// Redimensiona a imagem (mantendo proporção) usando um <canvas> e devolve um Blob JPEG.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > height && width > MAX_DIMENSION) {
        height = Math.round((height * MAX_DIMENSION) / width);
        width = MAX_DIMENSION;
      } else if (height > MAX_DIMENSION) {
        width = Math.round((width * MAX_DIMENSION) / height);
        height = MAX_DIMENSION;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Não foi possível processar a imagem."));
      }, "image/jpeg", 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Arquivo de imagem inválido.")); };
    img.src = objectUrl;
  });
}

// Valida, redimensiona e envia a foto de perfil. Retorna a URL pública final.
export async function uploadProfilePhoto(uid, file) {
  validateFile(file);
  const resizedBlob = await resizeImage(file);
  const photoRef = ref(storage, `avatars/${uid}/photo.jpg`);
  await uploadBytes(photoRef, resizedBlob, { contentType: "image/jpeg" });
  return getDownloadURL(photoRef);
}

export async function deleteProfilePhoto(uid) {
  try {
    await deleteObject(ref(storage, `avatars/${uid}/photo.jpg`));
  } catch (err) {
    // Se o arquivo não existir, não há problema — apenas ignora.
    if (err && err.code !== "storage/object-not-found") throw err;
  }
}
