# My Anime Shelf ✨

[![Live Demo](https://img.shields.io/badge/Live%20Demo-sadhasri697.github.io%2FMy--Anime--Self-2ea44f?style=for-the-badge&logo=githubpages&logoColor=white)](https://sadhasri697.github.io/My-Anime-Self/)

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript%20ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5](https://img.shields.io/badge/HTML5-Semantic-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Glossary/HTML5)
[![CSS3](https://img.shields.io/badge/CSS3-Modern%20Design%20Tokens-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/CSS)
[![AniList API](https://img.shields.io/badge/API-AniList%20GraphQL-02A9FF?logo=graphql&logoColor=white)](https://anilist.co)
[![Firebase](https://img.shields.io/badge/Database-Firebase%20v11-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)

> **Your personal anime universe.** Discover trending and popular anime, search the comprehensive AniList catalogue, compare show statistics, and manage your personal watched list and wishlist in the cloud.

---

## 🌐 Live Website

Click below to open and view the website live in your browser:

👉 **[https://sadhasri697.github.io/My-Anime-Self/](https://sadhasri697.github.io/My-Anime-Self/)**

---

## 📸 Overview

**My Anime Shelf** is a lightweight, responsive web application built with vanilla web technologies (HTML5, CSS3, ES Modules) powered by the **AniList GraphQL API** for anime metadata and **Google Firebase** (Authentication & Cloud Firestore) for cross-device collection synchronization.

### 🌟 Key Features

- **🔥 Real-time Discovery**:
  - **Trending This Week**: Highlights hottest ongoing releases.
  - **Most Popular**: Discover community favorites.
  - **Top-Rated**: Ranked by AniList community score.
  - **Pagination**: "View More" pagination to load additional items on demand.

- **🔎 Instant Search & Autocomplete**:
  - Live, debounced search suggestions as you type.
  - Search results display with instant feedback and keyboard accessibility.

- **📑 Rich Anime Details Dialog**:
  - View full Romaji, English, and Native titles.
  - Production studios, format, status, airing dates, season, and duration.
  - Full synopsis and genres.
  - Direct links to YouTube trailers and official AniList pages.

- **📊 Visual Anime Statistics**:
  - Dynamic CSS bar charts comparing catalogue popularity.
  - Average user ratings visualizer comparing top shows.

- **👤 Cloud Profile & Collection Tracking**:
  - **Google Authentication**: Seamless one-click login with Google Popup.
  - **Cloud Firestore Storage**: Your collection syncs automatically across devices.
  - **Watched Anime Shelf**: Track shows you've finished or are currently watching.
  - **Episode Counter**: Track progress episode by episode with increment/decrement buttons.
  - **Wishlist**: Save upcoming or discovered anime you plan to watch.

- **🎨 Modern Aesthetics & Accessibility**:
  - High-contrast, tailored dark theme with glassmorphism and subtle micro-animations.
  - Responsive drawer sidebar navigation with backdrop overlay.
  - Full keyboard accessibility with skip links, focus indicators, and ARIA attributes.
  - Respects `prefers-reduced-motion` settings.
  - Custom non-intrusive toast notifications replacing disruptive browser alerts.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Structure** | Semantic HTML5 with ARIA accessibility roles |
| **Styling** | Vanilla CSS3 (Custom Properties / Design Tokens, Flexbox, Grid, Dark Mode) |
| **Logic** | Modular JavaScript (ES6+ Modules, async/await, AbortController) |
| **Data Provider** | [AniList GraphQL API v2](https://anilist.gitbook.io/anilist-apiv2-docs/) |
| **Authentication** | [Firebase Authentication](https://firebase.google.com/docs/auth) (Google Sign-In) |
| **Database** | [Cloud Firestore](https://firebase.google.com/docs/firestore) (Realtime NoSQL) |

---

## 📂 Project Structure

```text
My-Anime-Self/
├── .nojekyll         # Disables Jekyll processing for GitHub Pages
├── index.html        # Main landing page (Discovery, Search, Stats, Charts)
├── profile.html      # User profile page (Watched list, Wishlist, Episode tracking)
├── style.css         # Unified responsive stylesheet and design token system
├── script.js         # Homepage controller (AniList queries, Search, Auth sync)
├── profile.js        # Profile controller (Firestore CRUD, Episode progress)
├── anime-ui.js       # Reusable UI component library (Cards, Modals, Formatters)
├── package.json      # Project metadata and quick-start scripts
├── LICENSE           # Open-source MIT License
└── README.md         # Documentation
```

---

## 🌐 Live Deployment (GitHub Pages)

The project is pre-configured for instant hosting via **GitHub Pages**:

1. Go to your repository **Settings** → **Pages** (direct link: [Repository Pages Settings](https://github.com/SadhaSri697/My-Anime-Self/settings/pages)).
2. Under **Build and deployment** > **Source**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then click **Save**.
4. Your website is immediately available at:  
   👉 **[https://sadhasri697.github.io/My-Anime-Self/](https://sadhasri697.github.io/My-Anime-Self/)**

---

## 🚀 How to Run Locally

Because the application uses modern **JavaScript ES Modules** (`type="module"`), running it via the `file:///` protocol may be blocked by browser CORS restrictions. Serving it over a local HTTP server is required.

### Option 1: Using Python (Recommended & Built-in)

If you have Python installed, open your terminal in the project directory and run:

```bash
# Python 3
python -m http.server 5500
```

Then open your browser at:
👉 **[http://localhost:5500](http://localhost:5500)**

---

### Option 2: Using Node.js / npx

If you have Node.js installed:

```bash
# Using npx directly
npx serve -l 5500

# Or with npm scripts:
npm start
```

Then visit **[http://localhost:5500](http://localhost:5500)**.

---

### Option 3: Using VS Code Live Server

1. Open this folder in **Visual Studio Code**.
2. Install the **Live Server** extension (by Ritwick Dey).
3. Right-click `index.html` and select **"Open with Live Server"**.

---

## ⚙️ Configuration & Customization

### Firebase Setup

The project includes default Firebase initialization in `script.js` and `profile.js`. To connect your own Firebase project:

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication** with the **Google** sign-in provider.
3. Enable **Cloud Firestore** and set your security rules:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
4. Replace the `firebaseConfig` object in both `script.js` and `profile.js`:
   ```javascript
   const firebaseConfig = {
       apiKey: "YOUR_API_KEY",
       authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
       projectId: "YOUR_PROJECT_ID",
       storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
       messagingSenderId: "YOUR_SENDER_ID",
       appId: "YOUR_APP_ID",
       measurementId: "YOUR_MEASUREMENT_ID"
   };
   ```

---

## ⌨️ Accessibility Features

- **Skip Navigation**: Hit `Tab` on initial page load to immediately jump past the navbar to the main content.
- **Accessible Modals**: Focus is trapped within open anime details dialogs, and hitting `Escape` cleanly dismisses them.
- **Screen Reader Announcements**: Live status changes and search queries notify screen readers via `aria-live="polite"`.
- **Keyboard Traversal**: Fully operable using keyboard navigation (`Tab`, `Shift+Tab`, `Enter`, `Space`).

---

## 🤝 Contributing

Contributions, feature requests, and bug reports are welcome!
Feel free to open an issue or submit a pull request:

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more details.

---

## 🙏 Acknowledgements

- [AniList](https://anilist.co) for providing their incredible, free GraphQL Anime API.
- [Google Firebase](https://firebase.google.com/) for reliable authentication and serverless database infrastructure.
