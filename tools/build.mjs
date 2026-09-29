// Builds data/rounds.json, the fixed set of "real vs AI" rounds the game plays,
// so anyone can play without signing in. Every stage caches its output in
// data/ and skips work that is already done, so it is cheap to re-run.
//
//   node tools/build.mjs select            pick real Commons photos and Wikipedia sentences
//   node tools/build.mjs captions <keyfile>  describe each real photo, so the fake shows the same kind of scene
//   node tools/build.mjs fakes <keyfile>   generate the AI images and sentences
//   node tools/build.mjs tells <keyfile>   ask a vision/text model what gives each fake away
//   node tools/build.mjs assemble          write data/rounds.json
//
// Real images: Wikimedia Commons Featured pictures (credit and licence kept).
// Real sentences: Wikipedia lead sentences (CC BY-SA 4.0).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const IMG = join(DATA, "img");
const UA =
    "spot-the-fake-build/1.0 (https://github.com/tomdacatto/pollinations-spot-the-fake)";
const GEN = "https://gen.pollinations.ai";

// Categories with photos that are hard to fake and easy to credit.
const CATEGORIES = [
    "Featured pictures of Araneae",
    "Featured pictures of Anura",
    "Featured pictures of Actinopterygii",
    "Featured pictures of Buddhist temples",
    "Featured pictures of Christian monasteries",
    "Featured pictures of California",
    "Featured pictures of Bavaria",
];
const PER_CATEGORY = 2;
const TOPICS = [
    "Octopus",
    "Eiffel Tower",
    "Honey bee",
    "Volcano",
    "Coffee",
    "Rainbow",
    "Moon",
    "Bicycle",
];

// Easy rounds use a fast model that still leaves visible tells; hard rounds a more photorealistic one.
const MODELS = {
    easy: "black-forest-labs/flux.1-schnell",
    hard: "tongyi-mai/z-image-turbo",
};
const VISION = "google/gemini-3.5-flash-lite";
const TEXT = "openai/gpt-5.4-nano";

const path = (...p) => join(ROOT, ...p);
const load = (file, fallback) =>
    existsSync(path(file))
        ? JSON.parse(readFileSync(path(file), "utf8"))
        : fallback;
const save = (file, value) =>
    writeFileSync(path(file), `${JSON.stringify(value, null, 2)}\n`);
const strip = (html) =>
    String(html ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();

// Deterministic shuffle so a re-run picks the same photos.
function rng(seed) {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return (s - 1) / 2147483646;
    };
}
const shuffled = (list, r) =>
    list
        .map((v) => [r(), v])
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => v);

async function json(url, init) {
    const res = await fetch(url, {
        headers: { "User-Agent": UA, ...init?.headers },
        ...init,
    });
    if (!res.ok)
        throw new Error(
            `${res.status} ${url}: ${(await res.text()).slice(0, 200)}`,
        );
    return res.json();
}

// --- select ---------------------------------------------------------------------

async function commonsPhotos(category) {
    const q = new URLSearchParams({
        action: "query",
        format: "json",
        generator: "categorymembers",
        gcmtitle: `Category:${category}`,
        gcmtype: "file",
        gcmlimit: "60",
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: "768",
    });
    const data = await json(`https://commons.wikimedia.org/w/api.php?${q}`);
    return Object.values(data.query?.pages ?? {})
        .map((p) => {
            const i = p.imageinfo?.[0];
            const m = i?.extmetadata ?? {};
            return (
                i && {
                    title: strip(
                        p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
                    ),
                    thumb: i.thumburl,
                    page: i.descriptionshorturl,
                    mime: i.mime,
                    w: i.width,
                    h: i.height,
                    description: strip(m.ImageDescription?.value),
                    author: strip(m.Artist?.value).slice(0, 80),
                    license: strip(m.LicenseShortName?.value),
                    licenseUrl: m.LicenseUrl?.value ?? null,
                }
            );
        })
        .filter(
            (p) =>
                p &&
                p.mime === "image/jpeg" &&
                p.w >= 1600 &&
                p.w / p.h >= 1.3 &&
                p.w / p.h <= 1.8,
        )
        .filter(
            (p) =>
                p.license &&
                p.author &&
                p.description.length >= 25 &&
                p.description.length <= 220 &&
                /^[\x20-\x7e]+$/.test(p.description),
        )
        .filter((p) => !/\b(20\d\d|19\d\d)\b.*\bby\b/i.test(p.title));
}

async function firstSentence(title) {
    const s = await json(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    );
    const text = s.extract.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ");
    const sentence = text.match(/^.+?[a-z0-9)]\.(?=\s+[A-Z]|$)/)?.[0] ?? text;
    return { title: s.title, url: s.content_urls.desktop.page, text: sentence };
}

async function select() {
    mkdirSync(IMG, { recursive: true });
    const r = rng(20260929);
    const picks = load("data/picks.json", { photos: [], sentences: [] });
    if (!picks.photos.length) {
        for (const category of CATEGORIES) {
            const chosen = shuffled(await commonsPhotos(category), r).slice(
                0,
                PER_CATEGORY,
            );
            for (const p of chosen)
                picks.photos.push({
                    id: `p${String(picks.photos.length + 1).padStart(2, "0")}`,
                    category,
                    ...p,
                });
        }
    }
    for (const p of picks.photos) {
        const file = `data/img/${p.id}-real.jpg`;
        if (existsSync(path(file))) continue;
        const res = await fetch(p.thumb, { headers: { "User-Agent": UA } });
        if (!res.ok) throw new Error(`thumbnail ${res.status} ${p.thumb}`);
        writeFileSync(path(file), Buffer.from(await res.arrayBuffer()));
        console.log("downloaded", file, p.title);
    }
    if (!picks.sentences.length)
        for (const t of TOPICS)
            picks.sentences.push({
                id: `t${String(picks.sentences.length + 1).padStart(2, "0")}`,
                ...(await firstSentence(t)),
            });
    save("data/picks.json", picks);
    console.log(
        `${picks.photos.length} photos, ${picks.sentences.length} sentences`,
    );
}

// --- fakes ----------------------------------------------------------------------

const KEY = () => readFileSync(process.argv[3], "utf8").trim();
const auth = () => ({ Authorization: `Bearer ${KEY()}` });

async function chat(model, content, jsonMode = false) {
    const res = await json(`${GEN}/v1/chat/completions`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content }],
            ...(jsonMode && { response_format: { type: "json_object" } }),
        }),
    });
    return res.choices[0].message.content.trim();
}

const tier = (i) => (i % 2 === 0 ? "easy" : "hard");

// A vision model describes what is actually in each real photo, so the fake
// depicts the same kind of scene (Commons descriptions are often just a
// species or place name, which gives a fake of something else entirely).
async function captions() {
    const picks = load("data/picks.json");
    for (const p of picks.photos) {
        if (p.caption) continue;
        const data = `data:image/jpeg;base64,${readFileSync(path(`data/img/${p.id}-real.jpg`)).toString("base64")}`;
        p.caption = (
            await chat(VISION, [
                {
                    type: "text",
                    text: "Describe this photograph so an artist could recreate a similar one: the subject, its pose, the setting, the framing, the lighting and the dominant colours. One sentence, at most 40 words. No proper names, no place names, no camera settings. Reply with the sentence only.",
                },
                { type: "image_url", image_url: { url: data } },
            ])
        ).replace(/\s+/g, " ");
        console.log(p.id, p.caption);
    }
    save("data/picks.json", picks);
}

async function fakes() {
    const picks = load("data/picks.json");
    for (const [i, p] of picks.photos.entries()) {
        const file = `data/img/${p.id}-fake.jpg`;
        p.tier = tier(i);
        p.model = MODELS[p.tier];
        if (existsSync(path(file))) continue;
        const style =
            p.tier === "hard"
                ? "Candid unretouched photograph, natural light, shot on a full-frame camera, fine detail"
                : "Photograph, natural light";
        const prompt = `${p.caption.replace(/\.$/, "")}. ${style}. No text, no watermark.`;
        const q = new URLSearchParams({
            model: p.model,
            width: "768",
            height: "512",
            seed: String(1000 + i),
        });
        const res = await fetch(
            `${GEN}/image/${encodeURIComponent(prompt)}?${q}`,
            { headers: auth() },
        );
        if (!res.ok)
            throw new Error(
                `image ${res.status}: ${(await res.text()).slice(0, 200)}`,
            );
        writeFileSync(path(file), Buffer.from(await res.arrayBuffer()));
        console.log("generated", file, p.model);
    }
    for (const [i, s] of picks.sentences.entries()) {
        s.tier = tier(i);
        if (s.fake) continue;
        const n = s.text.length;
        s.fake = await chat(
            TEXT,
            s.tier === "hard"
                ? `Write one sentence in the style of the opening sentence of a Wikipedia article about "${s.title}", plain and encyclopedic, about ${n} characters. Reply with the sentence only.`
                : `Write one sentence about "${s.title}", about ${n} characters. Reply with the sentence only.`,
        );
        console.log("sentence", s.title, "->", s.fake);
    }
    save("data/picks.json", picks);
}

// --- tells ----------------------------------------------------------------------

async function tells() {
    const picks = load("data/picks.json");
    const url = (file) =>
        `data:image/jpeg;base64,${readFileSync(path(file)).toString("base64")}`;
    for (const p of picks.photos) {
        if (p.tell) continue;
        // The model sees the real photo next to the fake, so its answer is grounded in a difference it can see.
        p.tell = await chat(VISION, [
            {
                type: "text",
                text: "Image 1 is a real photograph. Image 2 was generated by AI to imitate it. In one sentence of at most 25 words, point out one specific, visible detail in image 2 that gives it away (anatomy, texture, edges, text, lighting, perspective, repeated patterns, background). Be concrete about what you can see in image 2. Do not say 'too clean' or 'too smooth'. Reply with the sentence only.",
            },
            {
                type: "image_url",
                image_url: { url: url(`data/img/${p.id}-real.jpg`) },
            },
            {
                type: "image_url",
                image_url: { url: url(`data/img/${p.id}-fake.jpg`) },
            },
        ]);
        console.log(p.id, p.tell);
    }
    for (const s of picks.sentences) {
        if (s.tell) continue;
        s.tell = await chat(
            TEXT,
            `One of these sentences is from Wikipedia and one was written by an AI.
Human: ${s.text}
AI: ${s.fake}
Write one sentence of at most 25 words explaining what in the AI sentence's wording gives it away compared with the human one. Be specific. Do not repeat either sentence. Reply with your explanation only.`,
        );
        console.log(s.id, s.tell);
    }
    save("data/picks.json", picks);
}

// --- assemble -------------------------------------------------------------------

// Commons author fields can hold URLs and boilerplate; keep a short name.
const author = (a) =>
    a
        .replace(/\(?https?:\/\/\S*\)?/g, "")
        .replace(/^Photo by and \(c\)\d{4}\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();

function assemble() {
    const picks = load("data/picks.json");
    const rounds = [
        ...picks.photos.map((p) => ({
            id: p.id,
            kind: "image",
            tier: p.tier,
            real: {
                src: `data/img/${p.id}-real.jpg`,
                credit: {
                    title: p.title,
                    author: author(p.author),
                    license: p.license,
                    licenseUrl: p.licenseUrl,
                    url: p.page,
                },
            },
            fake: { src: `data/img/${p.id}-fake.jpg`, model: p.model },
            tell: p.tell,
        })),
        ...picks.sentences.map((s) => ({
            id: s.id,
            kind: "text",
            tier: s.tier,
            real: {
                text: s.text,
                credit: {
                    title: `${s.title} (Wikipedia)`,
                    license: "CC BY-SA 4.0",
                    licenseUrl:
                        "https://creativecommons.org/licenses/by-sa/4.0/",
                    url: s.url,
                },
            },
            fake: { text: s.fake, model: TEXT },
            tell: s.tell,
        })),
    ];
    save("data/rounds.json", {
        built: new Date().toISOString().slice(0, 10),
        rounds,
    });
    const rows = rounds.map((r) => {
        const c = r.real.credit;
        const item =
            r.kind === "image"
                ? `[${r.real.src.split("/").pop()}](img/${r.real.src.split("/").pop()})`
                : "sentence";
        return `| ${item} | [${c.title.replace(/\|/g, "/")}](${c.url}) | ${c.author ?? "Wikipedia contributors"} | [${c.license}](${c.licenseUrl ?? c.url}) |`;
    });
    const header = [
        "# Credits",
        "",
        "The real photos are Wikimedia Commons Featured pictures and the real sentences are Wikipedia lead sentences. Each keeps its own licence (attribution and share-alike apply); the photos are thumbnails as served by Commons. The AI images and sentences were generated for this game.",
        "",
        "| File | Source | Author | Licence |",
        "| --- | --- | --- | --- |",
    ];
    writeFileSync(
        path("data/CREDITS.md"),
        `${[...header, ...rows].join("\n")}\n`,
    );
    console.log(`wrote ${rounds.length} rounds and data/CREDITS.md`);
}

const stages = { select, captions, fakes, tells, assemble };
const stage = stages[process.argv[2]];
if (!stage)
    throw new Error(
        `usage: node tools/build.mjs <${Object.keys(stages).join("|")}> [keyfile]`,
    );
await stage();
