// =============================================================
// database.js
// Local: raiz do projeto (mesma pasta do index.html)
//
// Responsabilidade: única camada que fala com o Firestore.
// Nenhum outro arquivo importa funções do Firestore diretamente —
// tudo passa por aqui, o que facilita trocar de banco no futuro.
//
// Estrutura de dados no Firestore:
//   users/{uid}                      -> perfil (name, photo, accent, animations, email)
//   users/{uid}/transactions/{id}    -> lançamentos financeiros (receitas/despesas)
//   users/{uid}/reserves/{id}        -> metas da reserva financeira
//   users/{uid}/bills/{id}           -> contas fixas
//   users/{uid}/habits/{id}          -> hábitos (inclui mapa "completions")
//   users/{uid}/notes/{id}           -> notas
//   users/{uid}/workouts/{id}        -> registros de treino
//
// Cada coleção fica DENTRO do documento do usuário (subcoleção), então
// as regras de segurança do Firestore (abaixo, para configurar no
// Console > Firestore Database > Regras) já isolam os dados por usuário:
//
//   rules_version = '2';
//   service cloud.firestore {
//     match /databases/{database}/documents {
//       match /users/{userId} {
//         allow read, write: if request.auth != null && request.auth.uid == userId;
//         match /{collection}/{docId} {
//           allow read, write: if request.auth != null && request.auth.uid == userId;
//         }
//       }
//     }
//   }
// =============================================================

import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot,
  query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------- Perfil do usuário ---------------- */

// Cria o documento de perfil na primeira vez que o usuário se cadastra.
export async function ensureUserProfile(uid, { name, email }) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: name || (email ? email.split("@")[0] : "Usuário"),
      email: email || "",
      photo: "",
      accent: "gold",
      animations: true
    });
  }
}

export function updateUserProfile(uid, data) {
  return updateDoc(doc(db, "users", uid), data);
}

// Observa o perfil em tempo real (nome, foto, cor de destaque, animações).
export function watchUserProfile(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

/* ---------------- Coleções genéricas ----------------
   Usadas para: transactions, reserves, bills, habits, notes, workouts.
   Isso evita repetir a mesma lógica de CRUD seis vezes. */

function subcollectionRef(uid, name) {
  return collection(db, "users", uid, name);
}

// Observa uma subcoleção inteira em tempo real. Retorna a função de
// "unsubscribe" (chame quando o usuário fizer logout ou trocar de conta).
export function watchCollection(uid, name, callback) {
  return onSnapshot(query(subcollectionRef(uid, name)), (snap) => {
    const items = [];
    snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
    callback(items);
  });
}

export function addItem(uid, name, data) {
  return addDoc(subcollectionRef(uid, name), data);
}

export function updateItem(uid, name, id, data) {
  return updateDoc(doc(db, "users", uid, name, id), data);
}

export function deleteItem(uid, name, id) {
  return deleteDoc(doc(db, "users", uid, name, id));
}
