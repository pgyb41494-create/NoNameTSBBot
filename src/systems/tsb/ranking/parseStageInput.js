/**
 * Parse stage / ranking command input, with optional region tokens.
 *
 * Prefix examples:
 *   !stage @user fl 2 high strong
 *   !stage @user "fl" 2 high strong "note"
 *   !stage @user "na east" ST3 High Strong "passed"
 *
 * Slash / stage input examples:
 *   fl 2 high strong
 *   2 high strong
 *   ST3 High Strong
 */

const { REGIONS } = require("../shared/profileAdapter");

/** Extra shortcuts people type in chat → profile region values */
const REGION_SHORTCUTS = [
    { keys: ["fl", "florida", "miami"], value: "miami" },
    { keys: ["tx", "texas", "dallas"], value: "dallas" },
    { keys: ["ca", "cali", "california", "la", "los angeles", "losangeles"], value: "los_angeles" },
    { keys: ["va", "virginia", "na east", "na-east", "naeast", "east coast"], value: "virginia" },
    { keys: ["il", "illinois", "chicago", "na central", "nacentral"], value: "chicago" },
    { keys: ["na west", "na-west", "nawest", "west coast"], value: "los_angeles" },
    { keys: ["br", "brazil", "brasil", "sao paulo", "saopaulo", "sp"], value: "sao_paulo" },
    { keys: ["cl", "chile", "santiago"], value: "santiago" },
    { keys: ["ar", "argentina", "buenos aires", "buenosaires"], value: "buenos_aires" },
    { keys: ["pe", "peru", "lima"], value: "lima" },
    { keys: ["co", "colombia", "bogota"], value: "bogota" },
    { keys: ["mx", "mexico", "mexico city", "mexicocity"], value: "mexico_city" },
    { keys: ["uk", "london", "eu west"], value: "london" },
    { keys: ["de", "germany", "frankfurt", "eu central"], value: "frankfurt" },
    { keys: ["nl", "netherlands", "amsterdam"], value: "amsterdam" },
    { keys: ["fr", "france", "paris"], value: "paris" },
    { keys: ["es", "spain", "madrid"], value: "madrid" },
    { keys: ["pl", "poland", "warsaw"], value: "warsaw" },
    { keys: ["jp", "japan", "tokyo"], value: "tokyo" },
    { keys: ["kr", "korea", "seoul"], value: "seoul" },
    { keys: ["sg", "singapore"], value: "singapore" },
    { keys: ["au", "australia", "sydney"], value: "sydney" },
    { keys: ["in", "india", "mumbai"], value: "mumbai" },
    { keys: ["ae", "uae", "dubai"], value: "dubai" },
    { keys: ["za", "south africa", "johannesburg"], value: "johannesburg" },
];

function regionLabelFor(value) {
    return REGIONS.find((r) => r.value === value)?.label || value;
}

function buildRegionLookup() {
    const map = new Map();
    const add = (key, value) => {
        const k = String(key || "").toLowerCase().trim().replace(/\s+/g, " ");
        if (!k || map.has(k)) return;
        map.set(k, value);
    };

    for (const entry of REGION_SHORTCUTS) {
        for (const key of entry.keys) add(key, entry.value);
    }
    for (const region of REGIONS) {
        add(region.value, region.value);
        add(region.value.replace(/_/g, " "), region.value);
        add(region.label, region.value);
        const city = String(region.label).split(",")[0].trim();
        if (city) add(city, region.value);
    }
    return map;
}

const REGION_LOOKUP = buildRegionLookup();

function parsePhaseTokens(tokens) {
    if (!tokens?.length) return null;
    const upper = tokens.map((t) => String(t).toUpperCase().replace(/[,./\-_]+/g, ""));

    // Explicit applicant: `1 applicant` · `applicant` · `ST1 applicant`
    const applicantOnly = upper.filter(Boolean);
    const isApplicantToken = (t) => /^(APPLICANT|APP|APPL)$/.test(t);
    if (applicantOnly.length === 1 && isApplicantToken(applicantOnly[0])) {
        return { phase: 1, tier: null, subtier: null, asApplicant: true };
    }
    if (applicantOnly.length === 2) {
        const phaseMatch = applicantOnly[0].match(/^(?:ST|S|PH|P|PHASE|STAGE|TIER|T)?(\d)$/i)
            || applicantOnly[0].match(/^(\d)$/);
        if (phaseMatch && isApplicantToken(applicantOnly[1])) {
            const value = parseInt(phaseMatch[1], 10);
            if (value >= 0 && value <= 5) {
                return { phase: value, tier: null, subtier: null, asApplicant: true };
            }
        }
        // Also accept `applicant 1`
        const phaseMatch2 = applicantOnly[1].match(/^(?:ST|S|PH|P|PHASE|STAGE|TIER|T)?(\d)$/i)
            || applicantOnly[1].match(/^(\d)$/);
        if (isApplicantToken(applicantOnly[0]) && phaseMatch2) {
            const value = parseInt(phaseMatch2[1], 10);
            if (value >= 0 && value <= 5) {
                return { phase: value, tier: null, subtier: null, asApplicant: true };
            }
        }
    }

    let phase = null;
    let tier = null;
    let subtier = null;

    for (const token of upper) {
        if (!token) continue;
        if (isApplicantToken(token)) {
            // Applicant mixed into a normal rank string is invalid — use `1 applicant` instead
            return null;
        }
        const phaseMatch = token.match(/^(?:ST|S|PH|P|PHASE|STAGE|TIER|T)(\d)$/i) || token.match(/^(\d)$/);
        if (phaseMatch && phase === null) {
            const value = parseInt(phaseMatch[1], 10);
            if (value >= 0 && value <= 5) {
                phase = value;
                continue;
            }
        }
        if (/^(HIGH|HI|H|ALTO|ALTA)$/.test(token) && !tier) { tier = "high"; continue; }
        if (/^(MID|M|MEDIO|MEDIA)$/.test(token) && !tier) { tier = "mid"; continue; }
        if (/^(LOW|LO|L|BAJO|BAJA)$/.test(token) && !tier) { tier = "low"; continue; }
        if (/^(STRONG|STR|FUERTE)$/.test(token) && !subtier) { subtier = "strong"; continue; }
        if (/^(STABLE|STB|ESTABLE)$/.test(token) && !subtier) { subtier = "stable"; continue; }
        if (/^(WEAK|WK|W|DEBIL|DÉBIL)$/.test(token) && !subtier) { subtier = "weak"; continue; }
    }

    if (phase === null || !tier || !subtier) return null;
    return { phase, tier, subtier, asApplicant: false };
}

function peelRegion(tokens) {
    for (let len = 3; len >= 1; len -= 1) {
        if (tokens.length < len) continue;
        const key = tokens.slice(0, len).map((t) => String(t).toLowerCase()).join(" ");
        const value = REGION_LOOKUP.get(key);
        if (!value) continue;
        return {
            region: value,
            regionLabel: regionLabelFor(value),
            regionRaw: tokens.slice(0, len).join(" "),
            rest: tokens.slice(len),
        };
    }
    return null;
}

/**
 * Pull trailing quoted notes: `2 high strong "good fight"`
 */
function splitStageNotes(raw) {
    const text = String(raw || "");
    const match = text.match(/\s+"([^"]*)"\s*$/) || text.match(/\s+'([^']*)'\s*$/);
    if (!match) return { body: text.trim(), notes: null };
    return {
        body: text.slice(0, match.index).trim(),
        notes: match[1],
    };
}

/**
 * @param {string} raw
 * @param {{ regionRequired?: boolean }} [opts]  // ignored — region comes from profile
 */
function parseStageInput(raw, opts = {}) {
    void opts;
    if (!raw || !String(raw).trim()) return null;

    const { body, notes } = splitStageNotes(raw);
    const tokens = String(body)
        .replace(/[,./]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);

    if (!tokens.length) return null;

    // Optional region override at the start; otherwise profile region is used
    const peeled = peelRegion(tokens);
    const phaseTokens = peeled ? peeled.rest : tokens;
    const phase = parsePhaseTokens(phaseTokens);
    if (!phase) return null;

    return {
        ...phase,
        region: peeled?.region || null,
        regionLabel: peeled?.regionLabel || null,
        notes: notes != null ? notes : null,
    };
}

/** Legacy alias used by older call sites */
function parsePhaseInput(raw) {
    const parsed = parseStageInput(raw);
    if (!parsed) return null;
    return { phase: parsed.phase, tier: parsed.tier, subtier: parsed.subtier };
}

function stageUsageLines(prefix, commandName, data = {}) {
    const pfx = String(prefix || "!").trim() || "!";
    const cmd = String(commandName || "stage").replace(/^[-/>!.]+/, "").trim().toLowerCase() || "stage";
    const sub = (data.subranksSkipped || !(data.subranks || []).length)
        ? "high"
        : String(data.subranks[0]).toLowerCase();
    const power = (data.powerRanksSkipped || !(data.powerRanks || []).length)
        ? "strong"
        : String(data.powerRanks[0]).toLowerCase();
    const rankBit = `2 ${sub} ${power}`;

    return [
        `\`${pfx}${cmd} @user ${rankBit}\``,
        `\`${pfx}${cmd} @user 1 applicant\``,
        `\`${pfx}${cmd} @user ${rankBit} "notes here"\``,
        `\`${pfx}${cmd} @user ST3 High Strong\``,
        `\`/stage\` · input \`${rankBit}\` or \`1 applicant\` · optional notes · region from profile`,
    ];
}

function regionUsageHint() {
    return "Regions: `fl` · `na east` · `dallas` · `miami` · `sao paulo` · city/server names from `/profile`";
}

/**
 * Discord slash autocomplete for `/stage region`.
 * @returns {{ name: string, value: string }[]}
 */
function autocompleteStageRegion(focusedValue = "") {
    const q = String(focusedValue || "").toLowerCase().trim();
    const choices = [];
    const seenValues = new Set();

    const push = (name, value) => {
        const v = String(value || "").trim();
        if (!v || seenValues.has(v.toLowerCase())) return;
        if (q) {
            const hay = `${name} ${v}`.toLowerCase();
            if (!hay.includes(q) && !v.toLowerCase().startsWith(q)) return;
        }
        seenValues.add(v.toLowerCase());
        choices.push({
            name: String(name).slice(0, 100),
            value: v.slice(0, 100),
        });
    };

    const preferred = [
        { name: "fl · Miami, Florida", value: "fl" },
        { name: "na east · Virginia / NA East", value: "na east" },
        { name: "na west · Los Angeles / NA West", value: "na west" },
        { name: "dallas · Dallas, Texas", value: "dallas" },
        { name: "chicago · Chicago, USA", value: "chicago" },
        { name: "sao paulo · Sao Paulo, Brazil", value: "sao paulo" },
        { name: "london · London, UK", value: "london" },
        { name: "frankfurt · Frankfurt, Germany", value: "frankfurt" },
    ];
    for (const item of preferred) push(item.name, item.value);

    for (const entry of REGION_SHORTCUTS) {
        const primary = entry.keys[0];
        push(`${primary} · ${regionLabelFor(entry.value)}`, primary);
    }

    for (const region of REGIONS) {
        const city = String(region.label).split(",")[0].trim().toLowerCase();
        push(`${city || region.value} · ${region.label}`, city || region.value.replace(/_/g, " "));
    }

    return choices.slice(0, 25);
}

module.exports = {
    parseStageInput,
    parsePhaseInput,
    splitStageNotes,
    stageUsageLines,
    regionUsageHint,
    autocompleteStageRegion,
    peelRegion,
    REGION_SHORTCUTS,
};
