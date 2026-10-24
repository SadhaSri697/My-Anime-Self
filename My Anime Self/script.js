import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

import {
    createCardBody,
    createPosterFrame
} from "./anime-ui.js";

// NOTE: This config is public by design. Protect your data with strict
// Firestore security rules and restrict the API key by HTTP referrer.
const firebaseConfig = {
    apiKey: "AIzaSyBIjA7swlxrIO99d8ywXOyK6osjR4oMnoU",
    authDomain: "my-anime-shelf-5e5e4.firebaseapp.com",
    projectId: "my-anime-shelf-5e5e4",
    storageBucket: "my-anime-shelf-5e5e4.firebasestorage.app",
    messagingSenderId: "951432696841",
    appId: "1:951432696841:web:574074049188c6238194d8",
    measurementId: "G-MXQFKKJS9N"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();


// ELEMENT HELPERS (every lookup is optional so the file is safe on any page)

const $ = id => document.getElementById(id);

const searchForm = $("searchForm");
const searchInput = $("animeSearch");
const searchButton = $("searchButton");
const searchSuggestions = $("searchSuggestions");
const searchResults = $("searchResults");
const searchSection = $("searchSection");
const searchStatus = $("searchStatus");

const signInButton = $("signInButton");
const signOutButton = $("signOutButton");

const sidebar = $("sidebar");
const sidebarOverlay = $("sidebarOverlay");
const menuButton = $("menuButton");
const closeMenuButton = $("closeMenuButton");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const scrollBehavior = () => (reducedMotion.matches ? "auto" : "smooth");

function setText(id, text) {
    const element = $(id);
    if (element) {
        element.textContent = text;
    }
}

let watchedList = [];
let wishlist = [];
let currentUser = null;
let listsLoaded = false;
let authVersion = 0;

let suggestionVersion = 0;
let suggestionTimer;
let suggestionController;
let searchController;


// NOTIFICATIONS (replaces blocking alert() calls)

let toastTimer;

function ensureToast() {
    let toast = $("toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.className = "toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
    }

    return toast;
}

function notify(message, type = "error") {
    const toast = ensureToast();

    toast.textContent = message;
    toast.dataset.type = type;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 5000);
}


// ANILIST

const ANILIST_URL = "https://graphql.anilist.co";

const ANIME_FIELDS = `
    id
    title {
        romaji
        english
    }
    coverImage {
        large
        extraLarge
    }
    episodes
    season
    seasonYear
    startDate {
        year
    }
    averageScore
    popularity
`;

const SEARCH_QUERY = `
    query ($search: String, $perPage: Int) {
        Page(perPage: $perPage) {
            media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) {
                ${ANIME_FIELDS}
            }
        }
    }
`;

// One request instead of three.
const HOME_QUERY = `
    query ($minimumScore: Int) {
        trending: Page(page: 1, perPage: 8) {
            pageInfo {
                hasNextPage
            }
            media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
                ${ANIME_FIELDS}
            }
        }
        popular: Page(page: 1, perPage: 8) {
            pageInfo {
                hasNextPage
            }
            media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
                ${ANIME_FIELDS}
            }
        }
        topRated: Page(page: 1, perPage: 8) {
            pageInfo {
                hasNextPage
            }
            media(
                type: ANIME,
                sort: SCORE_DESC,
                averageScore_greater: $minimumScore,
                isAdult: false
            ) {
                ${ANIME_FIELDS}
            }
        }
    }
`;

// Loads the next page of one homepage section ("View more").
const SECTION_QUERY = `
    query ($page: Int, $perPage: Int, $sort: [MediaSort], $minimumScore: Int) {
        Page(page: $page, perPage: $perPage) {
            pageInfo {
                hasNextPage
            }
            media(
                type: ANIME,
                sort: $sort,
                averageScore_greater: $minimumScore,
                isAdult: false
            ) {
                ${ANIME_FIELDS}
            }
        }
    }
`;

async function aniListRequest(query, variables = {}, signal) {
    const response = await fetch(ANILIST_URL, {
        method: "POST",
        signal,
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
        throw new Error("AniList request failed: " + response.status);
    }

    const result = await response.json();

    if (result.errors) {
        throw new Error(result.errors[0].message);
    }

    return result.data;
}


// CONVERT ANILIST DATA
// Works for raw AniList objects AND for already-formatted anime,
// so formatting twice no longer destroys the data.

function formatAnime(anime) {
    if (typeof anime.title === "string") {
        return {
            id: Number(anime.id),
            title: anime.title || "Unknown Title",
            poster: anime.poster || "",
            episodes: anime.episodes ?? null,
            episodesWatched: Math.max(
                0,
                Math.floor(Number(anime.episodesWatched) || 0)
            ),
            year: anime.year ?? "Unknown",
            season: anime.season ?? "Unknown",
            score: anime.score ?? null,
            popularity: anime.popularity ?? 0
        };
    }

    return {
        id: Number(anime.id),
        title: anime.title?.english || anime.title?.romaji || "Unknown Title",
        poster: anime.coverImage?.extraLarge || anime.coverImage?.large || "",
        episodes: anime.episodes ?? null,
        episodesWatched: Number(anime.episodesWatched) || 0,
        year: anime.seasonYear || anime.startDate?.year || "Unknown",
        season: anime.season
            ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase()
            : "Unknown",
        score: anime.averageScore ?? null,
        popularity: anime.popularity ?? 0
    };
}


// FIREBASE SIGN-IN / SIGN-OUT

signInButton?.addEventListener("click", async () => {
    signInButton.disabled = true;

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error(error);

        switch (error.code) {
            case "auth/popup-closed-by-user":
            case "auth/cancelled-popup-request":
                break;

            case "auth/popup-blocked":
                notify("Your browser blocked the sign-in popup. Please allow popups and try again.");
                break;

            case "auth/network-request-failed":
                notify("Network error. Please check your connection and try again.");
                break;

            case "auth/unauthorized-domain":
                notify("This website address is not authorized. Add its hostname under Firebase Authentication > Settings > Authorized domains.");
                break;

            default:
                notify("Unable to sign in. Please try again.");
        }
    } finally {
        signInButton.disabled = false;
    }
});

signOutButton?.addEventListener("click", async () => {
    try {
        await signOut(auth);
    } catch (error) {
        console.error(error);
        notify("Unable to sign out. Please try again.");
    }
});


// CLEAN LISTS LOADED FROM FIRESTORE

function cleanLists(data) {
    const rawWatched = Array.isArray(data.watchedList) ? data.watchedList : [];
    const rawWishlist = Array.isArray(data.wishlist) ? data.wishlist : [];

    // Remove duplicates from Watched and make sure progress is valid.
    const watchedIds = new Set();
    const cleanWatched = [];

    for (const item of rawWatched) {
        const id = Number(item?.id);

        if (!Number.isFinite(id) || watchedIds.has(id)) {
            continue;
        }

        watchedIds.add(id);

        const entry = { ...item, id };
        const total = Number(entry.episodes);

        let seen = Math.max(0, Math.floor(Number(entry.episodesWatched) || 0));

        if (Number.isFinite(total) && total > 0) {
            seen = Math.min(seen, total);
        }

        entry.episodesWatched = seen;
        cleanWatched.push(entry);
    }

    // Remove duplicates and overlaps from Wishlist.
    // If an anime is in both lists, keep it in Watched.
    const wishlistIds = new Set();
    const cleanWishlist = [];

    for (const item of rawWishlist) {
        const id = Number(item?.id);

        if (
            !Number.isFinite(id) ||
            watchedIds.has(id) ||
            wishlistIds.has(id)
        ) {
            continue;
        }

        wishlistIds.add(id);
        cleanWishlist.push({ ...item, id });
    }

    return {
        watched: cleanWatched,
        wishlist: cleanWishlist,
        changed:
            JSON.stringify(rawWatched) !== JSON.stringify(cleanWatched) ||
            JSON.stringify(rawWishlist) !== JSON.stringify(cleanWishlist)
    };
}


// AUTHENTICATION STATE

onAuthStateChanged(auth, async user => {
    const version = ++authVersion;

    currentUser = user;
    listsLoaded = false;

    if (signInButton) signInButton.hidden = Boolean(user);
    if (signOutButton) signOutButton.hidden = !user;

    updateProfile();

    if (!user) {
        watchedList = [];
        wishlist = [];
        listsLoaded = true;

        refreshAll();
        return;
    }

    let snapshot;

    try {
        snapshot = await getDoc(doc(db, "users", user.uid, "lists", "main"));
    } catch (error) {
        console.error("Unable to load lists:", error);

        if (version === authVersion) {
            notify("Unable to load your anime lists. Please refresh and try again.");
        }

        return;
    }

    // Ignore the result if the user changed while we were waiting.
    if (version !== authVersion || auth.currentUser?.uid !== user.uid) {
        return;
    }

    let needsSave = false;

    if (snapshot.exists()) {
        const cleaned = cleanLists(snapshot.data());

        watchedList = cleaned.watched;
        wishlist = cleaned.wishlist;
        needsSave = cleaned.changed;
    } else {
        watchedList = [];
        wishlist = [];
    }

    listsLoaded = true;
    refreshAll();

    // Saving the cleaned data is best-effort and must not show a "load" error.
    if (needsSave) {
        try {
            await saveLists();
        } catch (error) {
            console.error("Unable to save cleaned lists:", error);
        }
    }
});


// SAVE LISTS (queued so writes never overlap or finish out of order)

let saveChain = Promise.resolve();

function saveLists() {
    const user = auth.currentUser;

    if (!user || !listsLoaded) {
        return Promise.reject(
            new Error("Please sign in and wait for your lists to load.")
        );
    }

    // Reads the latest lists at the moment the write actually runs.
    const run = () =>
        setDoc(doc(db, "users", user.uid, "lists", "main"), {
            watchedList,
            wishlist
        });

    const result = saveChain.then(run, run);
    saveChain = result.catch(() => {});

    return result;
}

function refreshAll() {
    displayLists();
    updateAllSearchButtons();
    updateProfile();
}


// SIDEBAR MENU

if (sidebar) {
    sidebar.inert = true; // links are not focusable while the menu is closed
}

function openSidebar() {
    if (!sidebar) return;

    sidebar.inert = false;
    sidebar.classList.add("open");
    sidebarOverlay?.classList.add("open");
    menuButton?.setAttribute("aria-expanded", "true");
    document.body.classList.add("no-scroll");

    closeMenuButton?.focus();
}

function closeSidebar(returnFocus = false) {
    if (!sidebar) return;

    if (returnFocus) {
        menuButton?.focus();
    }

    sidebar.classList.remove("open");
    sidebarOverlay?.classList.remove("open");
    sidebar.inert = true;
    menuButton?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("no-scroll");
}

function goHome() {
    if (searchInput) searchInput.value = "";
    searchResults?.replaceChildren();
    if (searchSection) searchSection.hidden = true;
    if (searchStatus) searchStatus.textContent = "";

    hideSuggestions();
    closeSidebar();

    window.scrollTo({ top: 0, behavior: scrollBehavior() });
}

menuButton?.addEventListener("click", openSidebar);
closeMenuButton?.addEventListener("click", () => closeSidebar(true));
sidebarOverlay?.addEventListener("click", () => closeSidebar());

document.querySelectorAll(".sidebar-link").forEach(link => {
    link.addEventListener("click", event => {
        closeSidebar();

        if (link.getAttribute("href") === "#home") {
            event.preventDefault();
            goHome();
        }
    });
});

document
    .querySelector(".nav-links a[href='#home']")
    ?.addEventListener("click", event => {
        event.preventDefault();
        goHome();
    });

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar?.classList.contains("open")) {
        closeSidebar(true);
    }
});


// SEARCH BOX

if (searchForm) {
    searchForm.addEventListener("submit", event => {
        event.preventDefault();
        searchAnime();
    });
} else {
    // Fallback for the old markup without a <form>.
    searchButton?.addEventListener("click", searchAnime);

    searchInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchAnime();
        }
    });
}

searchInput?.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        hideSuggestions();
    }

    if (event.key === "ArrowDown") {
        const first = searchSuggestions?.querySelector("button");

        if (first) {
            event.preventDefault();
            first.focus();
        }
    }
});

searchSuggestions?.addEventListener("keydown", event => {
    const items = [...searchSuggestions.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);

    if (event.key === "ArrowDown") {
        event.preventDefault();
        items[Math.min(index + 1, items.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();

        if (index <= 0) {
            searchInput.focus();
        } else {
            items[index - 1].focus();
        }
    } else if (event.key === "Escape") {
        hideSuggestions();
        searchInput.focus();
    }
});

searchInput?.addEventListener("input", () => {
    clearTimeout(suggestionTimer);

    const term = searchInput.value.trim();

    if (term.length < 3) {
        hideSuggestions();

        if (searchStatus) searchStatus.textContent = "";
        return;
    }

    suggestionTimer = setTimeout(() => loadSuggestions(term), 350);
});

document.addEventListener("click", event => {
    if (!event.target.closest(".search-wrapper")) {
        hideSuggestions();
    }
});


// SUGGESTIONS

function showSuggestionMessage(message) {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    item.textContent = message;

    searchSuggestions.replaceChildren(item);
    searchSuggestions.hidden = false;
    searchInput?.setAttribute("aria-expanded", "true");
}

function hideSuggestions() {
    if (!searchSuggestions) return;

    // Cancel anything still pending so the list can't reappear later.
    clearTimeout(suggestionTimer);
    suggestionController?.abort();
    suggestionVersion++;

    searchSuggestions.hidden = true;
    searchSuggestions.replaceChildren();
    searchInput?.setAttribute("aria-expanded", "false");
}

async function loadSuggestions(term) {
    const version = ++suggestionVersion;

    suggestionController?.abort();
    suggestionController = new AbortController();

    showSuggestionMessage("Finding anime...");

    try {
        const data = await aniListRequest(
            SEARCH_QUERY,
            { search: term, perPage: 7 },
            suggestionController.signal
        );

        if (version !== suggestionVersion || searchInput.value.trim() !== term) {
            return;
        }

        const results = data.Page.media;

        if (results.length === 0) {
            showSuggestionMessage("No matching anime found.");
            return;
        }

        const items = results.map(anime => {
            const formatted = formatAnime(anime);

            const button = document.createElement("button");
            button.type = "button";
            button.className = "suggestion-item";
            button.setAttribute("role", "option");

            const image = document.createElement("img");
            image.alt = "";
            image.width = 40;
            image.height = 56;
            image.loading = "lazy";
            image.decoding = "async";

            if (formatted.poster) {
                image.src = formatted.poster;
            }

            const text = document.createElement("div");

            const title = document.createElement("div");
            title.className = "suggestion-title";
            title.textContent = formatted.title;

            const detail = document.createElement("span");
            detail.className = "suggestion-detail";
            detail.textContent =
                `${formatted.year} · ${formatted.episodes ?? "?"} episodes`;

            text.append(title, detail);
            button.append(image, text);

            button.addEventListener("click", () => {
                searchInput.value = formatted.title;
                hideSuggestions();
                showSearchResults([anime]);

                if (searchStatus) searchStatus.textContent = "1 result shown.";

                searchSection?.scrollIntoView({
                    behavior: scrollBehavior(),
                    block: "start"
                });
            });

            return button;
        });

        searchSuggestions.replaceChildren(...items);
        searchSuggestions.hidden = false;
        searchInput.setAttribute("aria-expanded", "true");

    } catch (error) {
        if (error.name !== "AbortError") {
            console.error("Suggestion error:", error);
            hideSuggestions();
        }
    }
}


// RUN A FULL SEARCH

async function searchAnime() {
    const term = searchInput.value.trim();

    if (!term) {
        searchStatus.textContent = "Enter an anime name to search.";
        searchInput.focus();
        return;
    }

    hideSuggestions();

    // A newer search cancels any older one still running.
    searchController?.abort();
    searchController = new AbortController();
    const { signal } = searchController;

    searchStatus.textContent = "Searching...";
    if (searchButton) searchButton.disabled = true;

    try {
        const data = await aniListRequest(
            SEARCH_QUERY,
            { search: term, perPage: 12 },
            signal
        );

        const results = data.Page.media;

        if (results.length === 0) {
            searchSection.hidden = false;
            searchResults.replaceChildren(makeMessage("No matching anime found."));
            searchStatus.textContent = "No results found.";
            return;
        }

        showSearchResults(results);

        searchStatus.textContent =
            `${results.length} ${results.length === 1 ? "result" : "results"} found.`;

        searchSection.scrollIntoView({
            behavior: scrollBehavior(),
            block: "start"
        });

    } catch (error) {
        if (error.name === "AbortError") {
            return;
        }

        console.error("Search error:", error);
        searchStatus.textContent = "Search failed. Please try again.";
    } finally {
        if (!signal.aborted && searchButton) {
            searchButton.disabled = false;
        }
    }
}

function showSearchResults(results) {
    if (!searchSection || !searchResults) return;

    searchSection.hidden = false;

    searchResults.replaceChildren(
        ...results.map(anime => createAnimeCard(formatAnime(anime), true))
    );
}


// CREATE ANIME CARDS

function createAnimeCard(anime, showAddButtons) {
    const card = document.createElement("article");
    card.className = "anime-card";
    card.dataset.animeId = anime.id;

    const info = createCardBody(anime);

    if (showAddButtons) {
        const actions = document.createElement("div");
        actions.className = "card-actions";

        const watchedButton = document.createElement("button");
        watchedButton.type = "button";
        watchedButton.className = "watched-button";
        watchedButton.dataset.action = "watched";
        watchedButton.addEventListener("click", () => addAnime(anime, "watched"));

        const wishlistButton = document.createElement("button");
        wishlistButton.type = "button";
        wishlistButton.className = "wishlist-button";
        wishlistButton.dataset.action = "wishlist";
        wishlistButton.addEventListener("click", () => addAnime(anime, "wishlist"));

        actions.append(watchedButton, wishlistButton);
        info.appendChild(actions);
    }

    card.append(createPosterFrame(anime), info);

    updateCardButtons(card);

    return card;
}


// ADD ANIME AND PREVENT DUPLICATES

async function addAnime(anime, destination) {
    if (destination !== "watched" && destination !== "wishlist") {
        return;
    }

    if (!auth.currentUser) {
        notify("Please log in to save anime to your lists.", "info");
        return;
    }

    if (!listsLoaded) {
        notify("Your lists are still loading. Please try again in a moment.", "info");
        return;
    }

    const animeId = Number(anime.id);
    const isSame = item => Number(item.id) === animeId;

    // Already in the chosen list: nothing to change or save.
    const targetList = destination === "watched" ? watchedList : wishlist;

    if (targetList.some(isSame)) {
        return;
    }

    const previousWatched = [...watchedList];
    const previousWishlist = [...wishlist];

    const formattedAnime = formatAnime(anime);

    if (destination === "watched") {
        watchedList = [...watchedList, formattedAnime];
        wishlist = wishlist.filter(item => !isSame(item));
    } else {
        wishlist = [...wishlist, formattedAnime];
        watchedList = watchedList.filter(item => !isSame(item));
    }

    refreshAll();

    try {
        await saveLists();
    } catch (error) {
        console.error("Unable to save anime:", error);

        watchedList = previousWatched;
        wishlist = previousWishlist;
        refreshAll();

        notify("Unable to save your anime. Please check your connection and try again.");
    }
}


// DISPLAY WATCHED AND WISHLIST

function displayLists() {
    displayOneList("watchedList", watchedList, "watched");
    displayOneList("wishlistList", wishlist, "wishlist");
}

function displayOneList(containerId, list, type) {
    const container = $(containerId);

    if (!container) return;

    container.setAttribute("aria-busy", "false");

    if (!list.length) {
        container.replaceChildren(makeMessage(
            type === "watched"
                ? "Your watched anime will appear here."
                : "Anime you want to watch will appear here."
        ));
        return;
    }

    const cards = list.map(anime => {
        const card = createAnimeCard(anime, false);
        const info = card.querySelector(".anime-info");

        // EPISODE TRACKING: Watched list only.
        if (type === "watched") {
            info.appendChild(createEpisodeTracker(anime));
        }

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-button";
        removeButton.textContent = "Remove";
        removeButton.setAttribute(
            "aria-label",
            `Remove ${anime.title} from ${type === "watched" ? "watched" : "wishlist"}`
        );

        removeButton.addEventListener("click", () => removeAnime(anime, type));

        info.appendChild(removeButton);

        return card;
    });

    container.replaceChildren(...cards);
}

function createEpisodeTracker(anime) {
    const tracker = document.createElement("div");
    tracker.className = "episode-tracker";

    const total = Number(anime.episodes);
    const hasTotal =
        anime.episodes != null && Number.isFinite(total) && total > 0;

    const watched = Math.max(0, Math.floor(Number(anime.episodesWatched) || 0));

    // The last value that is known to be saved, used for rollbacks.
    let lastSaved = watched;

    const inputId = `episodes-${anime.id}`;

    const label = document.createElement("label");
    label.htmlFor = inputId;
    label.textContent = "📺 Episodes watched";
    label.className = "episode-label";

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.step = "1";
    input.value = watched;
    input.className = "episode-input";
    input.setAttribute("aria-label", `Episodes watched for ${anime.title}`);

    if (hasTotal) {
        input.max = String(total);
        input.placeholder = `Out of ${total} episodes`;
    } else {
        input.placeholder = "Enter episodes watched";
    }

    const progressText = document.createElement("p");
    progressText.className = "episode-progress-text";

    const progressTrack = document.createElement("div");
    progressTrack.className = "episode-progress-track";

    if (hasTotal) {
        progressTrack.setAttribute("role", "progressbar");
        progressTrack.setAttribute("aria-label", `Progress for ${anime.title}`);
        progressTrack.setAttribute("aria-valuemin", "0");
        progressTrack.setAttribute("aria-valuemax", String(total));
    }

    const progressBar = document.createElement("div");
    progressBar.className = "episode-progress-bar";

    progressTrack.appendChild(progressBar);

    const updateProgressDisplay = value => {
        if (hasTotal) {
            const percentage = Math.min(100, Math.round((value / total) * 100));

            progressText.textContent =
                `${value} / ${total} episodes · ${percentage}%` +
                (value >= total ? " · Completed! 🎉" : "");

            progressBar.style.width = `${percentage}%`;
            progressTrack.setAttribute("aria-valuenow", String(value));
        } else {
            progressText.textContent =
                `${value} episodes watched · Total unknown`;

            progressBar.style.width = "0%";
        }
    };

    updateProgressDisplay(watched);

    input.addEventListener("change", async () => {
        if (!auth.currentUser || !listsLoaded) {
            notify("Please sign in and wait for your lists to load.", "info");
            input.value = lastSaved;
            return;
        }

        let value = Number(input.value);

        if (!Number.isFinite(value) || value < 0) {
            value = 0;
        }

        value = Math.floor(value);

        if (hasTotal) {
            value = Math.min(value, total);
        }

        input.value = value;

        if (value === lastSaved) {
            return;
        }

        const currentAnime = watchedList.find(
            item => Number(item.id) === Number(anime.id)
        );

        if (!currentAnime) {
            return;
        }

        currentAnime.episodesWatched = value;
        updateProgressDisplay(value);

        input.disabled = true;

        try {
            await saveLists();
            lastSaved = value;
        } catch (error) {
            console.error("Unable to save episode progress:", error);

            currentAnime.episodesWatched = lastSaved;
            input.value = lastSaved;
            updateProgressDisplay(lastSaved);

            notify("Unable to save your episode progress. Please try again.");
        } finally {
            input.disabled = false;
        }
    });

    tracker.append(label, input, progressText, progressTrack);

    return tracker;
}


// REMOVE ANIME

async function removeAnime(anime, type) {
    if (!auth.currentUser || !listsLoaded) {
        notify("Please sign in and wait for your lists to load.", "info");
        return;
    }

    const previousWatched = [...watchedList];
    const previousWishlist = [...wishlist];

    const keep = item => Number(item.id) !== Number(anime.id);

    if (type === "watched") {
        watchedList = watchedList.filter(keep);
    } else {
        wishlist = wishlist.filter(keep);
    }

    refreshAll();

    try {
        await saveLists();
    } catch (error) {
        console.error("Unable to remove anime:", error);

        watchedList = previousWatched;
        wishlist = previousWishlist;
        refreshAll();

        notify("Unable to remove anime. Please try again.");
    }
}

function makeMessage(message) {
    const element = document.createElement("p");
    element.className = "empty-message";
    element.textContent = message;
    return element;
}


// UPDATE CARD BUTTONS

function updateAllSearchButtons() {
    document.querySelectorAll(".anime-card[data-anime-id]").forEach(card => {
        updateCardButtons(card);
    });
}

function updateCardButtons(card) {
    const id = Number(card.dataset.animeId);
    const title = card.querySelector("h3")?.textContent ?? "this anime";

    const watchedButton = card.querySelector('[data-action="watched"]');
    const wishlistButton = card.querySelector('[data-action="wishlist"]');

    if (watchedButton) {
        const exists = watchedList.some(item => Number(item.id) === id);

        watchedButton.textContent = exists
            ? "✓ Watched"
            : "+ Watched";

        watchedButton.setAttribute("aria-pressed", String(exists));
        watchedButton.setAttribute("aria-label", `Watched: ${title}`);
    }

    if (wishlistButton) {
        const exists = wishlist.some(item => Number(item.id) === id);

        wishlistButton.textContent = exists
            ? "♥ Saved"
            : "♡ Wishlist";

        wishlistButton.setAttribute("aria-pressed", String(exists));
        wishlistButton.setAttribute("aria-label", `Wishlist: ${title}`);
    }
}


// HOMEPAGE ANIME SECTIONS

const PAGE_SIZE = 8;

const SECTIONS = [
    {
        key: "trending",
        containerId: "trendingAnime",
        sort: "TRENDING_DESC"
    },
    {
        key: "popular",
        containerId: "popularAnime",
        sort: "POPULARITY_DESC"
    },
    {
        key: "topRated",
        containerId: "topRatedAnime",
        sort: "SCORE_DESC",
        minimumScore: 70
    }
];

// Adds cards that are not already on screen and returns the new cards.
function appendAnime(container, animeList, shown) {
    const cards = animeList
        .filter(anime => !shown.has(anime.id))
        .map(anime => {
            shown.add(anime.id);
            return createAnimeCard(anime, true);
        });

    container.append(...cards);

    return cards;
}

function addViewMore(section, container, state) {
    const wrapper = document.createElement("div");
    wrapper.className = "section-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "view-more-button";
    button.textContent = "View more";
    button.setAttribute("aria-controls", section.containerId);

    wrapper.appendChild(button);
    container.after(wrapper);

    button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Loading...";

        try {
            const data = await aniListRequest(SECTION_QUERY, {
                page: state.page + 1,
                perPage: PAGE_SIZE,
                sort: [section.sort],
                minimumScore: section.minimumScore
            });

            state.page += 1;

            const cards = appendAnime(
                container,
                data.Page.media.map(formatAnime),
                state.shown
            );

            notify(`${cards.length} more anime loaded.`, "info");

            if (!data.Page.pageInfo.hasNextPage) {
                // The button is about to disappear, so keep keyboard focus.
                cards[0]
                    ?.querySelector(".details-button")
                    ?.focus({ preventScroll: true });

                wrapper.remove();
            }
        } catch (error) {
            console.error("Unable to load more anime:", error);
            notify("Unable to load more anime. Please try again.");
        } finally {
            if (wrapper.isConnected) {
                button.disabled = false;
                button.textContent = "View more";
            }
        }
    });
}

async function loadRecommendations() {
    // Only run on the page that actually has these sections.
    if (!$("trendingAnime")) return;

    try {
        const data = await aniListRequest(HOME_QUERY, { minimumScore: 70 });

        for (const section of SECTIONS) {
            const container = $(section.containerId);

            if (!container) continue;

            const page = data[section.key];
            const animeList = page.media.map(formatAnime);
            const state = { page: 1, shown: new Set() };

            container.replaceChildren();
            appendAnime(container, animeList, state.shown);
            container.setAttribute("aria-busy", "false");

            if (page.pageInfo.hasNextPage) {
                addViewMore(section, container, state);
            }

            if (section.key === "trending") {
                drawCharts(animeList);
            }
        }

    } catch (error) {
        console.error("Unable to load anime sections:", error);

        for (const section of SECTIONS) {
            const container = $(section.containerId);

            if (!container) continue;

            container.replaceChildren(
                makeMessage("Unable to load anime right now. Please refresh later.")
            );
            container.setAttribute("aria-busy", "false");
        }

        $("popularityChart")?.replaceChildren(makeMessage("No chart data is available."));
        $("ratingChart")?.replaceChildren(makeMessage("No chart data is available."));
    }
}


// POPULARITY AND RATING CHARTS

function drawCharts(animeList) {
    const popularityList = [...animeList]
        .filter(anime => anime.popularity > 0)
        .sort((a, b) => b.popularity - a.popularity)
        .slice(0, 8);

    const ratingList = [...animeList]
        .filter(anime => anime.score != null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

    drawBarChart("popularityChart", popularityList, "popularity", false);
    drawBarChart("ratingChart", ratingList, "score", true);
}

function drawBarChart(containerId, animeList, metric, isRating) {
    const container = $(containerId);

    if (!container) return;

    if (!animeList.length) {
        container.replaceChildren(makeMessage("No chart data is available."));
        return;
    }

    const maxValue = Math.max(
        ...animeList.map(anime => anime[metric] || 0),
        1
    );

    const formatValue = value =>
        isRating ? `${value}/100` : value.toLocaleString();

    // Text alternative for screen readers (the chart container is role="img").
    container.setAttribute(
        "aria-label",
        `${isRating ? "Average ratings" : "Popularity"}: ` +
        animeList
            .map(anime => `${anime.title} ${formatValue(anime[metric] || 0)}`)
            .join(", ")
    );

    const bars = [];

    const rows = animeList.map(anime => {
        const value = anime[metric] || 0;

        const row = document.createElement("div");
        row.className = "chart-row";

        const label = document.createElement("span");
        label.className = "chart-label";
        label.textContent = anime.title;

        const track = document.createElement("div");
        track.className = "chart-track";

        const bar = document.createElement("div");
        bar.className = isRating ? "chart-bar rating-bar" : "chart-bar";
        bar.style.width = "0%";

        bars.push({ bar, width: Math.max((value / maxValue) * 100, 2) });

        track.appendChild(bar);

        const displayedValue = document.createElement("span");
        displayedValue.className = "chart-value";
        displayedValue.textContent = formatValue(value);

        row.append(label, track, displayedValue);

        return row;
    });

    container.replaceChildren(...rows);

    // Grow the bars on the next frame so a CSS transition can animate them.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            bars.forEach(({ bar, width }) => {
                bar.style.width = `${width}%`;
            });
        });
    });
}


// PROFILE

function updateProfile() {
    if (currentUser) {
        setText("profileName", currentUser.displayName || "Anime Fan");
        setText("profileEmail", currentUser.email || "");

        setText(
            "profileStatus",
            listsLoaded
                ? "Signed in · Your collection is synced"
                : "Loading your collection..."
        );
    } else {
        setText("profileName", "Welcome, Anime Fan!");
        setText("profileEmail", "Log in to view your personal collection.");
        setText("profileStatus", "Not signed in");
    }

    setText("watchedCount", String(watchedList.length));
    setText("wishlistCount", String(wishlist.length));
}


// START WEBSITE

ensureToast();
displayLists();
updateProfile();
loadRecommendations();