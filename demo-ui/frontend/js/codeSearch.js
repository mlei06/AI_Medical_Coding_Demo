// Code search functionality for manual lookup
import { state, codeSearchTimers } from './state.js';
import { elements } from './elements.js';
import { CODE_SEARCH_DEBOUNCE_MS } from './constants.js';
import { setStatus } from './utils.js';

// Import will be resolved at runtime - forward declaration
let addFinalizedCode = null;
export function setAddFinalizedCode(fn) {
    addFinalizedCode = fn;
}

// Get code search elements (single input for both modes)
export function getCodeSearchElements(type) {
    // In both predict and review modes, use the same single search input
    // The toggle switches between ICD and CPT, but the input element stays the same
    return {
        input: elements.searchInput,
        results: elements.codeSearchResults,
        addBtn: elements.codeSearchAddBtn,
    };
}

export function getCodeSearchState(type) {
    return state.codeSearch[type];
}

export function getCodeSearchTimers(type) {
    return codeSearchTimers[type];
}

export function getCodeSystemForSearch(type) {
    if (type === "cpt") {
        return "cpt";
    }
    // Use lookupIcdVersion for manual lookup searches
    return state.lookupIcdVersion === "10" ? "icd10" : "icd9";
}

export function isSearchTabActive(type) {
    // Use lookupCodeType in both predict and review modes
    return type === "cpt" ? state.lookupCodeType === "cpt" : state.lookupCodeType === "icd";
}

export function updateCodeSearchPlaceholder() {
    // Update placeholder and hint text based on lookup code type (both predict and review modes)
    if (!elements.searchInput) {
        return;
    }
    
    const codeType = state.lookupCodeType;
    const hintText = elements.searchInput.parentElement?.parentElement?.querySelector(".code-search-hint");
    
    if (codeType === "icd") {
        elements.searchInput.placeholder = `Look up an ICD code or description…`;
        if (hintText) {
            hintText.textContent = "Press Enter or Add to keep a code even if it's not found in the catalog.";
        }
    } else {
        elements.searchInput.placeholder = `Look up a CPT code or description…`;
        if (hintText) {
            hintText.textContent = "Not listed? Press Enter or Add to capture the code exactly as you typed it.";
        }
    }
}

export function updateCodeSearchAddState(type) {
    const { addBtn } = getCodeSearchElements(type);
    if (!addBtn) {
        return;
    }
    const stateSlice = getCodeSearchState(type);
    addBtn.disabled = !stateSlice.term.trim().length;
}

export function renderCodeSearchResults(type) {
    const { results: container } = getCodeSearchElements(type);
    if (!container) {
        return;
    }

    const stateSlice = getCodeSearchState(type);
    const isActive = isSearchTabActive(type);

    if (!isActive || !stateSlice.term.trim()) {
        container.classList.add("hidden");
        container.innerHTML = "";
        return;
    }

    if (stateSlice.loading) {
        container.innerHTML = `<div class="code-search-empty">Searching...</div>`;
        container.classList.remove("hidden");
        return;
    }

    const results = stateSlice.results;
    if (!results.length) {
        container.innerHTML = `<div class="code-search-empty">No matching codes found.</div>`;
        container.classList.remove("hidden");
        return;
    }

    container.innerHTML = "";
    results.forEach((result, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "code-search-option";
        option.setAttribute("role", "option");
        option.dataset.index = String(index);
        if (index === stateSlice.activeIndex) {
            option.classList.add("active");
            option.setAttribute("aria-selected", "true");
        } else {
            option.setAttribute("aria-selected", "false");
        }
        const codeEl = document.createElement("span");
        codeEl.className = "code";
        codeEl.textContent = result.code;
        const descEl = document.createElement("span");
        descEl.className = "description";
        descEl.textContent = result.description;
        option.appendChild(codeEl);
        option.appendChild(descEl);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => addCodeFromSearchResult(type, result));
        container.appendChild(option);
    });

    container.classList.remove("hidden");
}

export function scheduleCodeSearch(type) {
    const timers = getCodeSearchTimers(type);
    if (timers.debounce) {
        clearTimeout(timers.debounce);
    }

    const stateSlice = getCodeSearchState(type);
    if (!stateSlice.term.trim()) {
        stateSlice.results = [];
        stateSlice.activeIndex = -1;
        stateSlice.loading = false;
        renderCodeSearchResults(type);
        return;
    }

    stateSlice.loading = true;
    renderCodeSearchResults(type);
    timers.debounce = setTimeout(() => performCodeSearch(type), CODE_SEARCH_DEBOUNCE_MS);
}

export async function performCodeSearch(type) {
    const stateSlice = getCodeSearchState(type);
    const timers = getCodeSearchTimers(type);

    if (!stateSlice.term.trim() || !isSearchTabActive(type)) {
        stateSlice.loading = false;
        renderCodeSearchResults(type);
        return;
    }

    const system = getCodeSystemForSearch(type);
    const seq = ++stateSlice.seq;

    try {
        const response = await fetch(
            `/code-search?system=${encodeURIComponent(system)}&q=${encodeURIComponent(stateSlice.term)}&limit=20`
        );
        if (!response.ok) {
            throw new Error(`Search failed with status ${response.status}`);
        }
        const data = await response.json();
        if (seq !== stateSlice.seq) {
            return;
        }
        if (!isSearchTabActive(type)) {
            stateSlice.loading = false;
            return;
        }
        stateSlice.results = Array.isArray(data.results) ? data.results : [];
        stateSlice.activeIndex = stateSlice.results.length ? 0 : -1;
        stateSlice.loading = false;
        renderCodeSearchResults(type);
    } catch (error) {
        if (seq !== stateSlice.seq) {
            return;
        }
        console.warn("Code search failed:", error);
        stateSlice.results = [];
        stateSlice.activeIndex = -1;
        stateSlice.loading = false;
        if (isSearchTabActive(type)) {
            renderCodeSearchResults(type);
            setStatus("Failed to search code descriptions.", "error");
        }
    } finally {
        timers.debounce = null;
    }
}

export function handleCodeSearchInput(type, event) {
    const stateSlice = getCodeSearchState(type);
    stateSlice.term = event.target.value || "";
    updateCodeSearchAddState(type);
    if (!isSearchTabActive(type)) {
        return;
    }
    scheduleCodeSearch(type);
}

export function handleCodeSearchFocus(type) {
    const timers = getCodeSearchTimers(type);
    if (timers.blur) {
        clearTimeout(timers.blur);
        timers.blur = null;
    }
    const stateSlice = getCodeSearchState(type);
    if (stateSlice.term.trim()) {
        renderCodeSearchResults(type);
    }
}

export function handleCodeSearchBlur(type) {
    const timers = getCodeSearchTimers(type);
    if (timers.blur) {
        clearTimeout(timers.blur);
    }
    timers.blur = setTimeout(() => {
        const { results: container } = getCodeSearchElements(type);
        if (container) {
            container.classList.add("hidden");
        }
    }, 150);
}

export function moveCodeSearchSelection(type, offset) {
    const stateSlice = getCodeSearchState(type);
    const results = stateSlice.results;
    if (!results.length) {
        return;
    }
    let nextIndex = stateSlice.activeIndex + offset;
    if (nextIndex < 0) {
        nextIndex = results.length - 1;
    } else if (nextIndex >= results.length) {
        nextIndex = 0;
    }
    stateSlice.activeIndex = nextIndex;
    renderCodeSearchResults(type);
}

export function handleCodeSearchKeyDown(type, event) {
    // In both predict and review modes, check against lookupCodeType
    // The single input switches between ICD and CPT based on the toggle
    if ((type === "icd" && state.lookupCodeType !== "icd") || (type === "cpt" && state.lookupCodeType !== "cpt")) {
        return;
    }

    const stateSlice = getCodeSearchState(type);

    switch (event.key) {
        case "ArrowDown":
            if (stateSlice.results.length) {
                event.preventDefault();
                moveCodeSearchSelection(type, 1);
            }
            break;
        case "ArrowUp":
            if (stateSlice.results.length) {
                event.preventDefault();
                moveCodeSearchSelection(type, -1);
            }
            break;
        case "Enter":
            event.preventDefault();
            if (stateSlice.results.length && stateSlice.activeIndex >= 0) {
                const selected = stateSlice.results[stateSlice.activeIndex];
                addCodeFromSearchResult(type, selected);
            } else if (stateSlice.term.trim()) {
                addManualCodeFromSearch(type, stateSlice.term.trim());
            }
            break;
        case "Escape":
            resetCodeSearch(type);
            break;
        default:
            break;
    }
}

export function addCodeFromSearchResult(type, result) {
    if (!result || !result.code || !addFinalizedCode) {
        return;
    }
    const codeType = type === "cpt" ? "cpt" : "icd";
    const priorLength = state.finalizedCodes.length;
    addFinalizedCode({
        code: result.code,
        description: result.description ?? "",
        probability: null,
        type: codeType,
        spans: [],
        icdVersion: codeType === "icd" ? state.lookupIcdVersion : null,
    });
    if (state.finalizedCodes.length > priorLength) {
        if (codeType === "icd") {
            setStatus(`Added ICD-${state.lookupIcdVersion} code ${result.code} from dictionary.`, "success");
        } else {
            setStatus(`Added CPT code ${result.code} from dictionary.`, "success");
        }
        resetCodeSearch(type);
    }
}

export function addManualCodeFromSearch(type, rawCode) {
    if (!addFinalizedCode) return;
    const code = rawCode.trim();
    if (!code.length) {
        return;
    }
    const normalized = code.toUpperCase();
    const codeType = type === "cpt" ? "cpt" : "icd";
    const priorLength = state.finalizedCodes.length;
    addFinalizedCode({
        code: normalized,
        description: "",
        probability: null,
        type: codeType,
        spans: [],
        icdVersion: codeType === "icd" ? state.lookupIcdVersion : null,
    });
    if (state.finalizedCodes.length > priorLength) {
        if (codeType === "icd") {
            setStatus(`Added ICD-${state.lookupIcdVersion} code ${normalized}.`, "success");
        } else {
            setStatus(`Added CPT code ${normalized}.`, "success");
        }
        resetCodeSearch(type);
    }
}

export function resetCodeSearch(type, keepValue = false) {
    const stateSlice = getCodeSearchState(type);
    const timers = getCodeSearchTimers(type);
    const { input, results } = getCodeSearchElements(type);

    stateSlice.loading = false;
    stateSlice.results = [];
    stateSlice.activeIndex = -1;
    if (!keepValue) {
        stateSlice.term = "";
        if (input) {
            input.value = "";
        }
    }
    updateCodeSearchAddState(type);

    if (timers.debounce) {
        clearTimeout(timers.debounce);
        timers.debounce = null;
    }
    if (timers.blur) {
        clearTimeout(timers.blur);
        timers.blur = null;
    }
    if (results) {
        results.classList.add("hidden");
        results.innerHTML = "";
    }
}

