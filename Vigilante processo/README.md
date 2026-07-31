# Vigilante — Painel Pessoal (com Firebase)

> **Versão refatorada:** correção do bug do menu lateral após logout, responsividade revisada para celular/tablet/desktop, sombras e tipografia aprimoradas, transições suaves entre telas, foco/acessibilidade no modal e navegação, textos de usuário protegidos contra XSS, e upload de foto de perfil via Firebase Storage (substituindo o campo de URL).

## Estrutura de arquivos

Todos os arquivos abaixo devem ficar **na mesma pasta**, na raiz do projeto/repositório:

```
/index.html      → estrutura da página (telas de login/cadastro/recuperação + dashboard)
/style.css        → todo o visual (tema escuro, cores, glassmorphism)
/firebase.js      → inicializa o Firebase (Auth + Firestore + Storage)
/auth.js          → cadastro, login, logout, recuperação de senha
/database.js      → toda a leitura/escrita no Firestore
/storage.js       → upload da foto de perfil (validação, redimensionamento e envio ao Storage)
/app.js           → lógica da interface (o que antes ficava dentro de <script> no HTML)
```

## Passo 1 — Configurar o Firebase

1. Abra o arquivo **firebase.js**
2. Substitua o objeto `firebaseConfig` pelos dados do SEU projeto Firebase.
   Você encontra esses dados em: **Firebase Console → Configurações do projeto (ícone de engrenagem) → Seus apps → SDK setup and configuration**.

## Passo 2 — Ativar Authentication

No Firebase Console → **Authentication → Sign-in method**, ative o provedor **E-mail/senha**.

## Passo 3 — Criar o Firestore Database

No Firebase Console → **Firestore Database → Criar banco de dados** (modo produção).

Depois, vá em **Regras** e cole isto (garante que cada usuário só acesse os próprios dados):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /{collection}/{docId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

## Passo 4 — Ativar o Firebase Storage (foto de perfil)

No Firebase Console → **Storage → Começar**. Depois, em **Regras**, cole isto (cada usuário só pode enviar/ler a própria foto):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /avatars/{userId}/{fileName} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.size < 5 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

> `allow read: if true` deixa as fotos publicamente visíveis (necessário para elas aparecerem na interface sem exigir login de terceiros). Se preferir restringir a leitura, troque para `if request.auth != null`.

## Passo 5 — Publicar

Como o `app.js` é um **módulo ES** (`<script type="module">`), o navegador bloqueia esse recurso se você simplesmente abrir o `index.html` direto do seu computador (protocolo `file://`). Ele funciona normalmente quando servido por HTTP, por exemplo:
- **GitHub Pages** (como já configurado no seu repositório)
- **Firebase Hosting** (`firebase deploy`)
- Um servidor local simples, se quiser testar antes de publicar (ex: extensão "Live Server" do VS Code)

## Como os dados ficam organizados no Firestore

```
users/{uid}                   → perfil (nome, foto, cor de destaque, animações)
users/{uid}/transactions/{id} → lançamentos financeiros
users/{uid}/reserves/{id}     → metas da reserva financeira
users/{uid}/bills/{id}        → contas fixas
users/{uid}/habits/{id}       → hábitos
users/{uid}/notes/{id}        → notas
users/{uid}/workouts/{id}     → registros de treino
```

Cada usuário só enxerga e só grava dentro do seu próprio `users/{uid}` — isso é garantido tanto pelo código (`app.js` sempre usa o `uid` do usuário logado) quanto pelas regras do Firestore acima.
