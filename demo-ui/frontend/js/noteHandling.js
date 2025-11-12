// Note rendering and highlight management
import { state } from './state.js';
import { elements, placeholderText } from './elements.js';
import { QUOTE_TRIM_REGEX, TRAILING_PUNCT_REGEX } from './constants.js';

// Normalize note text
function normalizeNote(text) {
    if (typeof text !== "string") return "";
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Decode token fragment (handles special characters)
export function decodeTokenFragment(token) {
    if (typeof token !== "string") {
        return "";
    }
    return normalizeNote(
        token
            .replace(/\u0120/g, " ")
            .replace(/\u010A/g, "\n")
            .replace(/\u00C2\u010A/g, "\n")
            .replace(/\u00C2\u0120/g, " ")
    );
}

// Generate span candidates for text matching
export function generateSpanCandidates(text) {
    if (typeof text !== "string") {
        return [];
    }
    const normalized = normalizeNote(text);
    const trimmed = normalized.trim();
    if (!trimmed.length) {
        return [];
    }

    const candidates = [];
    const addCandidate = (value) => {
        const candidate = normalizeNote(value).trim();
        if (candidate && !candidates.includes(candidate)) {
            candidates.push(candidate);
        }
    };

    addCandidate(trimmed);

    const withoutQuotes = trimmed.replace(QUOTE_TRIM_REGEX, "").trim();
    if (withoutQuotes) {
        addCandidate(withoutQuotes);
        const noPunctuation = withoutQuotes.replace(TRAILING_PUNCT_REGEX, "").trim();
        if (noPunctuation) {
            addCandidate(noPunctuation);
        }
    }

    const trimmedNoPunctuation = trimmed.replace(TRAILING_PUNCT_REGEX, "").trim();
    if (trimmedNoPunctuation) {
        addCandidate(trimmedNoPunctuation);
    }

    return candidates;
}

// Normalize span array (convert spans to proper format)
export function normalizeSpanArray(note, spans) {
    if (!note || !Array.isArray(spans) || !spans.length) {
        return [];
    }
    const noteLength = note.length;
    const noteLower = note.toLowerCase();

    return spans
        .map((span) => {
            if (!span) {
                return null;
            }

            let start = Number(span.start);
            let end = Number(span.end);
            if (Number.isFinite(start) && Number.isFinite(end)) {
                start = Math.max(0, Math.min(noteLength, start));
                end = Math.max(start, Math.min(noteLength, end));
                if (end > start) {
                    return {
                        start,
                        end,
                        text: note.slice(start, end),
                    };
                }
            }

            const candidates = generateSpanCandidates(span.text ?? "");
            for (const candidate of candidates) {
                const idx = noteLower.indexOf(candidate.toLowerCase());
                if (idx !== -1) {
                    const resolvedEnd = idx + candidate.length;
                    return {
                        start: idx,
                        end: resolvedEnd,
                        text: note.slice(idx, resolvedEnd),
                    };
                }
            }

            return null;
        })
        .filter(Boolean)
        .sort((a, b) => a.start - b.start || a.end - b.end);
}

// Build token highlights from token data
export function buildTokenHighlights(note, tokens) {
    if (!note || !Array.isArray(tokens) || !tokens.length) {
        return [];
    }

    const spans = [];
    const noteLower = note.toLowerCase();
    let searchStart = 0;

    tokens.forEach((tokenInfo) => {
        if (!tokenInfo) {
            return;
        }
        const candidates = [];
        if (typeof tokenInfo.display === "string") {
            const normalizedDisplay = normalizeNote(tokenInfo.display);
            if (normalizedDisplay.trim().length) {
                candidates.push(normalizedDisplay);
            }
        }
        if (typeof tokenInfo.token === "string") {
            const decoded = decodeTokenFragment(tokenInfo.token);
            if (decoded.trim().length) {
                candidates.push(decoded);
            }
        }

        const expected = candidates.find((candidate) => candidate.trim().length);
        if (!expected) {
            return;
        }

        const expectedLower = expected.toLowerCase();
        let index = noteLower.indexOf(expectedLower, searchStart);
        if (index === -1) {
            index = noteLower.indexOf(expectedLower);
        }
        if (index === -1) {
            return;
        }

        const start = index;
        const end = start + expected.length;
        spans.push({
            start,
            end,
            text: note.slice(start, end),
        });
        searchStart = end;
    });

    return spans.sort((a, b) => a.start - b.start || a.end - b.end);
}

// Render note with highlights
export function renderNote(spans = []) {
    const container = elements.noteDisplay;
    container.innerHTML = "";

    if (!state.noteText) {
        const placeholderEl = document.createElement("span");
        placeholderEl.className = "placeholder";
        placeholderEl.textContent = placeholderText;
        container.appendChild(placeholderEl);
        return;
    }

    const sanitizedSpans = Array.isArray(spans)
        ? spans
              .map((span) => {
                  const start = Math.max(0, Math.min(state.noteText.length, Number(span.start ?? 0)));
                  const end = Math.max(start, Math.min(state.noteText.length, Number(span.end ?? start)));
                  const text =
                      typeof span.text === "string" && span.text.length
                          ? span.text
                          : state.noteText.slice(start, end);
                  return { 
                      start, 
                      end, 
                      text, 
                      highlightClass: span.highlightClass || ""
                  };
              })
              .filter((span) => span.end > span.start)
              .sort((a, b) => a.start - b.start || a.end - b.end)
        : [];

    if (!sanitizedSpans.length) {
        container.textContent = state.noteText;
        return;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    sanitizedSpans.forEach((span) => {
        if (span.start > state.noteText.length) {
            return;
        }
        const safeStart = Math.max(cursor, span.start);
        const safeEnd = Math.max(safeStart, span.end);

        if (safeStart > cursor) {
            fragment.appendChild(document.createTextNode(state.noteText.slice(cursor, safeStart)));
        }

        if (safeEnd > safeStart) {
            const highlightEl = document.createElement("span");
            highlightEl.className = `note-highlight ${span.highlightClass}`;
            highlightEl.textContent = span.text ?? state.noteText.slice(safeStart, safeEnd);
            fragment.appendChild(highlightEl);
        }

        cursor = safeEnd;
    });

    if (cursor < state.noteText.length) {
        fragment.appendChild(document.createTextNode(state.noteText.slice(cursor)));
    }

    container.appendChild(fragment);
}

// Update note text
export function updateNote(text) {
    const normalized = normalizeNote(text);
    state.originalNoteText = normalized;
    state.noteText = normalized;
    renderNote();
}

