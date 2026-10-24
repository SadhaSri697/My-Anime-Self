// Shared UI pieces used by both script.js (home) and profile.js (profile):
// compact card parts and the "View details" dialog.

const ANILIST_URL = "https://graphql.anilist.co";

const DETAILS_QUERY = `
    query ($id: Int) {
        Media(id: $id, type: ANIME) {
            id
            title {
                romaji
                english
                native
            }
            coverImage {
                extraLarge
                large
            }
            bannerImage
            description(asHtml: false)
            genres
            format
            status
            episodes
            duration
            season
            seasonYear
            source
            startDate {
                year
                month
                day
            }
            endDate {
                year
                month
                day
            }
            averageScore
            popularity
            studios(isMain: true) {
                nodes {
                    name
                }
            }
            trailer {
                id
                site
            }
            siteUrl
        }
    }
`;

const FORMAT_LABELS = {
    TV: "TV",
    TV_SHORT: "TV Short",
    MOVIE: "Movie",
    SPECIAL: "Special",
    OVA: "OVA",
    ONA: "ONA",
    MUSIC: "Music"
};

const STATUS_LABELS = {
    FINISHED: "Finished",
    RELEASING: "Airing",
    NOT_YET_RELEASED: "Not yet released",
    CANCELLED: "Cancelled",
    HIATUS: "On hiatus"
};


// SMALL HELPERS

function el(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
        node.className = className;
    }

    if (text != null) {
        node.textContent = text;
    }

    return node;
}

function humanize(value) {
    if (!value) return null;

    const text = String(value).replaceAll("_", " ").toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDate({ year, month, day } = {}) {
    if (!year) return null;

    const date = new Date(year, (month || 1) - 1, day || 1);

    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: month ? "short" : undefined,
        day: day ? "numeric" : undefined
    });
}

// AniList descriptions contain HTML such as <br> and <i>.
// We turn them into plain text; nothing from the API is ever inserted as HTML.
function descriptionParagraphs(description) {
    if (!description) return [];

    const withBreaks = description.replace(/<br\s*\/?>/gi, "\n");
    const text = new DOMParser()
        .parseFromString(withBreaks, "text/html")
        .body.textContent || "";

    return text
        .split(/\n+/)
        .map(paragraph => paragraph.trim())
        .filter(Boolean);
}

function formatMeta(anime) {
    const parts = [];

    if (anime.year && anime.year !== "Unknown") parts.push(anime.year);
    if (anime.season && anime.season !== "Unknown") parts.push(anime.season);

    parts.push(`${anime.episodes ?? "?"} eps`);

    return parts.join(" · ");
}


// CARD PIECES

function createPlaceholder() {
    return el("div", "poster-placeholder", "Poster unavailable");
}

// AniList serves several sizes of the same cover. Older saved anime store the
// "large" one (230px), which looks blurry on modern screens, so ask for
// "extraLarge" (460px) and fall back to the original if it is unavailable.
function sharpPoster(url) {
    return url.replace("/cover/large/", "/cover/extraLarge/");
}

function createPoster(anime) {
    if (!anime.poster) {
        return createPlaceholder();
    }

    const image = document.createElement("img");
    image.className = "anime-poster";
    image.alt = `${anime.title} poster`;
    image.width = 230;    // reserves space and prevents layout shift
    image.height = 325;
    image.loading = "lazy";
    image.decoding = "async";

    const sharp = sharpPoster(anime.poster);

    image.addEventListener("error", () => {
        if (image.src !== anime.poster && sharp !== anime.poster) {
            image.src = anime.poster; // try the original size once
        } else {
            image.replaceWith(createPlaceholder());
        }
    });

    image.src = sharp;

    return image;
}

function createRatingBadge(score) {
    if (score == null) {
        return null;
    }

    const badge = el("span", "rating-badge");
    badge.title = `${score} out of 100`;

    badge.append(
        el("span", "sr-only", "Rating: "),
        `★ ${score}`,
        el("span", "sr-only", " out of 100")
    );

    return badge;
}

// Poster with the rating badge on top. Clicking the poster opens the details
// (keyboard users use the "View details" button instead).
export function createPosterFrame(anime) {
    const frame = el("div", "poster-frame");

    frame.append(createPoster(anime));

    const badge = createRatingBadge(anime.score);

    if (badge) {
        frame.appendChild(badge);
    }

    frame.addEventListener("click", () => openAnimeDetails(anime));

    return frame;
}

// Title, one compact info line and the "View details" button.
export function createCardBody(anime) {
    const info = el("div", "anime-info");

    const heading = el("h3", null, anime.title);
    heading.title = anime.title;

    const detailsButton = el("button", "details-button", "View details");
    detailsButton.type = "button";
    detailsButton.setAttribute("aria-haspopup", "dialog");
    detailsButton.setAttribute("aria-label", `View details for ${anime.title}`);
    detailsButton.addEventListener("click", () => openAnimeDetails(anime));

    info.append(heading, el("p", "anime-meta", formatMeta(anime)), detailsButton);

    return info;
}


// DETAILS DIALOG

const detailsCache = new Map();

let dialog;
let content;
let controller;
let requestCounter = 0;

function ensureDialog() {
    if (dialog) {
        return dialog;
    }

    dialog = document.createElement("dialog");
    dialog.className = "details-dialog";
    dialog.setAttribute("aria-labelledby", "detailsTitle");

    const closeButton = el("button", "details-close", "×");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close details");
    closeButton.addEventListener("click", () => dialog.close());

    content = el("div", "details-body");

    dialog.append(closeButton, content);

    // Clicking the dark area outside the dialog closes it.
    dialog.addEventListener("click", event => {
        if (event.target === dialog) {
            dialog.close();
        }
    });

    dialog.addEventListener("close", () => {
        controller?.abort();
        requestCounter++;
        document.body.classList.remove("no-scroll");
    });

    document.body.appendChild(dialog);

    return dialog;
}

async function fetchDetails(id, signal) {
    const response = await fetch(ANILIST_URL, {
        method: "POST",
        signal,
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({
            query: DETAILS_QUERY,
            variables: { id }
        })
    });

    if (!response.ok) {
        throw new Error("Details request failed: " + response.status);
    }

    const result = await response.json();

    if (result.errors) {
        throw new Error(result.errors[0].message);
    }

    return result.data.Media;
}

export async function openAnimeDetails(anime) {
    const modal = ensureDialog();
    const requestId = ++requestCounter;

    controller?.abort();
    controller = new AbortController();

    renderLoading(anime);

    if (!modal.open) {
        modal.showModal();
        document.body.classList.add("no-scroll");
    }

    const id = Number(anime.id);

    try {
        let media = detailsCache.get(id);

        if (!media) {
            media = await fetchDetails(id, controller.signal);
            detailsCache.set(id, media);
        }

        if (requestId !== requestCounter) return;

        renderDetails(media, anime);

    } catch (error) {
        if (error.name === "AbortError" || requestId !== requestCounter) {
            return;
        }

        console.error("Unable to load anime details:", error);
        renderError(anime);
    }
}

function buildPoster(url, title) {
    if (!url) {
        return createPlaceholder();
    }

    const image = document.createElement("img");
    image.className = "details-poster";
    image.alt = `${title} poster`;
    image.width = 230;
    image.height = 325;
    image.decoding = "async";
    image.src = url;

    image.addEventListener(
        "error",
        () => image.replaceWith(createPlaceholder()),
        { once: true }
    );

    return image;
}

function renderLoading(anime) {
    const main = el("div", "details-main");

    const text = el("div", "details-content");

    const heading = el("h2", null, anime.title);
    heading.id = "detailsTitle";

    const status = el("p", "details-note", "Loading details...");
    status.setAttribute("role", "status");

    text.append(heading, status);
    main.append(buildPoster(anime.poster, anime.title), text);

    content.replaceChildren(main);
}

function renderError(anime) {
    const main = el("div", "details-main");

    const text = el("div", "details-content");

    const heading = el("h2", null, anime.title);
    heading.id = "detailsTitle";

    const message = el("p", "details-note", "Unable to load details right now.");
    message.setAttribute("role", "alert");

    const retry = el("button", "view-more-button", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => openAnimeDetails(anime));

    text.append(heading, message, retry);
    main.append(buildPoster(anime.poster, anime.title), text);

    content.replaceChildren(main);
}

function renderDetails(media, fallback) {
    const title = media.title?.english || media.title?.romaji || fallback.title;
    const parts = [];

    // Banner (optional)
    if (media.bannerImage && media.bannerImage.startsWith("https://")) {
        const banner = el("img", "details-banner");
        banner.alt = "";
        banner.decoding = "async";
        banner.src = media.bannerImage;
        banner.addEventListener("error", () => banner.remove(), { once: true });
        parts.push(banner);
    }

    const main = el("div", "details-main");

    const poster = buildPoster(
        media.coverImage?.extraLarge || media.coverImage?.large || fallback.poster,
        title
    );

    const text = el("div", "details-content");

    // Title
    const heading = el("h2", null, title);
    heading.id = "detailsTitle";
    text.appendChild(heading);

    const alternateTitles = [media.title?.romaji, media.title?.native]
        .filter(name => name && name !== title);

    if (alternateTitles.length) {
        text.appendChild(el("p", "details-alt-title", alternateTitles.join(" · ")));
    }

    // Quick facts as chips
    const chips = el("ul", "details-chips");
    chips.setAttribute("aria-label", "Quick facts");

    const addChip = (label, className) => {
        if (label) {
            chips.appendChild(el("li", className, label));
        }
    };

    if (media.averageScore != null) {
        addChip(`★ ${media.averageScore}/100`, "chip chip-score");
    }

    addChip(FORMAT_LABELS[media.format] || humanize(media.format), "chip");
    addChip(STATUS_LABELS[media.status] || humanize(media.status), "chip");
    addChip(String(media.seasonYear || media.startDate?.year || ""), "chip");

    if (chips.children.length) {
        text.appendChild(chips);
    }

    // Facts list
    const studios = (media.studios?.nodes || []).map(node => node.name).join(", ");
    const season = [humanize(media.season), media.seasonYear].filter(Boolean).join(" ");

    const facts = [
        ["Episodes", media.episodes ?? "Unknown"],
        ["Duration", media.duration ? `${media.duration} min per episode` : null],
        ["Season", season || null],
        ["Studio", studios || null],
        ["Source", humanize(media.source)],
        ["Started", formatDate(media.startDate)],
        ["Ended", formatDate(media.endDate)],
        ["Popularity", media.popularity ? media.popularity.toLocaleString() : null]
    ].filter(([, value]) => value != null);

    const list = el("dl", "details-facts");

    facts.forEach(([label, value]) => {
        const row = el("div");
        row.append(el("dt", null, label), el("dd", null, String(value)));
        list.appendChild(row);
    });

    text.appendChild(list);

    // Genres
    if (media.genres?.length) {
        text.appendChild(el("h3", null, "Genres"));

        const genres = el("ul", "details-chips");

        media.genres.forEach(genre => genres.appendChild(el("li", "chip", genre)));

        text.appendChild(genres);
    }

    // Synopsis
    text.appendChild(el("h3", null, "Description"));

    const paragraphs = descriptionParagraphs(media.description);

    if (paragraphs.length) {
        paragraphs.forEach(paragraph =>
            text.appendChild(el("p", "details-description", paragraph))
        );
    } else {
        text.appendChild(el("p", "details-note", "No description available."));
    }

    // Links
    const links = el("div", "details-links");

    const addLink = (label, href) => {
        const link = el("a", "details-link", label);
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        links.appendChild(link);
    };

    if (media.trailer?.site === "youtube" && /^[\w-]+$/.test(media.trailer.id || "")) {
        addLink("▶ Watch trailer", `https://www.youtube.com/watch?v=${media.trailer.id}`);
    }

    if (links.children.length) {
        text.appendChild(links);
    }

    main.append(poster, text);
    parts.push(main);

    content.replaceChildren(...parts);
    content.scrollTop = 0;
}