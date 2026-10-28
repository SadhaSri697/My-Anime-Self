import {
    initializeApp,
    getApps
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

const app = getApps().length
    ? getApps()[0]
    : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();


// ELEMENTS

const $ = id => document.getElementById(id);

const signInButton = $("signInButton");
const signOutButton = $("signOutButton");

const watchedContainer = $("watchedList");
const wishlistContainer = $("wishlistList");

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
let statusMessage = "";   // temporary status such as "Restoring..."
let hashHandled = false;


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


// GOOGLE SIGN-IN / SIGN-OUT

signInButton?.addEventListener("click", async () => {
    signInButton.disabled = true;

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Sign-in error:", error);

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
                notify("This website address is not authorized. Add its hostname in Firebase Authentication settings.");
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
        console.error("Sign-out error:", error);
        notify("Unable to sign out. Please try again.");
    }
});


// NORMALIZE ANIME DATA (accepts saved data AND raw AniList objects)

function formatSeason(season) {
    if (!season || typeof season !== "string") {
        return "Unknown";
    }

    return season.charAt(0).toUpperCase() + season.slice(1).toLowerCase();
}

function clampEpisodes(watched, totalEpisodes) {
    const total = Number(totalEpisodes);

    let value = Math.max(0, Math.floor(Number(watched) || 0));

    if (Number.isFinite(total) && total > 0) {
        value = Math.min(value, total);
    }

    return value;
}

function normalizeAnime(anime) {
    return {
        id: Number(anime?.id),
        title:
            anime?.title?.english ||
            anime?.title?.romaji ||
            (typeof anime?.title === "string" ? anime.title : "") ||
            "Unknown Title",

        poster:
            anime?.poster ||
            anime?.coverImage?.extraLarge ||
            anime?.coverImage?.large ||
            "",

        episodes: anime?.episodes ?? null,
        episodesWatched: clampEpisodes(anime?.episodesWatched, anime?.episodes),
        year: anime?.year || anime?.seasonYear || anime?.startDate?.year || "Unknown",
        season: formatSeason(anime?.season),
        score: anime?.score ?? anime?.averageScore ?? null,
        popularity: anime?.popularity ?? 0
    };
}

// Key order does not matter, so Firestore's sorted keys never look "changed".
function canonical(list) {
    return JSON.stringify(
        list.map(item =>
            Object.fromEntries(
                Object.keys(item).sort().map(key => [key, item[key]])
            )
        )
    );
}


// REPAIR MISSING DETAILS (posters, and titles lost to an earlier bug)

const REPAIR_QUERY = `
    query ($ids: [Int], $perPage: Int) {
        Page(perPage: $perPage) {
            media(id_in: $ids, type: ANIME) {
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
            }
        }
    }
`;

function needsRepair(anime) {
    return !anime.poster || anime.title === "Unknown Title";
}

// One request per 50 anime instead of one request per anime.
async function fetchAnimeDetails(ids) {
    const details = new Map();

    for (let start = 0; start < ids.length; start += 50) {
        const chunk = ids.slice(start, start + 50);

        try {
            const response = await fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    query: REPAIR_QUERY,
                    variables: { ids: chunk, perPage: chunk.length }
                })
            });

            if (!response.ok) {
                continue;
            }

            const result = await response.json();

            for (const media of result.data?.Page?.media ?? []) {
                details.set(Number(media.id), media);
            }
        } catch (error) {
            console.error("Unable to restore anime details:", error);
        }
    }

    return details;
}

// Only fills in what is missing; never overwrites good data or progress.
function mergeDetails(anime, media) {
    const fresh = normalizeAnime(media);

    if (!anime.poster) anime.poster = fresh.poster;
    if (anime.title === "Unknown Title") anime.title = fresh.title;
    if (anime.year === "Unknown") anime.year = fresh.year;
    if (anime.season === "Unknown") anime.season = fresh.season;
    if (anime.score == null) anime.score = fresh.score;
    if (anime.episodes == null) anime.episodes = fresh.episodes;
    if (!anime.popularity) anime.popularity = fresh.popularity;

    anime.episodesWatched = clampEpisodes(anime.episodesWatched, anime.episodes);
}


// SAVE BOTH LISTS (queued so writes never overlap or finish out of order)

let saveChain = Promise.resolve();

function saveLists() {
    const user = auth.currentUser;

    if (!user || !listsLoaded) {
        return Promise.reject(new Error("Your lists have not finished loading."));
    }

    const run = () =>
        setDoc(doc(db, "users", user.uid, "lists", "main"), {
            watchedList,
            wishlist
        });

    const result = saveChain.then(run, run);
    saveChain = result.catch(() => {});

    return result;
}


// AUTHENTICATION AND DATA LOADING

onAuthStateChanged(auth, async user => {
    const version = ++authVersion;

    currentUser = user;
    listsLoaded = false;
    statusMessage = "";

    if (signInButton) signInButton.hidden = Boolean(user);
    if (signOutButton) signOutButton.hidden = !user;

    if (!user) {
        watchedList = [];
        wishlist = [];
        listsLoaded = true;

        updateProfile();
        displayLists();
        scrollToHash();
        return;
    }

    statusMessage = "Loading your collection...";
    updateProfile();

    let snapshot;

    try {
        snapshot = await getDoc(doc(db, "users", user.uid, "lists", "main"));
    } catch (error) {
        console.error("Unable to load profile:", error);

        if (version === authVersion) {
            statusMessage = "Unable to load your collection.";
            updateProfile();
            notify("Unable to load your anime lists. Check your connection and try again.");
        }

        return;
    }

    if (version !== authVersion || auth.currentUser?.uid !== user.uid) {
        return;
    }

    const data = snapshot.exists() ? snapshot.data() : {};

    const rawWatched = Array.isArray(data.watchedList) ? data.watchedList : [];
    const rawWishlist = Array.isArray(data.wishlist) ? data.wishlist : [];

    // Remove duplicates from Watched.
    const watchedIds = new Set();

    watchedList = rawWatched
        .map(normalizeAnime)
        .filter(anime => {
            if (!Number.isFinite(anime.id) || watchedIds.has(anime.id)) {
                return false;
            }

            watchedIds.add(anime.id);
            return true;
        });

    // Remove duplicates and overlaps from Wishlist (Watched wins).
    const wishlistIds = new Set();

    wishlist = rawWishlist
        .map(normalizeAnime)
        .filter(anime => {
            if (
                !Number.isFinite(anime.id) ||
                watchedIds.has(anime.id) ||
                wishlistIds.has(anime.id)
            ) {
                return false;
            }

            wishlistIds.add(anime.id);
            return true;
        });

    // Show the collection right away; repairs happen afterwards.
    listsLoaded = true;
    statusMessage = "";

    updateProfile();
    displayLists();
    scrollToHash();

    // Restore anything missing without losing episode progress.
    const toRepair = [...watchedList, ...wishlist].filter(needsRepair);

    if (toRepair.length > 0) {
        statusMessage = "Restoring missing anime details...";
        updateProfile();

        const details = await fetchAnimeDetails([
            ...new Set(toRepair.map(anime => anime.id))
        ]);

        if (version !== authVersion || auth.currentUser?.uid !== user.uid) {
            return;
        }

        toRepair.forEach(anime => {
            const media = details.get(anime.id);

            if (media) {
                mergeDetails(anime, media);
            }
        });

        statusMessage = "";
        updateProfile();
        displayLists();
    }

    // Only write to Firebase when something actually changed.
    const changed =
        canonical(watchedList) !== canonical(rawWatched) ||
        canonical(wishlist) !== canonical(rawWishlist);

    if (changed) {
        try {
            await saveLists();
        } catch (error) {
            // Non-fatal: the collection is already on screen.
            console.error("Unable to save cleaned lists:", error);
            notify("Your collection loaded, but the cleanup could not be saved.", "info");
        }
    }
});


// UPDATE PROFILE INFORMATION

function updateProfile() {
    if (currentUser) {
        setText("profileName", currentUser.displayName || "Anime Fan");
        setText("profileEmail", currentUser.email || "");

        setText(
            "profileStatus",
            statusMessage ||
            (listsLoaded
                ? "Signed in · Your collection is synced"
                : "Loading your collection...")
        );
    } else {
        setText("profileName", "Welcome, Anime Fan!");
        setText("profileEmail", "Please log in to view your collection.");
        setText("profileStatus", "Not signed in");
    }

    setText("watchedCount", String(watchedList.length));
    setText("wishlistCount", String(wishlist.length));
}

// The page content loads after the browser has already jumped to #watched or
// #wishlist, so scroll there again once the lists are on screen.
function scrollToHash() {
    if (hashHandled || !location.hash) return;

    hashHandled = true;

    $(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({
        behavior: scrollBehavior(),
        block: "start"
    });
}


// DISPLAY BOTH LISTS

function displayLists() {
    displayOneList(watchedContainer, watchedList, "watched");
    displayOneList(wishlistContainer, wishlist, "wishlist");
}

function displayOneList(container, list, type) {
    if (!container) return;

    container.setAttribute("aria-busy", "false");

    if (list.length === 0) {
        const message = document.createElement("p");
        message.className = "empty-message";

        if (!currentUser) {
            message.textContent = type === "watched"
                ? "Log in to see your watched anime."
                : "Log in to see your wishlist.";
        } else {
            message.textContent = type === "watched"
                ? "Your watched anime will appear here."
                : "Anime you want to watch will appear here.";
        }

        container.replaceChildren(message);
        return;
    }

    const cards = list.map(anime => {
        const card = document.createElement("article");
        card.className = "anime-card";
        card.dataset.animeId = anime.id;

        const info = createCardBody(anime);

        if (type === "watched") {
            addEpisodeTracker(info, anime);
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
        card.append(createPosterFrame(anime), info);

        return card;
    });

    container.replaceChildren(...cards);
}


// EPISODE TRACKING FOR WATCHED ANIME ONLY

function addEpisodeTracker(info, anime) {
    const tracker = document.createElement("div");
    tracker.className = "episode-tracker";

    const total = Number(anime.episodes);
    const hasTotal =
        anime.episodes != null && Number.isFinite(total) && total > 0;

    // The last value known to be saved, used for rollbacks.
    let lastSaved = anime.episodesWatched;

    const inputId = `episodes-${anime.id}`;

    const label = document.createElement("label");
    label.className = "episode-label";
    label.htmlFor = inputId;
    label.textContent = "📺 Episodes watched";

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "number";
    input.inputMode = "numeric";
    input.min = "0";
    input.step = "1";
    input.className = "episode-input";
    input.value = anime.episodesWatched;
    input.setAttribute("aria-label", `Episodes watched for ${anime.title}`);

    if (hasTotal) {
        input.max = String(total);
        input.placeholder = `Out of ${total} episodes`;
    } else {
        input.placeholder = "Enter episodes watched";
    }

    const progressText = document.createElement("p");
    progressText.className = "episode-progress-text";

    const track = document.createElement("div");
    track.className = "episode-progress-track";

    if (hasTotal) {
        track.setAttribute("role", "progressbar");
        track.setAttribute("aria-label", `Progress for ${anime.title}`);
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", String(total));
    }

    const bar = document.createElement("div");
    bar.className = "episode-progress-bar";

    track.appendChild(bar);

    const updateProgress = value => {
        if (hasTotal) {
            const percentage = Math.min(100, Math.round((value / total) * 100));

            progressText.textContent =
                `${value} / ${total} episodes · ${percentage}%` +
                (value >= total ? " · Completed! 🎉" : "");

            bar.style.width = `${percentage}%`;
            track.setAttribute("aria-valuenow", String(value));
        } else {
            progressText.textContent =
                `${value} episodes watched · Total unknown`;

            bar.style.width = "0%";
        }
    };

    updateProgress(lastSaved);

    input.addEventListener("change", async () => {
        if (!auth.currentUser || !listsLoaded) {
            notify("Please sign in and wait for your collection to load.", "info");
            input.value = lastSaved;
            return;
        }

        let value = Math.floor(Number(input.value));

        if (!Number.isFinite(value) || value < 0) {
            value = 0;
        }

        if (hasTotal) {
            value = Math.min(value, total);
        }

        input.value = value;

        if (value === lastSaved) {
            return;
        }

        const currentAnime = watchedList.find(item => item.id === anime.id);

        if (!currentAnime) {
            return;
        }

        currentAnime.episodesWatched = value;
        updateProgress(value);
        input.disabled = true;

        try {
            await saveLists();
            lastSaved = value;
        } catch (error) {
            console.error("Unable to save episode progress:", error);

            currentAnime.episodesWatched = lastSaved;
            input.value = lastSaved;
            updateProgress(lastSaved);

            notify("Unable to save episode progress. Please try again.");
        } finally {
            input.disabled = false;
        }
    });

    tracker.append(label, input, progressText, track);
    info.appendChild(tracker);
}


// REMOVE ANIME FROM A LIST

async function removeAnime(anime, type) {
    if (!auth.currentUser || !listsLoaded) {
        notify("Please sign in and wait for your collection to load.", "info");
        return;
    }

    const previousWatched = [...watchedList];
    const previousWishlist = [...wishlist];

    if (type === "watched") {
        watchedList = watchedList.filter(item => item.id !== anime.id);
    } else {
        wishlist = wishlist.filter(item => item.id !== anime.id);
    }

    displayLists();
    updateProfile();

    try {
        await saveLists();
    } catch (error) {
        console.error("Unable to remove anime:", error);

        watchedList = previousWatched;
        wishlist = previousWishlist;

        displayLists();
        updateProfile();

        notify("Unable to remove anime. Please try again.");
    }
}


// START

ensureToast();