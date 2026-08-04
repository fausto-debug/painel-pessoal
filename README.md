# Vigilant — Painel Pessoal (com Firebase)

Painel pessoal de produtividade — financeiro, reserva financeira, contas,
hábitos, notas e treinos — com tema escuro (preto, grafite e dourado),
autenticação e banco de dados via Firebase.

## Estrutura de arquivos

O projeto agora tem duas partes separadas: a **página de vendas** (raiz)
e o **app** propriamente dito (subpasta `/app`).

```
/index.html      → página de vendas (landing page) — o que aparece pra quem ainda não é cliente
/landing.css      → visual da página de vendas

/app/index.html   → estrutura do app (login/cadastro/recuperação + dashboard)
/app/style.css        → todo o visual do app (tema escuro, cores, glassmorphism)
/app/firebase.js      → inicializa o Firebase (Auth + Firestore + Storage)
/app/auth.js          → cadastro, login, logout, recuperação de senha
/app/database.js      → toda a leitura/escrita no Firestore
/app/storage.js       → upload da foto de perfil (validação, redimensionamento e envio ao Storage)
/app/icons.js         → conjunto próprio de ícones SVG usado em toda a interface
/app/app.js           → lógica da interface — liga tudo o que está acima
/app/manifest.json    → identidade da PWA (nome, cores, ícones) — permite instalar o app
/app/sw.js            → Service Worker — cache do app e funcionamento offline
/app/icons/           → ícones do app em vários tamanhos (PWA, iOS, Android)
/app/firestore.rules  → regras de segurança do banco (documentação — cole no Firebase Console)
```

⚠️ **Importante:** o link que você já compartilhou com os amigos
(`fausto-debug.github.io/Vigilante-/`) agora vai mostrar a **página de
vendas**, não mais o login direto. O app passa a ficar em
`fausto-debug.github.io/Vigilante-/app/`. Vale avisar quem já testou.

## Passo 1 — Configurar o Firebase

Abra `firebase.js` e substitua o objeto `firebaseConfig` pelos dados do seu
projeto (Firebase Console → Configurações do projeto → Seus apps → SDK
setup and configuration).

## Passo 2 — Ativar Authentication

Firebase Console → **Authentication → Sign-in method** → ative **E-mail/senha**.

## Passo 3 — Criar o Firestore Database

Firebase Console → **Firestore Database → Criar banco de dados** (modo produção).
Em **Regras**, cole:

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

Firebase Console → **Storage → Começar**. Em **Regras**, cole:

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

## O app agora é instalável (PWA)

- **Android**: ao abrir o site no Chrome, aparece a opção "Adicionar à tela inicial" (ou um banner automático). O app abre em tela cheia, com ícone próprio.
- **iOS**: no Safari, toque em Compartilhar → "Adicionar à Tela de Início". **Precisa ser feito pelo Safari** — não funciona a partir de outro navegador ou de dentro de um app como Instagram/WhatsApp.
- Isso já é a base necessária para o próximo passo (gerar o APK via Capacitor).

### ⚠️ Ao atualizar o código no futuro

Sempre que mudar `index.html`, `style.css`, `app.js` ou qualquer outro arquivo listado dentro de `APP_SHELL_FILES` no `sw.js`, **abra o `sw.js` e aumente o número em `CACHE_VERSION`** (ex: de `"v1"` para `"v2"`). Sem isso, quem já instalou o app pode continuar vendo a versão antiga por um tempo, porque o Service Worker está servindo os arquivos salvos em cache.

## Passo 5 — Publicar

`app.js` é um módulo ES (`<script type="module">`), então precisa ser servido
por HTTP(S) — não funciona abrindo o arquivo direto (`file://`). Funciona
normalmente em **GitHub Pages**, **Firebase Hosting**, ou um servidor local
(ex: extensão "Live Server" do VS Code) para testar antes de publicar.

## Estrutura de dados no Firestore

```
users/{uid}                   → perfil (nome, foto, cor de destaque, animações)
users/{uid}/transactions/{id} → lançamentos financeiros
users/{uid}/reserves/{id}     → metas da reserva financeira
users/{uid}/bills/{id}        → contas fixas
users/{uid}/habits/{id}       → hábitos
users/{uid}/notes/{id}        → notas
users/{uid}/workouts/{id}     → registros de treino
```

Cada usuário só enxerga e só grava dentro do seu próprio `users/{uid}` —
garantido tanto pelo código (`app.js` sempre usa o `uid` do usuário logado)
quanto pelas regras do Firestore/Storage acima.

## Padrão de atualização otimista

Toda ação de escrita (adicionar/editar/excluir transações, hábitos, notas,
contas, metas, treinos, e alterações de perfil) atualiza a tela **na hora**,
sem esperar o Firestore responder. A gravação acontece em segundo plano; se
falhar, a alteração é desfeita automaticamente e um aviso aparece. Isso deixa
a interface sempre fluida, mesmo com conexão lenta.

## Subindo atualizações para o GitHub

```bash
git add .
git commit -m "Descrição do que mudou"
git push
```
