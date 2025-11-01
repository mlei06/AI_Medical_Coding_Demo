const state = {
    originalNoteText: "",
    noteText: "",
    models: [],
    methods: [],
    icdCodes: [],
    cptCodes: [],
    finalizedCodes: [],
    noteFileName: null,
    selectedIcdCodeIds: new Set(),
    selectedCptCodeIds: new Set(),
    activeTab: "icd", // "icd" or "cpt"
    mode: "local",
    llmModel: "",
    reasoning: "",
    icdVersion: "9", // "9" or "10" - default to ICD-9
};

const highlightClasses = ["highlight-1", "highlight-2", "highlight-3", "highlight-4"];

const elements = {
    noteInput: document.getElementById("noteInput"),
    noteDisplay: document.getElementById("noteDisplay"),
    noteEditorContainer: document.getElementById("noteEditorContainer"),
    noteDisplayContainer: document.getElementById("noteDisplayContainer"),
    processingOverlay: document.getElementById("processingOverlay"),
    fileInput: document.getElementById("fileInput"),
    dropZone: document.getElementById("dropZone"),
    browseBtn: document.getElementById("browseBtn"),
    submitBtn: document.getElementById("submitBtn"),
    submitCodesBtn: document.getElementById("submitCodesBtn"),
    resetBtn: document.getElementById("resetBtn"),
    clearHighlightsBtn: document.getElementById("clearHighlightsBtn"),
    clearFinalizedBtn: document.getElementById("clearFinalizedBtn"),
    modelSelect: document.getElementById("modelSelect"),
    methodSelect: document.getElementById("methodSelect"),
    thresholdInput: document.getElementById("thresholdInput"),
    codesContainer: document.getElementById("codesContainer"),
    cptCodesContainer: document.getElementById("cptCodesContainer"),
    finalizedContainer: document.getElementById("finalizedContainer"),
    statusBar: document.getElementById("statusBar"),
    searchInput: document.getElementById("codeSearch"),
    cptSearchInput: document.getElementById("cptCodeSearch"),
    noteFilename: document.getElementById("noteFilename"),
    modeSelect: document.getElementById("modeSelect"),
    modeSelectWrapper: document.getElementById("modeSelectWrapper"),
    llmModelWrapper: document.getElementById("llmModelWrapper"),
    llmModelInput: document.getElementById("llmModelInput"),
    modelSelectWrapper: document.getElementById("modelSelectWrapper"),
    methodSelectWrapper: document.getElementById("methodSelectWrapper"),
    thresholdWrapper: document.getElementById("thresholdWrapper"),
    icdVersionToggle: document.getElementById("icdVersionToggle"),
    icdVersionWrapper: document.getElementById("icdVersionWrapper"),
    codeTabs: document.getElementById("codeTabs"),
    icdTab: document.getElementById("icdTab"),
    cptTab: document.getElementById("cptTab"),
    icdTabContent: document.getElementById("icdTabContent"),
    cptTabContent: document.getElementById("cptTabContent"),
};

const submitButtonDefaultText = elements.submitBtn ? elements.submitBtn.textContent : "Submit";
const submitCodesButtonDefaultText = elements.submitCodesBtn ? elements.submitCodesBtn.textContent : "Submit Codes";
const placeholderText = "Paste or type clinical note here...";

function setStatus(message, type = "") {
    elements.statusBar.textContent = message;
    elements.statusBar.className = type ? `status-bar ${type}` : "status-bar";
}

function toggleSection(element, show) {
    if (!element) {
        return;
    }
    element.classList.toggle("hidden", !show);
}

function updateModeUI() {
    if (elements.modeSelect) {
        elements.modeSelect.value = state.mode;
    }
    const useLLM = state.mode === "llm";
    toggleSection(elements.modelSelectWrapper, !useLLM);
    toggleSection(elements.methodSelectWrapper, !useLLM);
    toggleSection(elements.thresholdWrapper, !useLLM);
    toggleSection(elements.llmModelWrapper, useLLM);

    if (elements.modelSelect) {
        elements.modelSelect.disabled = useLLM;
    }
    if (elements.methodSelect) {
        elements.methodSelect.disabled = useLLM;
    }
    if (elements.thresholdInput) {
        elements.thresholdInput.disabled = useLLM;
    }
    if (elements.llmModelInput) {
        elements.llmModelInput.disabled = !useLLM;
        elements.llmModelInput.value = state.llmModel;
    }
}

function setProcessing(isProcessing, target = "predict") {
    toggleSection(elements.processingOverlay, isProcessing);
    if (elements.submitBtn) {
        if (target === "predict") {
            elements.submitBtn.disabled = isProcessing;
            elements.submitBtn.textContent = isProcessing ? "Processing..." : submitButtonDefaultText;
        } else if (!isProcessing) {
            elements.submitBtn.disabled = false;
            elements.submitBtn.textContent = submitButtonDefaultText;
        } else {
            elements.submitBtn.disabled = true;
        }
    }

    if (elements.submitCodesBtn) {
        if (target === "finalize") {
            elements.submitCodesBtn.disabled = isProcessing;
            elements.submitCodesBtn.textContent = isProcessing ? "Processing..." : submitCodesButtonDefaultText;
        } else if (isProcessing) {
            elements.submitCodesBtn.disabled = true;
        } else {
            elements.submitCodesBtn.disabled = state.finalizedCodes.length === 0;
            elements.submitCodesBtn.textContent = submitCodesButtonDefaultText;
        }
    }

    if (elements.modeSelect) {
        if (isProcessing) {
            elements.modeSelect.disabled = true;
        } else {
            elements.modeSelect.disabled = false;
            updateModeUI();
        }
    }
}

function normalizeNote(text) {
    return (text || "").replace(/\r\n?/g, "\n");
}

function displayNoteFilename() {
    if (!elements.noteFilename) {
        return;
    }
    if (state.noteFileName && state.noteFileName.trim().length) {
        elements.noteFilename.textContent = state.noteFileName;
        elements.noteFilename.classList.remove("hidden");
    } else {
        elements.noteFilename.textContent = "";
        elements.noteFilename.classList.add("hidden");
    }
}

function isProcessingActive() {
    return elements.processingOverlay && !elements.processingOverlay.classList.contains("hidden");
}

function updateSubmitCodesState() {
    if (!elements.submitCodesBtn) {
        return;
    }
    const processing = isProcessingActive();
    const enabled = state.finalizedCodes.length > 0 && !processing;
    elements.submitCodesBtn.disabled = !enabled;
    if (!processing) {
        elements.submitCodesBtn.textContent = submitCodesButtonDefaultText;
    }
}

function clearFinalizedCodes() {
    state.finalizedCodes = [];
    renderFinalizedCodes();
    if (state.icdCodes.length || state.cptCodes.length) {
        renderCodes("icd");
        renderCodes("cpt");
    }
}

function removeFinalizedCode(code, codeType) {
    state.finalizedCodes = state.finalizedCodes.filter((entry) => {
        if (entry.code !== code) {
            return true;
        }
        if (!codeType) {
            return false;
        }
        return entry.type !== codeType;
    });
    renderFinalizedCodes();
    if (state.icdCodes.length || state.cptCodes.length) {
        renderCodes("icd");
        renderCodes("cpt");
    }
}

function renderFinalizedCodes(focusIndex = null) {
    if (!elements.finalizedContainer) {
        return;
    }

    if (elements.clearFinalizedBtn) {
        elements.clearFinalizedBtn.disabled = state.finalizedCodes.length === 0;
    }

    if (!state.finalizedCodes.length) {
        elements.finalizedContainer.innerHTML = `<p class="empty-state">No codes selected yet.</p>`;
        updateSubmitCodesState();
        return;
    }

    elements.finalizedContainer.innerHTML = "";
    state.finalizedCodes.forEach((entry, index) => {
        const card = document.createElement("div");
        card.className = "final-code-card";
        if (entry.editing) {
            card.classList.add("editing");
        }
        card.tabIndex = 0;

        const info = document.createElement("div");
        info.className = "final-code-info";

        const codeEl = document.createElement("div");
        codeEl.className = "code";
        const codeType = entry.type || "icd";
        codeEl.innerHTML = `<span class="code-type">${codeType.toUpperCase()}</span> ${entry.code}`;
        card.setAttribute("role", "group");
        card.setAttribute(
            "aria-label",
            `${codeType.toUpperCase()} code ${entry.code} finalized entry`
        );
        card.setAttribute("aria-expanded", entry.editing ? "true" : "false");

        const activateEditor = () => {
            if (state.finalizedCodes[index]?.editing) {
                return;
            }
            state.finalizedCodes = state.finalizedCodes.map((item, idx) => ({
                ...item,
                editing: idx === index,
            }));
            renderFinalizedCodes(index);
        };

        info.appendChild(codeEl);

        if (entry.editing) {
            const descInput = document.createElement("textarea");
            descInput.className = "final-code-description";
            descInput.rows = Math.max(2, (entry.description || "").split("\n").length);
            descInput.value = entry.description || "";
            descInput.placeholder = "Add or edit description";
            descInput.setAttribute(
                "aria-label",
                `${codeType.toUpperCase()} ${entry.code} description editor`
            );
            descInput.addEventListener("input", (event) => {
                state.finalizedCodes[index].description = event.target.value;
            });
            descInput.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    state.finalizedCodes[index].editing = false;
                    renderFinalizedCodes();
                } else if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    descInput.blur();
                }
            });
            descInput.addEventListener("blur", (event) => {
                const trimmed = event.target.value.trim();
                state.finalizedCodes[index].description = trimmed;
                state.finalizedCodes[index].editing = false;
                renderFinalizedCodes();
            });

            if (focusIndex === index) {
                requestAnimationFrame(() => {
                    descInput.focus();
                    const length = descInput.value.length;
                    descInput.setSelectionRange(length, length);
                });
            }

            info.appendChild(descInput);
        } else {
            const descEl = document.createElement("div");
            descEl.className = "description";
            const hasDescription =
                typeof entry.description === "string" && entry.description.trim().length > 0;
            descEl.textContent = hasDescription ? entry.description : "Click to add description";
            if (!hasDescription) {
                descEl.classList.add("placeholder");
            }
            info.appendChild(descEl);
        }

        if (typeof entry.probability === "number" && !Number.isNaN(entry.probability)) {
            const probabilityEl = document.createElement("div");
            probabilityEl.className = "probability";
            probabilityEl.textContent = `Confidence: ${formatProbability(entry.probability)}`;
            info.appendChild(probabilityEl);
        }

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "final-code-remove";
        removeBtn.title = "Remove code";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            removeFinalizedCode(entry.code, codeType);
        });

        card.addEventListener("click", (event) => {
            if (event.target.closest(".final-code-remove")) {
                return;
            }
            if (event.target.matches("textarea.final-code-description")) {
                return;
            }
            activateEditor();
        });

        card.addEventListener("keydown", (event) => {
            if (event.target.matches("textarea.final-code-description")) {
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateEditor();
            }
        });

        card.appendChild(info);
        card.appendChild(removeBtn);

        elements.finalizedContainer.appendChild(card);
    });

    updateSubmitCodesState();
}

function addFinalizedCode(entry) {
    if (!entry) {
        return;
    }
    const codeType = entry.type || "icd";
    if (state.finalizedCodes.some((item) => item.code === entry.code && item.type === codeType)) {
        setStatus(`${codeType.toUpperCase()} code ${entry.code} is already in the finalized list.`, "error");
        return;
    }

    state.finalizedCodes.push({
        code: entry.code,
        description: entry.description ?? "",
        probability: entry.probability ?? null,
        type: codeType,
        editing: false,
    });
    renderFinalizedCodes();
}

function decodeTokenFragment(token) {
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
const QUOTE_TRIM_REGEX = /^["'\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A\u201E\u201F]+|["'\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A\u201E\u201F]+$/g;
const TRAILING_PUNCT_REGEX = /[.,;:!?]+$/;

function generateSpanCandidates(text) {
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

function normalizeSpanArray(note, spans) {
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

function buildTokenHighlights(note, tokens) {
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

function renderNote(spans = []) {
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

function updateActiveHighlight() {
    const selectedIcdIds = Array.from(state.selectedIcdCodeIds);
    const selectedCptIds = Array.from(state.selectedCptCodeIds);
    const selectedIcdEntries = state.icdCodes.filter((entry) => selectedIcdIds.includes(entry.id));
    const selectedCptEntries = state.cptCodes.filter((entry) => selectedCptIds.includes(entry.id));

    const allSelectedEntries = [...selectedIcdEntries, ...selectedCptEntries];

    if (allSelectedEntries.length > 0) {
        // Combine all spans from selected entries
        const allSpans = [];
        allSelectedEntries.forEach((entry) => {
            if (entry.spans && entry.spans.length > 0) {
                allSpans.push(...entry.spans.map(span => ({
                    ...span,
                    highlightClass: entry.highlightClass
                })));
            }
        });
        renderNote(allSpans);
    } else {
        renderNote();
    }

    // Update ICD cards
    document.querySelectorAll("#codesContainer .code-card").forEach((card) => {
        const cardId = card.dataset.codeId;
        const isActive = state.selectedIcdCodeIds.has(cardId);
        card.classList.toggle("active", isActive);
        card.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    // Update CPT cards
    document.querySelectorAll("#cptCodesContainer .code-card").forEach((card) => {
        const cardId = card.dataset.codeId;
        const isActive = state.selectedCptCodeIds.has(cardId);
        card.classList.toggle("active", isActive);
        card.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
}

function toggleCodeSelection(codeId, codeType = "icd") {
    const selectedSet = codeType === "icd" ? state.selectedIcdCodeIds : state.selectedCptCodeIds;
    if (selectedSet.has(codeId)) {
        selectedSet.delete(codeId);
    } else {
        selectedSet.add(codeId);
    }
    updateActiveHighlight();
}

function updateNote(text) {
    state.originalNoteText = text || "";
    state.noteText = normalizeNote(state.originalNoteText);
    elements.noteInput.value = state.originalNoteText;

    const hasText = state.noteText.trim().length > 0;
    toggleSection(elements.noteEditorContainer, hasText);
    
    // Only show note display container if there are codes to highlight
    const hasCodes = state.icdCodes.length > 0 || state.cptCodes.length > 0;
    toggleSection(elements.noteDisplayContainer, hasText && hasCodes);

    if (state.icdCodes.length > 0 || state.cptCodes.length > 0) {
        clearCodes();
    }

    renderNote();
    displayNoteFilename();
}

function readFile(file) {
    if (!file) {
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        state.noteFileName = file.name;
        clearFinalizedCodes();
        updateNote(reader.result || "");
        setStatus(`Loaded ${file.name}`, "success");
    };
    reader.onerror = () => {
        setStatus("Failed to read file. Please try again.", "error");
    };
    reader.readAsText(file);
}

function handleDrop(event) {
    event.preventDefault();
    elements.dropZone.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        readFile(file);
    }
}

function handleDragOver(event) {
    event.preventDefault();
    elements.dropZone.classList.add("dragover");
}

function handleDragLeave(event) {
    event.preventDefault();
    elements.dropZone.classList.remove("dragover");
}

function populateSelect(selectElement, values) {
    if (!selectElement) {
        console.warn("Select element not found");
        return;
    }
    selectElement.innerHTML = "";
    values.forEach((value, index) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        if (index === 0) {
            option.selected = true;
        }
        selectElement.appendChild(option);
    });
}

function filterModelsByICDVersion(models, icdVersion) {
    if (!Array.isArray(models) || models.length === 0) {
        return models;
    }
    const versionStr = icdVersion === "9" ? "icd9" : "icd10";
    return models.filter(model => {
        const modelLower = String(model).toLowerCase();
        return modelLower.includes(versionStr);
    });
}

function filterAndPopulateModels() {
    const filtered = filterModelsByICDVersion(state.models, state.icdVersion);
    if (filtered.length === 0 && state.models.length > 0) {
        // If no models match, show all models but warn user
        populateSelect(elements.modelSelect, state.models);
        setStatus(`No ${state.icdVersion === "9" ? "ICD-9" : "ICD-10"} models found. Showing all models.`, "error");
    } else {
        populateSelect(elements.modelSelect, filtered);
    }
}

async function fetchOptions() {
    try {
        setStatus("Loading configuration...", "loading");

        const [modelsRes, methodsRes] = await Promise.all([
            fetch("/models"),
            fetch("/explain-methods"),
        ]);

        if (!modelsRes.ok || !methodsRes.ok) {
            throw new Error("Failed to fetch configuration");
        }

        const modelsData = await modelsRes.json();
        const methodsData = await methodsRes.json();

        state.models = Array.isArray(modelsData.models) ? modelsData.models : [];
        state.methods = Array.isArray(methodsData.methods) ? methodsData.methods : [];

        if (!state.models.length) {
            state.models = ["models"]; // fallback placeholder
        }
        if (!state.methods.length) {
            state.methods = ["grad_attention"];
        }

        filterAndPopulateModels();
        populateSelect(elements.methodSelect, state.methods);

        setStatus("Configuration loaded. Ready when you are.", "success");
    } catch (error) {
        console.warn("Failed to fetch configuration, using fallback values:", error);
        // Use fallback values even if server is not available
        state.models = ["roberta-base-pm-m3-voc-hf"];
        state.methods = ["grad_attention"];
        filterAndPopulateModels();
        populateSelect(elements.methodSelect, state.methods);
        setStatus("Using fallback configuration. Server may not be running.", "error");
    }
}

function formatProbability(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "n/a";
    }
    return (value * 100).toFixed(1) + "%";
}

function clearCodes() {
    state.selectedIcdCodeIds.clear();
    state.selectedCptCodeIds.clear();
    state.icdCodes = [];
    state.cptCodes = [];
    elements.codesContainer.innerHTML = `<p class="empty-state">No ICD predictions yet. Upload a note and submit to see results.</p>`;
    elements.cptCodesContainer.innerHTML = `<p class="empty-state">No CPT predictions yet. Upload a note and submit to see results.</p>`;
    updateSubmitCodesState();
    renderNote();
}

function renderCodes(codeType = "icd") {
    const codes = codeType === "icd" ? state.icdCodes : state.cptCodes;
    const container = codeType === "icd" ? elements.codesContainer : elements.cptCodesContainer;
    const searchInput = codeType === "icd" ? elements.searchInput : elements.cptSearchInput;
    const selectedSet = codeType === "icd" ? state.selectedIcdCodeIds : state.selectedCptCodeIds;
    
    const searchTerm = searchInput.value.trim().toLowerCase();
    const filtered = codes.filter((entry) => {
        if (!searchTerm) {
            return true;
        }
        const haystack = `${entry.code} ${entry.description}`.toLowerCase();
        return haystack.includes(searchTerm);
    });

    if (!filtered.length) {
        const emptyMessage = searchTerm 
            ? "No codes match that search." 
            : `No ${codeType.toUpperCase()} predictions yet. Upload a note and submit to see results.`;
        container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
        selectedSet.clear();
        updateActiveHighlight();
        updateSubmitCodesState();
        return;
    }

    // Remove selected codes that are no longer in the filtered results
    const filteredIds = new Set(filtered.map(entry => entry.id));
    selectedSet.forEach(id => {
        if (!filteredIds.has(id)) {
            selectedSet.delete(id);
        }
    });

    container.innerHTML = "";
    filtered.forEach((entry) => {
        const card = document.createElement("div");
        card.className = "code-card";
        if (selectedSet.has(entry.id)) {
            card.classList.add("active");
        }
        card.dataset.codeId = entry.id;
        card.setAttribute("role", "button");
        card.tabIndex = 0;
        card.setAttribute("aria-pressed", selectedSet.has(entry.id) ? "true" : "false");

        const header = document.createElement("header");
        const codeEl = document.createElement("div");
        codeEl.className = "code";
        codeEl.textContent = entry.code;
        const probEl = document.createElement("div");
        probEl.className = "probability";
        probEl.textContent = formatProbability(entry.probability);
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "code-add-btn";
        addBtn.title = "Add to finalized codes";
        addBtn.textContent = "+";
        if (state.finalizedCodes.some((item) => item.code === entry.code && item.type === codeType)) {
            addBtn.disabled = true;
            addBtn.classList.add("added");
        }
        addBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            addFinalizedCode({...entry, type: codeType});
            addBtn.disabled = true;
            addBtn.classList.add("added");
        });

        header.appendChild(codeEl);
        header.appendChild(probEl);
        header.appendChild(addBtn);

        const desc = document.createElement("div");
        desc.className = "description";
        desc.textContent = entry.description || "No description available.";

        const tokensWrapper = document.createElement("div");
        tokensWrapper.className = "token-badges";
        if (entry.tokens && entry.tokens.length) {
            entry.tokens.forEach((token) => {
                const badge = document.createElement("span");
                badge.className = "token-badge";
                const tokenLabel =
                    (typeof token.display === "string" && token.display.trim().length
                        ? token.display
                        : decodeTokenFragment(token.token)).trim() || "<token>";
                badge.textContent = `${token.rank}. ${tokenLabel} (${token.attribution})`;
                tokensWrapper.appendChild(badge);
            });
        } else if (entry.spans && entry.spans.length) {
            const fallback = document.createElement("span");
            fallback.className = "token-badge";
            fallback.textContent = "Evidence spans available (click to highlight).";
            tokensWrapper.appendChild(fallback);
        } else {
            const fallback = document.createElement("span");
            fallback.className = "token-badge";
            fallback.textContent = "No highlight data.";
            tokensWrapper.appendChild(fallback);
        }

        card.appendChild(header);
        card.appendChild(desc);
        card.appendChild(tokensWrapper);

        card.addEventListener("click", () => {
            toggleCodeSelection(entry.id, codeType);
        });

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleCodeSelection(entry.id, codeType);
            }
        });

        container.appendChild(card);
    });
    updateActiveHighlight();
    updateSubmitCodesState();
}

async function submitPrediction() {
    const rawNote = elements.noteInput.value;
    const normalizedNote = normalizeNote(rawNote);
    if (!normalizedNote.trim()) {
        setStatus("Please provide a clinical note before submitting.", "error");
        return;
    }

    updateNote(rawNote);

    const useLLM = state.mode === "llm";
    const payload = {
        note: state.noteText,
    };
    let endpoint = "/predict-explain";

    if (useLLM) {
        endpoint = "/predict-explain-llm";
        const llmModelName = elements.llmModelInput ? elements.llmModelInput.value.trim() : "";
        state.llmModel = llmModelName;
        if (llmModelName) {
            payload.model = llmModelName;
        }
        payload.icd_version = state.icdVersion;
    } else {
        const model = elements.modelSelect.value;
        if (!model) {
            setStatus("Select a model before submitting.", "error");
            return;
        }
        const method = elements.methodSelect.value;
        const thresholdValue = Number(elements.thresholdInput.value);
        const threshold = Number.isFinite(thresholdValue) ? Math.min(1, Math.max(0, thresholdValue)) : 0.5;

        payload.model = model;
        payload.explain_method = method;
        payload.confidence_threshold = threshold;
        elements.thresholdInput.value = threshold.toString();
    }

    try {
        setStatus(useLLM ? "Running LLM prediction..." : "Running prediction...", "loading");
        setProcessing(true, "predict");
        clearFinalizedCodes();
        clearCodes();
        renderNote();

        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }

        state.reasoning =
            useLLM && typeof data.reasoning === "string" ? data.reasoning.trim() : "";

        const icdCodes = Array.isArray(data.icd_codes) ? data.icd_codes : [];
        const cptCodes = Array.isArray(data.cpt_codes) ? data.cpt_codes : [];
        
        if (!icdCodes.length && !cptCodes.length) {
            setStatus(
                useLLM
                    ? "LLM did not return any codes."
                    : "No codes met the confidence threshold.",
                "success"
            );
            clearCodes();
            toggleSection(elements.noteEditorContainer, true);
            return;
        }

        // Process ICD codes
        state.icdCodes = icdCodes.map((entry, index) => {
            const highlightClass = highlightClasses[index % highlightClasses.length];
            const tokens = Array.isArray(entry.explanation?.tokens)
                ? entry.explanation.tokens.map((token) => ({
                      token: token.token ?? "",
                      display:
                          typeof token.token_display === "string" && token.token_display.length
                              ? normalizeNote(token.token_display)
                              : decodeTokenFragment(token.token ?? ""),
                      rank: token.rank ?? "-",
                      attribution:
                          typeof token.attribution === "number"
                              ? token.attribution.toFixed(3)
                              : token.attribution ?? "n/a",
                  }))
                : [];

            let spans = normalizeSpanArray(state.noteText, entry.explanation?.spans);
            if (!spans.length && Array.isArray(entry.evidence_spans)) {
                spans = normalizeSpanArray(state.noteText, entry.evidence_spans);
            }
            if (!spans.length && tokens.length) {
                spans = buildTokenHighlights(state.noteText, tokens);
            }

            let probabilityValue = null;
            if (typeof entry.probability === "number" && !Number.isNaN(entry.probability)) {
                probabilityValue = entry.probability;
            } else if (typeof entry.probability === "string") {
                const parsedProbability = Number(entry.probability);
                if (!Number.isNaN(parsedProbability)) {
                    probabilityValue = parsedProbability;
                }
            }

            return {
                id: `icd-${entry.code}-${index}`,
                code: entry.code,
                description: entry.description ?? "",
                probability:
                    typeof probabilityValue === "number" && !Number.isNaN(probabilityValue)
                        ? probabilityValue
                        : null,
                highlightClass,
                tokens,
                spans,
                source: useLLM ? "llm" : "local",
            };
        });

        // Process CPT codes
        state.cptCodes = cptCodes.map((entry, index) => {
            const highlightClass = highlightClasses[(index + icdCodes.length) % highlightClasses.length];
            const tokens = Array.isArray(entry.explanation?.tokens)
                ? entry.explanation.tokens.map((token) => ({
                      token: token.token ?? "",
                      display:
                          typeof token.token_display === "string" && token.token_display.length
                              ? normalizeNote(token.token_display)
                              : decodeTokenFragment(token.token ?? ""),
                      rank: token.rank ?? "-",
                      attribution:
                          typeof token.attribution === "number"
                              ? token.attribution.toFixed(3)
                              : token.attribution ?? "n/a",
                  }))
                : [];

            let spans = normalizeSpanArray(state.noteText, entry.explanation?.spans);
            if (!spans.length && Array.isArray(entry.evidence_spans)) {
                spans = normalizeSpanArray(state.noteText, entry.evidence_spans);
            }
            if (!spans.length && tokens.length) {
                spans = buildTokenHighlights(state.noteText, tokens);
            }

            let probabilityValue = null;
            if (typeof entry.probability === "number" && !Number.isNaN(entry.probability)) {
                probabilityValue = entry.probability;
            } else if (typeof entry.probability === "string") {
                const parsedProbability = Number(entry.probability);
                if (!Number.isNaN(parsedProbability)) {
                    probabilityValue = parsedProbability;
                }
            }

            return {
                id: `cpt-${entry.code}-${index}`,
                code: entry.code,
                description: entry.description ?? "",
                probability:
                    typeof probabilityValue === "number" && !Number.isNaN(probabilityValue)
                        ? probabilityValue
                        : null,
                highlightClass,
                tokens,
                spans,
                source: useLLM ? "llm" : "local",
            };
        });

        renderCodes("icd");
        renderCodes("cpt");
        toggleSection(elements.noteEditorContainer, false);
        toggleSection(elements.noteDisplayContainer, true);
        renderNote();

        const originLabel = useLLM ? "LLM" : "local model";
        const totalCodes = state.icdCodes.length + state.cptCodes.length;
        const icdText = state.icdCodes.length > 0 ? `${state.icdCodes.length} ICD code${state.icdCodes.length === 1 ? "" : "s"}` : "";
        const cptText = state.cptCodes.length > 0 ? `${state.cptCodes.length} CPT code${state.cptCodes.length === 1 ? "" : "s"}` : "";
        const codesText = [icdText, cptText].filter(Boolean).join(" and ");
        
        setStatus(
            `Received ${codesText} (${originLabel}).`,
            "success"
        );
        if (useLLM && state.reasoning) {
            console.info("LLM reasoning:", state.reasoning);
        }
    } catch (error) {
        setStatus(`Prediction failed: ${error.message}`, "error");
        clearCodes();
        toggleSection(elements.noteEditorContainer, true);
    } finally {
        setProcessing(false, "predict");
        updateSubmitCodesState();
    }
}

async function submitFinalizedCodes() {
    if (!state.finalizedCodes.length) {
        setStatus("Add at least one code before submitting.", "error");
        return;
    }

    if (!state.noteText.trim()) {
        setStatus("No note text available to submit.", "error");
        return;
    }

    const effectiveFileName =
        state.noteFileName && state.noteFileName.trim().length
            ? state.noteFileName
            : `manual-note-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    state.noteFileName = effectiveFileName;

    // Separate ICD and CPT codes
    const icdCodes = state.finalizedCodes.filter(entry => entry.type === "icd");
    const cptCodes = state.finalizedCodes.filter(entry => entry.type === "cpt");

    const payload = {
        note_text: state.noteText,
        note_filename: effectiveFileName,
        icd_codes: icdCodes.map((entry) => ({
            code: entry.code,
            description: entry.description ?? "",
            probability: entry.probability,
        })),
        cpt_codes: cptCodes.map((entry) => ({
            code: entry.code,
            description: entry.description ?? "",
            probability: entry.probability,
        })),
    };

    try {
        setStatus("Saving finalized codes...", "loading");
        setProcessing(true, "finalize");

        const response = await fetch("/submit-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `Request failed with status ${response.status}`);
        }

        const data = await response.json();
        const outputPath = data.output_path || "output";
        const icdCount = icdCodes.length;
        const cptCount = cptCodes.length;
        let message = `Codes submitted successfully. Saved to ${outputPath}.`;
        if (icdCount > 0 && cptCount > 0) {
            message += ` Created separate files: ${icdCount} ICD code${icdCount === 1 ? '' : 's'} and ${cptCount} CPT code${cptCount === 1 ? '' : 's'}.`;
        } else if (icdCount > 0) {
            message += ` Created ICD codes file with ${icdCount} code${icdCount === 1 ? '' : 's'}.`;
        } else if (cptCount > 0) {
            message += ` Created CPT codes file with ${cptCount} code${cptCount === 1 ? '' : 's'}.`;
        }
        setStatus(message, "success");
    } catch (error) {
        setStatus(`Failed to submit codes: ${error.message}`, "error");
    } finally {
        setProcessing(false, "finalize");
        updateSubmitCodesState();
    }
}

function switchTab(tabType) {
    state.activeTab = tabType;
    
    // Update tab buttons
    if (elements.icdTab && elements.cptTab) {
        elements.icdTab.classList.toggle("active", tabType === "icd");
        elements.cptTab.classList.toggle("active", tabType === "cpt");
    }
    
    // Update tab content
    if (elements.icdTabContent && elements.cptTabContent) {
        elements.icdTabContent.classList.toggle("active", tabType === "icd");
        elements.cptTabContent.classList.toggle("active", tabType === "cpt");
    }
}

function resetAll() {
    elements.noteInput.value = "";
    elements.searchInput.value = "";
    if (elements.cptSearchInput) {
        elements.cptSearchInput.value = "";
    }
    state.originalNoteText = "";
    state.noteText = "";
    state.noteFileName = null;
    state.icdCodes = [];
    state.cptCodes = [];
    state.selectedIcdCodeIds.clear();
    state.selectedCptCodeIds.clear();
    state.activeTab = "icd";
    renderNote();
    clearCodes();
    clearFinalizedCodes();
    switchTab("icd");
    toggleSection(elements.noteEditorContainer, false);
    toggleSection(elements.noteDisplayContainer, false);
    setProcessing(false, "predict");
    setStatus("Cleared inputs.", "success");
}

function initEvents() {
    if (elements.icdVersionToggle) {
        elements.icdVersionToggle.addEventListener("change", (event) => {
            // When checked (thumb on right) = ICD-10, when unchecked (thumb on left) = ICD-9
            const newVersion = event.target.checked ? "10" : "9";
            if (state.icdVersion !== newVersion) {
                state.icdVersion = newVersion;
                filterAndPopulateModels();
                clearCodes();
                clearFinalizedCodes();
                renderNote();
                setStatus(
                    `Switched to ICD-${newVersion}. Model list updated.`,
                    "info"
                );
            }
        });
        // Initialize toggle state: ICD-9 = unchecked (thumb on left), ICD-10 = checked (thumb on right)
        elements.icdVersionToggle.checked = state.icdVersion === "10";
    }

    if (elements.modeSelect) {
        elements.modeSelect.addEventListener("change", (event) => {
            const newMode = event.target.value === "llm" ? "llm" : "local";
            if (state.mode !== newMode) {
                state.mode = newMode;
                updateModeUI();
                clearCodes();
                clearFinalizedCodes();
                renderNote();
                setStatus(
                    newMode === "llm"
                        ? "Switched to LLM mode. Provide a note and submit to fetch LLM predictions."
                        : "Switched to local model mode.",
                    "info"
                );
            }
        });
    }

    if (elements.llmModelInput) {
        elements.llmModelInput.addEventListener("input", (event) => {
            state.llmModel = event.target.value;
        });
    }

    elements.noteInput.addEventListener("input", (event) => {
        updateNote(event.target.value);
    });

    elements.dropZone.addEventListener("click", () => elements.fileInput.click());
    elements.dropZone.addEventListener("dragover", handleDragOver);
    elements.dropZone.addEventListener("dragleave", handleDragLeave);
    elements.dropZone.addEventListener("drop", handleDrop);

    elements.fileInput.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) {
            readFile(file);
            elements.fileInput.value = "";
        }
    });

    elements.browseBtn.addEventListener("click", () => elements.fileInput.click());

    elements.submitBtn.addEventListener("click", submitPrediction);
    elements.resetBtn.addEventListener("click", resetAll);
    if (elements.clearFinalizedBtn) {
        elements.clearFinalizedBtn.addEventListener("click", clearFinalizedCodes);
    }
    if (elements.submitCodesBtn) {
        elements.submitCodesBtn.addEventListener("click", submitFinalizedCodes);
    }
    elements.clearHighlightsBtn.addEventListener("click", () => {
        state.selectedIcdCodeIds.clear();
        state.selectedCptCodeIds.clear();
        updateActiveHighlight();
    });

    // Tab switching functionality
    if (elements.icdTab) {
        elements.icdTab.addEventListener("click", () => switchTab("icd"));
    }
    if (elements.cptTab) {
        elements.cptTab.addEventListener("click", () => switchTab("cpt"));
    }

    // Search event listeners
    elements.searchInput.addEventListener("input", () => renderCodes("icd"));
    if (elements.cptSearchInput) {
        elements.cptSearchInput.addEventListener("input", () => renderCodes("cpt"));
    }
    
    updateSubmitCodesState();
    updateModeUI();
}

function boot() {
    initEvents();
    updateModeUI();
    updateNote("");
    clearCodes();
    clearFinalizedCodes();
    fetchOptions();
}

document.addEventListener("DOMContentLoaded", boot);
