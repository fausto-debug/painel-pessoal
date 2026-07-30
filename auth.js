// =============================================================
// auth.js
// Local: raiz do projeto (mesma pasta do index.html)
//
// Responsabilidade: toda a lógica de autenticação (cadastro, login,
// logout, recuperação de senha) e o observador global de sessão que
// o app.js usa para decidir se mostra o Dashboard ou as telas de
// autenticação (proteção de rotas).
// =============================================================

import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ensureUserProfile } from "./database.js";

// Cria a conta no Firebase Auth e o documento de perfil no Firestore.
export async function registerUser(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await ensureUserProfile(cred.user.uid, { name, email });
  return cred.user;
}

export function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password).then((c) => c.user);
}

export function logoutUser() {
  return signOut(auth);
}

// Envia e-mail de redefinição de senha usando o fluxo padrão do Firebase.
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

// Observa mudanças de sessão (login/logout) em tempo real.
// O app.js usa isso para mostrar o Dashboard só quando há um usuário logado
// (proteção de rotas) e para manter a sessão entre recarregamentos de página.
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// Traduz os códigos de erro do Firebase para mensagens em português,
// para exibir nas telas de login/cadastro/recuperação.
export function traduzErroFirebase(err) {
  const code = err && err.code ? err.code : "";
  const map = {
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/user-not-found": "Não encontramos uma conta com esse e-mail.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Tente novamente em instantes.",
    "auth/missing-password": "Informe uma senha."
  };
  return map[code] || "Ocorreu um erro. Tente novamente.";
}
