# 💬 ChatterBox

A modern, fast, and secure real-time messaging application built with **React Native** and **Supabase**. ChatterBox delivers a seamless chat experience inspired by **WhatsApp** and **Telegram**, allowing users to connect instantly through one-on-one conversations with a clean and intuitive interface.

---

## 📱 Features

* 🔐 Secure User Authentication
* 💬 Real-time One-to-One Messaging
* ⚡ Instant Message Updates
* 📷 Image & Media Sharing
* 😊 Emoji Support
* 🔍 Search Conversations
* 👤 User Profiles
* 🟢 Online/Offline Status
* 📱 Responsive Mobile UI
* ☁️ Cloud Database with Supabase
* 🔒 Secure Data Storage
* 🌙 Clean & Modern Interface

---

## 🛠️ Tech Stack

### Frontend

* React Native
* JavaScript
* HTML
* CSS

### Backend

* Supabase

  * Authentication
  * PostgreSQL Database
  * Real-time Subscriptions
  * Storage

---

## 🚀 Getting Started

### Prerequisites

* Node.js
* npm or Yarn
* Expo CLI (if using Expo)
* Supabase Account

### Installation

Clone the repository:

```bash
git clone https://github.com/your-username/chatterbox.git
```

Navigate into the project directory:

```bash
cd chatterbox
```

Install dependencies:

```bash
npm install
```

or

```bash
yarn install
```

Create a `.env` file and add your Supabase credentials:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

Run the application:

```bash
npm start
```

or

```bash
npx expo start
```

---

## 📂 Project Structure

```
chatterbox/
│
├── assets/
├── components/
├── screens/
├── navigation/
├── services/
├── utils/
├── hooks/
├── styles/
├── supabase/
├── App.js
├── package.json
└── README.md
```

---

## 📸 Screenshots

Add screenshots of your application here.

* Login Screen
* Home Screen
* Chat Screen
* Profile Screen
* Settings Screen

---

## 🔒 Authentication

ChatterBox uses **Supabase Authentication** for secure user sign-up and login.

Supported authentication methods include:

* Email & Password
* Session Management
* Secure Authentication Tokens

---

## ⚡ Real-Time Messaging

Powered by Supabase Realtime:

* Instant message delivery
* Live conversation updates
* Automatic synchronization
* Reliable cloud-based messaging

---

## 🎯 Future Improvements

* Group Chats
* Voice Messages
* Video Calling
* Voice Calling
* Push Notifications
* Message Reactions
* Read Receipts
* Typing Indicators
* File Sharing
* End-to-End Encryption
* Dark Mode
* Story/Status Feature
* Message Editing & Deletion

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository.
2. Create a new feature branch.
3. Commit your changes.
4. Push your branch.
5. Open a Pull Request.

---

## 📄 License

This project is licensed under the MIT License.

---

## 👨‍💻 Author

**Sumama Hassan**

If you found this project helpful, consider giving it a ⭐ on GitHub!

---

## 🌟 Inspiration

ChatterBox is inspired by the simplicity, speed, and user experience of modern messaging platforms like WhatsApp and Telegram while being built using modern technologies such as React Native and Supabase.

---

### Made with ❤️ using React Native & Supabase

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
