// =============================================================
// firebase.js
// Local: raiz do projeto (mesma pasta do index.html)
//
// Responsabilidade: inicializar o Firebase e exportar as instâncias
// de Auth e Firestore para serem usadas por auth.js e database.js.
// Nenhum outro arquivo deve chamar initializeApp() além deste.
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// >>> SUBSTITUA os valores abaixo pela configuração do SEU projeto <<<
// Você encontra esses dados em: Firebase Console > Configurações do projeto
// (ícone de engrenagem) > Seus apps > SDK setup and configuration.
const firebaseConfig = {
  apiKey: "AIzaSyAyP-Hxwbc9WxjSs0GiAkH9UtsEtckWcpk",
  authDomain: "vigilante-painel.firebaseapp.com",
  projectId: "vigilante-painel",
  storageBucket: "vigilante-painel.firebasestorage.app",
  messagingSenderId: "679586336318",
  appId: "1:679586336318:web:2ef2aedce5e42b49c4cb6f"
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

// Persistência local: o usuário continua logado mesmo depois de
// fechar o navegador (requisito de "persistência de login").
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Erro ao configurar persistência de autenticação:", err);
});
