// Main application entry point - Modular version
// This file imports extracted modules and contains remaining functionality

// Import core modules
import { LLM_MODELS, highlightClasses, CODE_SEARCH_DEBOUNCE_MS, QUOTE_TRIM_REGEX, TRAILING_PUNCT_REGEX } from './constants.js';
import { state, codeSearchTimers } from './state.js';
import { elements, submitButtonDefaultText, submitCodesButtonDefaultText, placeholderText } from './elements.js';
import { setStatus, toggleSection, formatProbability, normalizeNote, populateSelect, filterModelsByICDVersion, sanitizeFolderName } from './utils.js';

// Import code search module
import * as codeSearch from './codeSearch.js';

// Import note handling module  
import { renderNote, updateNote, decodeTokenFragment, generateSpanCandidates, normalizeSpanArray, buildTokenHighlights } from './noteHandling.js';

// Set up codeSearch module to use addFinalizedCode (will be defined below)
// This creates a circular dependency that we'll resolve after addFinalizedCode is defined

// Re-export commonly used items for backward compatibility
export { state, elements, setStatus, toggleSection, formatProbability, normalizeNote };

// Make codeSearch functions available globally (for functions that reference them)
// This allows the rest of the code to use codeSearch functions
const {
    getCodeSearchElements,
    getCodeSearchState,
    getCodeSearchTimers,
    getCodeSystemForSearch,
    isSearchTabActive,
    updateCodeSearchPlaceholder,
    updateCodeSearchAddState,
    renderCodeSearchResults,
    scheduleCodeSearch,
    performCodeSearch,
    handleCodeSearchInput,
    handleCodeSearchFocus,
    handleCodeSearchBlur,
    moveCodeSearchSelection,
    handleCodeSearchKeyDown,
    addCodeFromSearchResult,
    addManualCodeFromSearch,
    resetCodeSearch
} = codeSearch;

// Set up circular dependency: codeSearch needs addFinalizedCode
// We'll set this up after addFinalizedCode is defined below

// Now import the remaining code from the original app.js
// This is a large file, so we'll include all remaining functions here
// TODO: Extract more functionality into separate modules over time
// Note: setStatus, toggleSection, normalizeNote, etc. are already imported from modules above

function syncPageModeTabs() {
    if (!elements.modeTabs || !elements.modeTabs.length) {
        return;
    }

    const activeTab = elements.modeTabs.find(
        (tab) => (tab.dataset.mode === "review" ? "review" : "predict") === state.pageMode
    );

    elements.modeTabs.forEach((tab) => {
        const tabMode = tab.dataset.mode === "review" ? "review" : "predict";
        const isActive = tabMode === state.pageMode;
        tab.classList.toggle("active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
        tab.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    if (elements.modeTabsContainer) {
        elements.modeTabsContainer.setAttribute(
            "aria-activedescendant",
            activeTab && activeTab.id ? activeTab.id : ""
        );
    }
}

function updateModeUI() {
    if (elements.modeSelect) {
        elements.modeSelect.value = state.mode;
    }
    
    // Only update visibility if we're in predict mode
    // In review mode, visibility is controlled by updatePageModeUI()
    const isPredictMode = state.pageMode !== "review";
    const useLLM = state.mode === "llm";
    
    if (isPredictMode) {
        toggleSection(elements.modelSelectWrapper, !useLLM);
        toggleSection(elements.methodSelectWrapper, !useLLM);
        toggleSection(elements.thresholdWrapper, !useLLM);
        toggleSection(elements.llmModelWrapper, useLLM);
    }

    if (elements.modelSelect) {
        elements.modelSelect.disabled = useLLM;
    }
    if (elements.methodSelect) {
        elements.methodSelect.disabled = useLLM;
    }
    if (elements.thresholdInput) {
        elements.thresholdInput.disabled = useLLM;
    }
    if (elements.llmModelSelect) {
        elements.llmModelSelect.disabled = !useLLM;
        elements.llmModelSelect.value = state.llmModel || "gpt-5";
    }
}

function updatePageModeUI() {
    syncPageModeTabs();

    const isReviewMode = state.pageMode === "review";
    const isPredictMode = !isReviewMode;

    // Update sidebar title and hint based on mode and folder selection
    if (elements.sidebarTitle && elements.sidebarHint) {
        if (isReviewMode) {
            if (state.selectedReviewFolder !== null) {
                // Review mode with folder loaded
                elements.sidebarTitle.textContent = "Review Codes";
                elements.sidebarHint.textContent = "Review and edit codes assigned to the selected note, or manually add new codes.";
            } else {
                // Review mode without folder selected
                elements.sidebarTitle.textContent = "Review Codes";
                elements.sidebarHint.textContent = "Select an output folder to load codes and review them.";
            }
        } else {
            // Predict mode
            elements.sidebarTitle.textContent = "Assigned Codes";
            elements.sidebarHint.textContent = "choose from AI suggested codes and/or manually add your own.";
        }
    }

    // In predict mode: show local model controls only when not in LLM mode
    // This is now handled inside inferenceControls, so these toggles control visibility within the container
    const useLLM = state.mode === "llm";
    
    // Hide/show inference controls container
    // In predict mode: show when no codes exist (so user can configure and predict)
    // In review mode: always hide (inference controls not needed)
    if (isPredictMode) {
        const hasCodes = state.icdCodes.length > 0 || state.cptCodes.length > 0;
        const hasIcdCodes = state.icdCodes.length > 0;
        const hasCptCodes = state.cptCodes.length > 0;
        
        // Show inference controls when no codes exist, hide when codes exist
        // Hide codes container when showing controls (they replace each other)
        toggleSection(elements.inferenceControls, !hasCodes);
        
        // Show/hide the header actions wrapper (contains reset button and code type toggle)
        if (elements.aiHeaderActions) {
            toggleSection(elements.aiHeaderActions, hasCodes);
        }
        
        // Show AI code type toggle when codes are available (show if both types exist)
        if (elements.aiCodeTypeToggleWrapper) {
            const showToggle = hasCodes && hasIcdCodes && hasCptCodes;
            toggleSection(elements.aiCodeTypeToggleWrapper, showToggle);
        }
        
        // Reset button is always visible when aiHeaderActions is visible (handled by wrapper)
        
        // Show/hide code containers based on toggle state
        if (hasCodes) {
            const showIcd = state.aiSuggestedCodeType === "icd";
            const showCpt = state.aiSuggestedCodeType === "cpt";
            
            // Show codesContainer based on toggle state
            if (elements.codesContainer) {
                if (showIcd && hasIcdCodes) {
                    toggleSection(elements.codesContainer, true);
                    renderCodes("icd"); // Ensure ICD codes are rendered
                } else if (showCpt && hasCptCodes) {
                    toggleSection(elements.codesContainer, true);
                    renderCodes("cpt"); // Render CPT codes in ICD container
                } else {
                    toggleSection(elements.codesContainer, false);
                }
            }
        } else {
            // No codes, hide both containers
            if (elements.codesContainer) {
                toggleSection(elements.codesContainer, false);
            }
            if (elements.cptCodesContainer) {
                toggleSection(elements.cptCodesContainer, false);
            }
        }
        
        // Configure individual controls visibility when inference controls are shown
        if (!hasCodes) {
            toggleSection(elements.modeSelectWrapper, true);
            toggleSection(elements.icdVersionWrapper, true);
            toggleSection(elements.modelSelectWrapper, !useLLM);
            toggleSection(elements.methodSelectWrapper, !useLLM);
            toggleSection(elements.thresholdWrapper, !useLLM);
            toggleSection(elements.llmModelWrapper, useLLM);
            if (elements.submitBtn) {
                toggleSection(elements.submitBtn, true);
            }
        }
    } else {
        toggleSection(elements.inferenceControls, false);
        // In review mode, codes containers are shown/hidden based on loaded data
        // Hide header actions (reset button and toggle) in review mode
        if (elements.aiHeaderActions) {
            toggleSection(elements.aiHeaderActions, false);
        }
    }
    
    // Show/hide code type toggle and ICD version toggle in lookup panel
    // In both modes: show code type toggle, show ICD version toggle when ICD is selected
    if (elements.lookupCodeTypeWrapper) {
        toggleSection(elements.lookupCodeTypeWrapper, true); // Show in both modes
    }
    if (elements.lookupIcdVersionWrapper) {
        // In both modes, show ICD version toggle when ICD is selected in code type toggle
        const showIcdVersion = state.lookupCodeType === "icd";
        toggleSection(elements.lookupIcdVersionWrapper, showIcdVersion);
    }

    // Hide/show note input/upload area (drop zone, editor, and note display)
    // In predict mode: 
    //   - Show drop zone and editor when no codes exist (initial state)
    //   - Hide drop zone and editor when codes exist (highlighted note is shown)
    //   - Show note display container when codes exist (for highlights)
    // In review mode: hide drop zone and editor, show note display only if note is loaded
    if (isPredictMode) {
        const hasCodes = state.icdCodes.length > 0 || state.cptCodes.length > 0;
        
        // Hide drop zone and editor when highlighted note is available (codes exist)
        toggleSection(elements.dropZone, !hasCodes);
        toggleSection(elements.noteEditorContainer, !hasCodes);
        
        // Show note display container when codes exist (for highlighting)
        toggleSection(elements.noteDisplayContainer, hasCodes);
    } else {
        // Review mode: hide drop zone and editor, show note display only if note is loaded
        toggleSection(elements.dropZone, false);
        toggleSection(elements.noteEditorContainer, false);
        const hasLoadedData = state.loadedReviewData && state.loadedReviewData.note_text && state.loadedReviewData.note_text.trim().length > 0;
        toggleSection(elements.noteDisplayContainer, hasLoadedData);
    }

    // Hide/show AI suggestions section
    // In review mode: only show suggestions section when a folder is selected (show tabs and manual lookup, hide AI panels)
    // In predict mode: show everything
    if (isReviewMode) {
        // In review mode, only show suggestions section if a folder is selected
        const showSuggestionsInReview = state.selectedReviewFolder !== null;
        if (elements.suggestionsSection) {
            toggleSection(elements.suggestionsSection, showSuggestionsInReview);
        }
        if (showSuggestionsInReview) {
            // Tabs removed - visibility controlled by toggles
            if (elements.codeTabs) toggleSection(elements.codeTabs, false);
            // Only show ICD tab content (has toggle for ICD/CPT switching in manual lookup)
            // Both predict and review modes use single input with toggle - same behavior
            if (elements.icdTabContent) toggleSection(elements.icdTabContent, true);
            if (elements.cptTabContent) toggleSection(elements.cptTabContent, false);
            if (elements.manualLookupIcd) toggleSection(elements.manualLookupIcd, true);
            // CPT tab content hidden - manual lookup uses toggle in ICD content to switch between ICD/CPT
            // Hide AI panels in review mode
            if (elements.aiPanelIcd) toggleSection(elements.aiPanelIcd, false);
            // CPT AI panel hidden - handled by toggle in ICD panel
        }
    } else {
        // In predict mode, show the suggestions section
        // Show manual lookup, and AI panels always (so users can configure and see results)
        // Inside AI panels, inference controls and codes containers are toggled separately
        // Tabs removed - visibility controlled by toggles
        if (elements.suggestionsSection) {
            toggleSection(elements.suggestionsSection, true);
        }
        if (elements.codeTabs) toggleSection(elements.codeTabs, false);
        // Only show ICD tab content (has toggle for ICD/CPT switching in manual lookup)
        // Both predict and review modes use single input with toggle - same behavior
        if (elements.icdTabContent) toggleSection(elements.icdTabContent, true);
        if (elements.cptTabContent) toggleSection(elements.cptTabContent, false);
        if (elements.manualLookupIcd) toggleSection(elements.manualLookupIcd, true);
        // CPT tab content hidden - manual lookup uses toggle in ICD content to switch between ICD/CPT
        // Always show AI panel in ICD tab (has toggle for ICD/CPT codes)
        if (elements.aiPanelIcd) toggleSection(elements.aiPanelIcd, true);
        // CPT AI panel hidden - handled by toggle in ICD panel
    }

    // Show/hide folder browser in review mode
    toggleSection(elements.folderBrowser, isReviewMode);
    
    // Show/hide admission ID input in review mode (when folder is loaded)
    const showAdmissionId = isReviewMode && state.selectedReviewFolder !== null;
    toggleSection(elements.admissionIdWrapper, showAdmissionId);

    // Show/hide submit codes vs save changes buttons based on mode
    if (elements.submitCodesBtn) {
        toggleSection(elements.submitCodesBtn, isPredictMode);
    }
    if (elements.saveChangesBtn) {
        toggleSection(elements.saveChangesBtn, isReviewMode);
    }
    
    // Hide reset button in review mode
    if (elements.resetBtn) {
        toggleSection(elements.resetBtn, isPredictMode);
    }
    
    // Update code search placeholder when manual lookup is visible (both predict and review modes)
    if (isPredictMode || (isReviewMode && state.selectedReviewFolder !== null)) {
        updateCodeSearchPlaceholder();
    }
    
    // Hide/show entire code sidebar
    // In predict mode: hide entire sidebar if note textbox is empty, show otherwise
    // In review mode: always show sidebar (visibility controlled by folder selection elsewhere)
    if (elements.sidebar) {
        let sidebarVisible = true;
        if (isPredictMode) {
            const hasNoteText = state.noteText && state.noteText.trim().length > 0;
            sidebarVisible = hasNoteText;
            toggleSection(elements.sidebar, sidebarVisible);
        } else {
            // In review mode, show sidebar (folder selection controls other visibility)
            toggleSection(elements.sidebar, true);
            sidebarVisible = true;
        }
        
        // Add/remove class on app-main to make main content full-width when sidebar is hidden
        if (elements.appMain) {
            elements.appMain.classList.toggle("sidebar-hidden", !sidebarVisible);
        }
    } else {
        // If sidebar element doesn't exist, assume it's hidden
        if (elements.appMain) {
            elements.appMain.classList.add("sidebar-hidden");
        }
    }
}

function switchPageMode(newPageMode) {
    const targetMode = newPageMode === "review" ? "review" : "predict";

    if (state.pageMode === targetMode) {
        syncPageModeTabs();
        return;
    }

    state.pageMode = targetMode;
    updatePageModeUI();

    if (targetMode === "predict") {
        clearCodes();
        clearFinalizedCodes();
        state.noteText = "";
        state.originalNoteText = "";
        state.noteFileName = null;
        if (elements.noteInput) {
            elements.noteInput.value = "";
        }
        // Reset manual lookup code type and search terms when switching to predict mode
        state.lookupCodeType = "icd";
        if (elements.lookupCodeTypeToggle) {
            elements.lookupCodeTypeToggle.checked = false; // ICD = unchecked (thumb on left)
        }
        resetCodeSearch("icd");
        resetCodeSearch("cpt");
        // Reset AI suggested code type
        state.aiSuggestedCodeType = "icd";
        if (elements.aiCodeTypeToggle) {
            elements.aiCodeTypeToggle.checked = false; // ICD = unchecked (thumb on left)
        }
        renderNote();
        updatePageModeUI();
        updateSubmitCodesState();
        updateCodeSearchPlaceholder();
        updateCodeSearchAddState("icd");
        updateCodeSearchAddState("cpt");
        setStatus("Switched to Predict mode.", "info");
    } else {
        clearCodes();
        clearFinalizedCodes();
        state.noteText = "";
        state.originalNoteText = "";
        state.noteFileName = null;
        state.selectedReviewFolder = null;
        state.loadedReviewData = null;
        state.originalReviewCodes = null;
        state.originalAdmissionId = null;
        if (elements.admissionIdInput) {
            elements.admissionIdInput.value = "";
        }
        state.folderSearchTerm = "";
        if (elements.folderSearchInput) {
            elements.folderSearchInput.value = "";
        }
        // Reset manual lookup code type and search terms when switching to review mode
        state.lookupCodeType = "icd";
        if (elements.lookupCodeTypeToggle) {
            elements.lookupCodeTypeToggle.checked = false; // ICD = unchecked (thumb on left)
        }
        resetCodeSearch("icd");
        resetCodeSearch("cpt");
        renderNote();
        loadReviewFolders();
        updateSubmitCodesState();
        updatePageModeUI();
        updateCodeSearchPlaceholder();
        updateCodeSearchAddState("icd");
        updateCodeSearchAddState("cpt");
        setStatus("Switched to Review mode. Select an output folder to load.", "info");
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

// normalizeNote is already imported from utils.js

function inferIcdVersionFromModel(modelPath) {
    const normalized = (modelPath || "").toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized.includes("icd-10") || normalized.includes("icd10")) {
        return "10";
    }
    if (normalized.includes("icd-9") || normalized.includes("icd9")) {
        return "9";
    }
    return null;
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

function hasReviewChanges() {
    // Check if we're in review mode and have loaded data
    if (state.pageMode !== "review" || !state.selectedReviewFolder || state.originalReviewCodes === null) {
        return false;
    }
    
    // Check if admission ID changed
    const currentAdmissionId = elements.admissionIdInput ? elements.admissionIdInput.value.trim() : null;
    if (currentAdmissionId !== state.originalAdmissionId) {
        return true;
    }
    
    // Check if codes changed (compare arrays)
    const currentCodes = state.finalizedCodes || [];
    const originalCodes = state.originalReviewCodes || [];
    
    if (currentCodes.length !== originalCodes.length) {
        return true;
    }
    
    // Create a normalized comparison function
    const normalizeCode = (code) => ({
        code: (code.code || "").trim(),
        type: (code.type || "icd").toLowerCase(),
        description: (code.description || "").trim(),
        explanation: (code.explanation || "").trim(),
        probability: code.probability,
        icdVersion: code.icdVersion || null,
        // Compare spans count only (not exact content for now)
        spansCount: Array.isArray(code.spans) ? code.spans.length : 0,
    });
    
    const currentNormalized = currentCodes.map(normalizeCode).sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.code.localeCompare(b.code);
    });
    
    const originalNormalized = originalCodes.map(normalizeCode).sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.code.localeCompare(b.code);
    });
    
    // Compare normalized codes
    for (let i = 0; i < currentNormalized.length; i++) {
        const current = currentNormalized[i];
        const original = originalNormalized[i];
        if (
            current.code !== original.code ||
            current.type !== original.type ||
            current.description !== original.description ||
            current.explanation !== original.explanation ||
            current.probability !== original.probability ||
            current.icdVersion !== original.icdVersion ||
            current.spansCount !== original.spansCount
        ) {
            return true;
        }
    }
    
    return false;
}

function updateSubmitCodesState() {
    const processing = isProcessingActive();
    
    if (state.pageMode === "review") {
        // In review mode: use saveChangesBtn
        if (elements.saveChangesBtn) {
            const enabled = hasReviewChanges() && !processing;
            elements.saveChangesBtn.disabled = !enabled;
            if (!processing) {
                elements.saveChangesBtn.textContent = "Save Changes";
            }
        }
    } else {
        // In predict mode: use submitCodesBtn
        if (elements.submitCodesBtn) {
            const enabled = state.finalizedCodes.length > 0 && !processing;
            elements.submitCodesBtn.disabled = !enabled;
            if (!processing) {
                elements.submitCodesBtn.textContent = submitCodesButtonDefaultText;
            }
        }
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
                updateSubmitCodesState(); // Update button state in real-time
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
                updateSubmitCodesState(); // Ensure button state is updated after blur
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
            // In review mode, clicking should highlight spans; otherwise activate editor
            if (state.pageMode === "review" && entry.spans && entry.spans.length > 0) {
                // Toggle highlighting for this code
                const isSelected = card.classList.contains("highlighted");
                if (isSelected) {
                    card.classList.remove("highlighted");
                    // Clear highlights if no other codes are selected
                    const anyHighlighted = Array.from(elements.finalizedContainer.querySelectorAll(".final-code-card.highlighted")).length > 1;
                    if (!anyHighlighted) {
                        renderNote();
                    } else {
                        updateFinalizedHighlights();
                    }
                } else {
                    card.classList.add("highlighted");
                    updateFinalizedHighlights();
                }
            } else {
                activateEditor();
            }
        });

        card.addEventListener("keydown", (event) => {
            if (event.target.matches("textarea.final-code-description")) {
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (state.pageMode === "review" && entry.spans && entry.spans.length > 0) {
                    // In review mode, toggle highlighting
                    card.click();
                } else {
                    activateEditor();
                }
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
        explanation: entry.explanation ?? "",
        probability: entry.probability ?? null,
        type: codeType,
        spans: Array.isArray(entry.spans) ? entry.spans : [],
        icdVersion: entry.icdVersion ?? null,
        editing: false,
    });
    renderFinalizedCodes();
}

// decodeTokenFragment, generateSpanCandidates, normalizeSpanArray, buildTokenHighlights, renderNote, updateNote
// are already imported from noteHandling.js
// QUOTE_TRIM_REGEX and TRAILING_PUNCT_REGEX are already imported from constants.js

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

    // Update ICD cards in the ICD container
    document.querySelectorAll("#codesContainer .code-card").forEach((card) => {
        const cardId = card.dataset.codeId;
        // Check if this is an ICD code or a CPT code (CPT codes can be in ICD container when AI toggle is set to CPT)
        const isActive = state.selectedIcdCodeIds.has(cardId) || state.selectedCptCodeIds.has(cardId);
        card.classList.toggle("active", isActive);
        card.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    // Update CPT cards in the CPT container
    document.querySelectorAll("#cptCodesContainer .code-card").forEach((card) => {
        const cardId = card.dataset.codeId;
        const isActive = state.selectedCptCodeIds.has(cardId);
        card.classList.toggle("active", isActive);
        card.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
}

function updateFinalizedHighlights() {
    if (!elements.finalizedContainer) {
        return;
    }
    
    const highlightedCards = elements.finalizedContainer.querySelectorAll(".final-code-card.highlighted");
    if (highlightedCards.length === 0) {
        renderNote();
        return;
    }
    
    // Get all spans from highlighted finalized codes
    const allSpans = [];
    let highlightIndex = 0;
    highlightedCards.forEach((card) => {
        // Find the corresponding entry in state
        const codeText = card.querySelector(".code").textContent.trim();
        const entry = state.finalizedCodes.find((e) => {
            const codeType = (e.type || "icd").toUpperCase();
            return `${codeType} ${e.code}` === codeText;
        });
        
        if (entry && entry.spans && entry.spans.length > 0) {
            const highlightClass = highlightClasses[highlightIndex % highlightClasses.length];
            allSpans.push(...entry.spans.map(span => ({
                ...span,
                highlightClass: highlightClass
            })));
            highlightIndex++;
        }
    });
    
    renderNote(allSpans);
}

function toggleCodeSelection(codeId, codeType = "icd") {
    const selectedSet = codeType === "icd" ? state.selectedIcdCodeIds : state.selectedCptCodeIds;
    if (selectedSet.has(codeId)) {
        selectedSet.delete(codeId);
        state.expandedCodeIds.delete(codeId);
    } else {
        selectedSet.add(codeId);
        state.expandedCodeIds.add(codeId); // Expand when selected
    }
    updateActiveHighlight();
    // Re-render codes to show/hide explanation
    renderCodes(codeType);
}

// updateNote is already imported from noteHandling.js
// But we need a wrapper that also clears codes and updates UI
function updateNoteWithUI(text) {
    updateNote(text);
    elements.noteInput.value = state.originalNoteText;

    // Clear codes if they exist (note changed)
    if (state.icdCodes.length > 0 || state.cptCodes.length > 0) {
        clearCodes();
    }

    displayNoteFilename();
    // Update UI based on page mode (handles drop zone, editor, and note display visibility)
    updatePageModeUI();
}

function readFile(file) {
    if (!file) {
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        state.noteFileName = file.name;
        clearFinalizedCodes();
        updateNoteWithUI(reader.result || "");
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

// populateSelect and filterModelsByICDVersion are already imported from utils.js

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

// formatProbability is already imported from utils.js

function clearCodes() {
    state.selectedIcdCodeIds.clear();
    state.selectedCptCodeIds.clear();
    state.expandedCodeIds.clear();
    state.icdCodes = [];
    state.cptCodes = [];
    elements.codesContainer.innerHTML = `<p class="empty-state">No ICD codes predicted</p>`;
    elements.cptCodesContainer.innerHTML = `<p class="empty-state">No CPT codes predicted</p>`;
    updateSubmitCodesState();
    renderNote();
    // Update UI to show/hide note display container based on whether codes exist
    updatePageModeUI();
}

function resetAISuggestions() {
    clearCodes();
    setStatus("AI suggestions cleared. Ready for new prediction.", "success");
}

function renderCodes(codeType = "icd") {
    const codes = codeType === "icd" ? state.icdCodes : state.cptCodes;
    // In predict mode, if we're rendering CPT codes and the AI toggle is set to CPT,
    // render in the ICD panel's codesContainer. Otherwise use the default containers.
    let container;
    if (state.pageMode === "predict" && codeType === "cpt" && state.aiSuggestedCodeType === "cpt") {
        container = elements.codesContainer; // Render CPT codes in ICD panel container
    } else {
        container = codeType === "icd" ? elements.codesContainer : elements.cptCodesContainer;
    }
    const selectedSet = codeType === "icd" ? state.selectedIcdCodeIds : state.selectedCptCodeIds;

    const filtered = codes.slice();

    if (!filtered.length) {
        const emptyMessage = `No ${codeType.toUpperCase()} codes predicted`;
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
            fallback.textContent = "Explanation available, click to reveal";
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

        // Add explanation section (shown when expanded)
        const isExpanded = state.expandedCodeIds.has(entry.id);
        const explanationText = typeof entry.explanation === "string" ? entry.explanation.trim() : "";
        if (isExpanded && explanationText) {
            const explanationWrapper = document.createElement("div");
            explanationWrapper.className = "code-explanation";
            const explanationLabel = document.createElement("div");
            explanationLabel.className = "explanation-label";
            explanationLabel.textContent = "Explanation:";
            const explanationTextEl = document.createElement("div");
            explanationTextEl.className = "explanation-text";
            explanationTextEl.textContent = explanationText;
            explanationWrapper.appendChild(explanationLabel);
            explanationWrapper.appendChild(explanationTextEl);
            card.appendChild(explanationWrapper);
        }

        card.addEventListener("click", (event) => {
            // Don't toggle if clicking on the add button (it has its own handler)
            if (event.target.closest(".code-add-btn")) {
                return;
            }
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

// All code search functions are already imported from codeSearch.js module above

async function submitPrediction() {
    const rawNote = elements.noteInput.value;
    const normalizedNote = normalizeNote(rawNote);
    if (!normalizedNote.trim()) {
        setStatus("Please provide a clinical note before submitting.", "error");
        return;
    }

    updateNoteWithUI(rawNote);

    const useLLM = state.mode === "llm";
    const payload = {
        note: state.noteText,
    };
    let endpoint = "/predict-explain";
    let selectedModel = "";

    if (useLLM) {
        endpoint = "/predict-explain-llm";
        const llmModelName = elements.llmModelSelect ? elements.llmModelSelect.value.trim() : "gpt-5";
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
        selectedModel = model;
    }

    try {
        setStatus(useLLM ? "Running LLM prediction..." : "Running prediction...", "loading");
        setProcessing(true, "predict");
        // Don't clear finalized codes - keep manually added codes
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
        const inferredIcdVersion = useLLM ? state.icdVersion : inferIcdVersionFromModel(selectedModel);
        
        if (!icdCodes.length && !cptCodes.length) {
            setStatus(
                useLLM
                    ? "LLM did not return any codes."
                    : "No codes met the confidence threshold.",
                "success"
            );
            clearCodes();
            updatePageModeUI();
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

            // Extract explanation as string: if it's a string, use it; if it's an object, check for text field or use empty string
            let explanationText = "";
            if (typeof entry.explanation === "string") {
                explanationText = entry.explanation.trim();
            } else if (entry.explanation && typeof entry.explanation === "object") {
                // For local models, explanation might be an object with spans/tokens
                // Check if there's a text field in the explanation object or in the entry itself
                explanationText = entry.explanation.text || entry.explanation_text || "";
                if (typeof explanationText !== "string") {
                    explanationText = "";
                }
            }

            return {
                id: `icd-${entry.code}-${index}`,
                code: entry.code,
                description: entry.description ?? "",
                explanation: explanationText,
                probability:
                    typeof probabilityValue === "number" && !Number.isNaN(probabilityValue)
                        ? probabilityValue
                        : null,
                highlightClass,
                tokens,
                spans,
                source: useLLM ? "llm" : "local",
                icdVersion: inferredIcdVersion || null,
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

            // Extract explanation as string: if it's a string, use it; if it's an object, check for text field or use empty string
            let explanationText = "";
            if (typeof entry.explanation === "string") {
                explanationText = entry.explanation.trim();
            } else if (entry.explanation && typeof entry.explanation === "object") {
                // For local models, explanation might be an object with spans/tokens
                // Check if there's a text field in the explanation object or in the entry itself
                explanationText = entry.explanation.text || entry.explanation_text || "";
                if (typeof explanationText !== "string") {
                    explanationText = "";
                }
            }

            return {
                id: `cpt-${entry.code}-${index}`,
                code: entry.code,
                description: entry.description ?? "",
                explanation: explanationText,
                probability:
                    typeof probabilityValue === "number" && !Number.isNaN(probabilityValue)
                        ? probabilityValue
                        : null,
                highlightClass,
                tokens,
                spans,
                source: useLLM ? "llm" : "local",
                icdVersion: null,
            };
        });

        renderCodes("icd");
        renderCodes("cpt");
        renderNote();
        // Update UI based on page mode (will handle drop zone/editor/display visibility)
        updatePageModeUI();

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
        updatePageModeUI();
    } finally {
        setProcessing(false, "predict");
        updateSubmitCodesState();
    }
}

function showFolderNameModal() {
    if (!elements.folderNameModal || !elements.folderNameInput) {
        return;
    }
    elements.folderNameInput.value = "";
    elements.folderNameModal.classList.remove("hidden");
    elements.folderNameModal.setAttribute("aria-hidden", "false");
    elements.folderNameInput.focus();
}

function hideFolderNameModal() {
    if (!elements.folderNameModal) {
        return;
    }
    elements.folderNameModal.classList.add("hidden");
    elements.folderNameModal.setAttribute("aria-hidden", "true");
}

// sanitizeFolderName is already imported from utils.js

async function submitFinalizedCodes(folderName = null, updateExisting = false, oldFolderName = null) {
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

    const codesPayload = state.finalizedCodes.map((entry) => {
        const codeType = (entry.type || "icd").toLowerCase();
        const spans = Array.isArray(entry.spans)
            ? entry.spans
                  .map((span) => {
                      if (!span || typeof span !== "object") {
                          return null;
                      }
                      const sanitized = {};
                      const start = Number(span.start);
                      if (Number.isFinite(start)) {
                          sanitized.start = Math.trunc(start);
                      }
                      const end = Number(span.end);
                      if (Number.isFinite(end)) {
                          sanitized.end = Math.trunc(end);
                      }
                      if (typeof span.text === "string") {
                          sanitized.text = span.text;
                      }
                      return Object.keys(sanitized).length ? sanitized : null;
                  })
                  .filter(Boolean)
            : [];

        // Ensure explanation is always a string (defense in depth)
        let explanationText = "";
        if (typeof entry.explanation === "string") {
            explanationText = entry.explanation.trim();
        } else if (entry.explanation && typeof entry.explanation === "object") {
            // If somehow an explanation object got stored, try to extract text or use empty string
            explanationText = entry.explanation.text || entry.explanation_text || "";
            if (typeof explanationText !== "string") {
                explanationText = "";
            }
        }

        return {
            code: entry.code,
            code_type: codeType,
            description: entry.description ?? "",
            explanation: explanationText,
            probability: entry.probability,
            icd_version: codeType === "icd" ? (entry.icdVersion || null) : null,
            evidence_spans: spans,
        };
    });

    const icdCount = codesPayload.filter((entry) => entry.code_type === "icd").length;
    const cptCount = codesPayload.filter((entry) => entry.code_type === "cpt").length;

    const payload = {
        note_text: state.noteText,
        note_filename: effectiveFileName,
        codes: codesPayload,
        update_existing: updateExisting,
    };
    
    if (folderName && folderName.trim().length) {
        payload.output_folder = sanitizeFolderName(folderName.trim());
    }
    
    // If oldFolderName is provided and different from new folder name, include it for renaming
    if (oldFolderName && oldFolderName.trim().length && oldFolderName !== folderName) {
        payload.old_folder_name = sanitizeFolderName(oldFolderName.trim());
    }

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
        const outputPathRaw = typeof data.output_path === "string" ? data.output_path : "output";
        const counts = data && typeof data === "object" ? data.counts : null;
        const icdSummaryCount =
            counts && typeof counts.icd === "number" ? counts.icd : icdCount;
        const cptSummaryCount =
            counts && typeof counts.cpt === "number" ? counts.cpt : cptCount;
        const icd9SummaryCount =
            counts && typeof counts.icd9 === "number" ? counts.icd9 : null;
        const icd10SummaryCount =
            counts && typeof counts.icd10 === "number" ? counts.icd10 : null;
        const icdUnknownSummaryCount =
            counts && typeof counts.icd_unknown === "number" ? counts.icd_unknown : null;
        const normalizedOutput = outputPathRaw.replace(/\\/g, "/").replace(/\/+$/, "");
        const codesFileName =
            data.codes_file ||
            (Array.isArray(data.created_files)
                ? data.created_files.find(
                      (name) => typeof name === "string" && name.toLowerCase().endsWith(".json")
                  )
                : null) ||
            "finalized_codes.json";
        const outputFilePath = normalizedOutput ? `${normalizedOutput}/${codesFileName}` : codesFileName;

        let message = `Codes submitted successfully. Saved to ${outputFilePath}.`;
        const summaryParts = [];
        if (icd9SummaryCount > 0) {
            summaryParts.push(`${icd9SummaryCount} ICD-9 code${icd9SummaryCount === 1 ? "" : "s"}`);
        }
        if (icd10SummaryCount > 0) {
            summaryParts.push(`${icd10SummaryCount} ICD-10 code${icd10SummaryCount === 1 ? "" : "s"}`);
        }
        if (!icd9SummaryCount && !icd10SummaryCount && icdSummaryCount > 0) {
            summaryParts.push(`${icdSummaryCount} ICD code${icdSummaryCount === 1 ? "" : "s"}`);
        }
        if (icdUnknownSummaryCount > 0) {
            summaryParts.push(`${icdUnknownSummaryCount} ICD (unspecified) code${icdUnknownSummaryCount === 1 ? "" : "s"}`);
        }
        if (cptSummaryCount > 0) {
            summaryParts.push(`${cptSummaryCount} CPT code${cptSummaryCount === 1 ? "" : "s"}`);
        }
        if (summaryParts.length) {
            message += ` Export covers ${summaryParts.join(" and ")}.`;
        }
        // If we're in review mode and saved successfully, reset the review workspace
        if (state.pageMode === "review") {
            // Reload the folder list to reflect any changes (including renaming)
            const newAdmissionId = elements.admissionIdInput ? elements.admissionIdInput.value.trim() : state.selectedReviewFolder;
            if (newAdmissionId) {
                // Update selectedReviewFolder to match the new admission ID (folder may have been renamed)
                state.selectedReviewFolder = newAdmissionId;
            }
            // Reset immediately and preserve the success message after reset
            (async () => {
                await loadReviewFolders();
                resetReviewWorkspace({ message: message, type: "success" });
            })();
        } else {
            // In predict mode, reset the page back to text input mode after successful submission
            // Preserve the success message after reset
            resetAll({ message: message, type: "success" });
        }
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
    
    // Tab buttons removed - both tab contents are always shown now
    // Keep both tab contents visible
    if (elements.icdTabContent && elements.cptTabContent) {
        elements.icdTabContent.classList.add("active");
        elements.cptTabContent.classList.add("active");
    }
    
    // Update visibility of ICD version toggle in lookup panel
    if (elements.lookupIcdVersionWrapper) {
        const showInLookup = state.pageMode === "review" && tabType === "icd";
        toggleSection(elements.lookupIcdVersionWrapper, showInLookup);
    }

    renderCodeSearchResults("icd");
    renderCodeSearchResults("cpt");
    updateCodeSearchAddState("icd");
    updateCodeSearchAddState("cpt");
}

function resetAll(preserveStatusMessage = null) {
    elements.noteInput.value = "";
    resetCodeSearch("icd");
    resetCodeSearch("cpt");
    state.originalNoteText = "";
    state.noteText = "";
    state.noteFileName = null;
    state.icdCodes = [];
    state.cptCodes = [];
    state.selectedIcdCodeIds.clear();
    state.selectedCptCodeIds.clear();
    state.expandedCodeIds.clear();
    state.activeTab = "icd";
    renderNote();
    clearCodes();
    clearFinalizedCodes();
    switchTab("icd");
    setProcessing(false, "predict");
    // Update UI based on page mode (will handle drop zone/editor visibility)
    updatePageModeUI();
    // If a status message is provided, preserve it; otherwise use the default message
    if (preserveStatusMessage !== null) {
        setStatus(preserveStatusMessage.message, preserveStatusMessage.type || "success");
    } else {
        setStatus("Cleared inputs.", "success");
    }
}

function syncIcdVersionToggles() {
    // Sync AI prediction toggle to match its state
    if (elements.icdVersionToggle) {
        elements.icdVersionToggle.checked = state.icdVersion === "10";
    }
    // Sync manual lookup toggle to match its state
    if (elements.lookupIcdVersionToggle) {
        elements.lookupIcdVersionToggle.checked = state.lookupIcdVersion === "10";
    }
}

function handleIcdVersionChange(newVersion) {
    // Handle AI prediction ICD version change
    if (state.icdVersion === newVersion) {
        return;
    }
    
    state.icdVersion = newVersion;
    
    // In predict mode, clear AI predicted codes and filter models
    // Don't clear finalized codes - keep manually added codes
    if (state.pageMode === "predict") {
        filterAndPopulateModels();
        clearCodes();
        renderNote();
        setStatus(
            `Switched to ICD-${newVersion} for prediction. Model list updated.`,
            "info"
        );
    }
}

function handleLookupIcdVersionChange(newVersion) {
    // Handle manual lookup ICD version change
    if (state.lookupIcdVersion === newVersion) {
        return;
    }
    
    state.lookupIcdVersion = newVersion;
    resetCodeSearch("icd");
    
    // In review mode, only update the search dictionary and note rendering
    // Don't clear finalized codes (they're loaded from the folder)
    if (state.pageMode === "review") {
        renderNote(); // Re-render note to update highlights if any
        setStatus(
            `Switched to ICD-${newVersion}. Manual lookup now searches ICD-${newVersion} dictionary.`,
            "info"
        );
    } else {
        setStatus(
            `Switched to ICD-${newVersion} for manual lookup.`,
            "info"
        );
    }
}

function initEvents() {
    if (elements.modeTabs && elements.modeTabs.length) {
        const tabs = elements.modeTabs;
        tabs.forEach((tab) => {
            tab.addEventListener("click", () => {
                const tabMode = tab.dataset.mode === "review" ? "review" : "predict";
                switchPageMode(tabMode);
            });
            tab.addEventListener("keydown", (event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const currentIndex = tabs.indexOf(tab);
                    const direction = event.key === "ArrowRight" ? 1 : -1;
                    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
                    const nextTab = tabs[nextIndex];
                    if (nextTab) {
                        nextTab.focus();
                        const mode = nextTab.dataset.mode === "review" ? "review" : "predict";
                        switchPageMode(mode);
                    }
                }
            });
        });
        syncPageModeTabs();
    }

    if (elements.refreshFoldersBtn) {
        elements.refreshFoldersBtn.addEventListener("click", () => {
            loadReviewFolders();
        });
    }
    if (elements.clearFoldersBtn) {
        elements.clearFoldersBtn.addEventListener("click", () => {
            deleteAllReviewFolders();
        });
    }

    // Folder search input
    if (elements.folderSearchInput) {
        elements.folderSearchInput.addEventListener("input", (event) => {
            state.folderSearchTerm = event.target.value || "";
            renderFolderList();
        });
        // Clear search when switching modes or when folders are reloaded
        elements.folderSearchInput.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                state.folderSearchTerm = "";
                elements.folderSearchInput.value = "";
                renderFolderList();
            }
        });
    }

    if (elements.icdVersionToggle) {
        elements.icdVersionToggle.addEventListener("change", (event) => {
            // When checked (thumb on right) = ICD-10, when unchecked (thumb on left) = ICD-9
            const newVersion = event.target.checked ? "10" : "9";
            handleIcdVersionChange(newVersion);
        });
        // Initialize toggle state: ICD-9 = unchecked (thumb on left), ICD-10 = checked (thumb on right)
        elements.icdVersionToggle.checked = state.icdVersion === "10";
    }
    
    if (elements.lookupCodeTypeToggle) {
        elements.lookupCodeTypeToggle.addEventListener("change", (event) => {
            // When checked (thumb on right) = CPT, when unchecked (thumb on left) = ICD
            const newCodeType = event.target.checked ? "cpt" : "icd";
            if (state.lookupCodeType !== newCodeType) {
                state.lookupCodeType = newCodeType;
                updatePageModeUI(); // Update visibility of ICD version toggle
                resetCodeSearch(state.lookupCodeType === "icd" ? "cpt" : "icd"); // Clear search for the other type
                updateCodeSearchPlaceholder();
                updateCodeSearchAddState("icd");
                updateCodeSearchAddState("cpt");
                setStatus(
                    `Switched to ${newCodeType.toUpperCase()} code lookup.`,
                    "info"
                );
            }
        });
        // Initialize toggle state: ICD = unchecked (thumb on left), CPT = checked (thumb on right)
        elements.lookupCodeTypeToggle.checked = state.lookupCodeType === "cpt";
    }
    
    // AI Suggested Code Type Toggle (for switching between ICD and CPT in AI panel)
    if (elements.aiCodeTypeToggle) {
        elements.aiCodeTypeToggle.addEventListener("change", (event) => {
            // When checked (thumb on right) = CPT, when unchecked (thumb on left) = ICD
            const newCodeType = event.target.checked ? "cpt" : "icd";
            if (state.aiSuggestedCodeType !== newCodeType) {
                state.aiSuggestedCodeType = newCodeType;
                // Update title
                const titleElement = document.getElementById("aiSuggestedTitle-icd");
                if (titleElement) {
                    titleElement.textContent = newCodeType === "icd" 
                        ? "AI Suggested ICD Codes" 
                        : "AI Suggested CPT Codes";
                }
                // Re-render codes based on toggle
                updatePageModeUI();
                setStatus(
                    `Switched to ${newCodeType.toUpperCase()} codes view.`,
                    "success"
                );
            }
        });
        // Initialize toggle state: ICD = unchecked (thumb on left), CPT = checked (thumb on right)
        elements.aiCodeTypeToggle.checked = state.aiSuggestedCodeType === "cpt";
    }
    
    if (elements.lookupIcdVersionToggle) {
        elements.lookupIcdVersionToggle.addEventListener("change", (event) => {
            // When checked (thumb on right) = ICD-10, when unchecked (thumb on left) = ICD-9
            const newVersion = event.target.checked ? "10" : "9";
            handleLookupIcdVersionChange(newVersion);
        });
        // Initialize toggle state: ICD-9 = unchecked (thumb on left), ICD-10 = checked (thumb on right)
        elements.lookupIcdVersionToggle.checked = state.lookupIcdVersion === "10";
    }

    if (elements.modeSelect) {
        elements.modeSelect.addEventListener("change", (event) => {
            const newMode = event.target.value === "llm" ? "llm" : "local";
            if (state.mode !== newMode) {
                state.mode = newMode;
                updateModeUI();
                clearCodes();
                //clearFinalizedCodes();
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

    if (elements.llmModelSelect) {
        // Populate LLM model dropdown
        populateSelect(elements.llmModelSelect, LLM_MODELS);
        elements.llmModelSelect.value = state.llmModel || "gpt-5";
        
        elements.llmModelSelect.addEventListener("change", (event) => {
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
    if (elements.resetAISuggestionsBtn) {
        elements.resetAISuggestionsBtn.addEventListener("click", resetAISuggestions);
    }
    if (elements.submitCodesBtn) {
        elements.submitCodesBtn.addEventListener("click", () => {
            // In predict mode: show modal to get folder name
            if (!state.finalizedCodes.length) {
                setStatus("Add at least one code before submitting.", "error");
                return;
            }
            showFolderNameModal();
        });
    }
    
    if (elements.saveChangesBtn) {
        elements.saveChangesBtn.addEventListener("click", () => {
            // In review mode: always update existing folder (with renaming if admission ID changed)
            if (!hasReviewChanges()) {
                setStatus("No changes to save.", "info");
                return;
            }
            const folderName = elements.admissionIdInput ? elements.admissionIdInput.value.trim() : state.selectedReviewFolder;
            if (!folderName) {
                setStatus("Admission ID is required.", "error");
                return;
            }
            const oldFolderName = state.selectedReviewFolder;
            // Always update existing folder, but pass old folder name for renaming if needed
            submitFinalizedCodes(folderName, true, oldFolderName); // updateExisting = true, pass oldFolderName for renaming
        });
    }
    
    // Add event listener for admission ID input changes
    if (elements.admissionIdInput) {
        elements.admissionIdInput.addEventListener("input", () => {
            updateSubmitCodesState();
        });
    }
    
    if (elements.folderNameCancelBtn) {
        elements.folderNameCancelBtn.addEventListener("click", hideFolderNameModal);
    }
    
    if (elements.folderNameSubmitBtn) {
        elements.folderNameSubmitBtn.addEventListener("click", () => {
            const folderName = elements.folderNameInput ? elements.folderNameInput.value.trim() : "";
            hideFolderNameModal();
            submitFinalizedCodes(folderName);
        });
    }
    
    if (elements.folderNameInput) {
        elements.folderNameInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const folderName = elements.folderNameInput.value.trim();
                hideFolderNameModal();
                submitFinalizedCodes(folderName);
            } else if (event.key === "Escape") {
                event.preventDefault();
                hideFolderNameModal();
            }
        });
    }
    
    // Close modal when clicking outside
    if (elements.folderNameModal) {
        elements.folderNameModal.addEventListener("click", (event) => {
            if (event.target === elements.folderNameModal) {
                hideFolderNameModal();
            }
        });
    }
    elements.clearHighlightsBtn.addEventListener("click", () => {
        state.selectedIcdCodeIds.clear();
        state.selectedCptCodeIds.clear();
        state.expandedCodeIds.clear();
        updateActiveHighlight();
        renderCodes("icd");
        renderCodes("cpt");
        
        // Also clear finalized code highlights in review mode
        if (state.pageMode === "review" && elements.finalizedContainer) {
            elements.finalizedContainer.querySelectorAll(".final-code-card.highlighted").forEach((card) => {
                card.classList.remove("highlighted");
            });
            updateFinalizedHighlights();
        }
    });

    // Tab switching functionality
    // Tab buttons removed - functionality controlled by toggles
    // if (elements.icdTab) {
    //     elements.icdTab.addEventListener("click", () => switchTab("icd"));
    // }
    // if (elements.cptTab) {
    //     elements.cptTab.addEventListener("click", () => switchTab("cpt"));
    // }

    // Search event listeners
    if (elements.searchInput) {
        // Use lookupCodeType to determine which search to perform (both predict and review modes)
        elements.searchInput.addEventListener("input", (event) => {
            handleCodeSearchInput(state.lookupCodeType, event);
        });
        elements.searchInput.addEventListener("keydown", (event) => {
            handleCodeSearchKeyDown(state.lookupCodeType, event);
        });
        elements.searchInput.addEventListener("focus", () => {
            handleCodeSearchFocus(state.lookupCodeType);
        });
        elements.searchInput.addEventListener("blur", () => {
            handleCodeSearchBlur(state.lookupCodeType);
        });
        // Initialize placeholder
        updateCodeSearchPlaceholder();
    }
    if (elements.codeSearchAddBtn) {
        elements.codeSearchAddBtn.addEventListener("click", () => {
            // Use lookupCodeType (both predict and review modes)
            const searchType = state.lookupCodeType;
            const { term } = getCodeSearchState(searchType);
            if (term.trim()) {
                addManualCodeFromSearch(searchType, term.trim());
            }
        });
    }
    if (elements.cptSearchInput) {
        elements.cptSearchInput.addEventListener("input", (event) => handleCodeSearchInput("cpt", event));
        elements.cptSearchInput.addEventListener("keydown", (event) => handleCodeSearchKeyDown("cpt", event));
        elements.cptSearchInput.addEventListener("focus", () => handleCodeSearchFocus("cpt"));
        elements.cptSearchInput.addEventListener("blur", () => handleCodeSearchBlur("cpt"));
    }
    if (elements.cptSearchAddBtn) {
        elements.cptSearchAddBtn.addEventListener("click", () => {
            const { term } = getCodeSearchState("cpt");
            if (term.trim()) {
                addManualCodeFromSearch("cpt", term.trim());
            }
        });
    }
    
    updateSubmitCodesState();
    updateModeUI();
    updateCodeSearchAddState("icd");
    updateCodeSearchAddState("cpt");
}

async function loadReviewFolders() {
    try {
        setStatus("Loading folders...", "loading");
        const response = await fetch("/output-folders");
        if (!response.ok) {
            throw new Error(`Failed to load folders: ${response.status}`);
        }
        const data = await response.json();
        state.reviewFolders = Array.isArray(data.folders) ? data.folders : [];
        // Note: We keep the search term when reloading (user might have a search active)
        renderFolderList();
        setStatus(`Loaded ${state.reviewFolders.length} folder${state.reviewFolders.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
        console.error("Failed to load folders:", error);
        state.reviewFolders = [];
        renderFolderList();
        setStatus(`Failed to load folders: ${error.message}`, "error");
    }
}

function renderFolderList() {
    if (!elements.folderList) {
        return;
    }
    
    // Filter folders based on search term (case-insensitive match against folder name/admission ID)
    const searchTerm = (state.folderSearchTerm || "").trim().toLowerCase();
    let filteredFolders = state.reviewFolders.filter((folder) => {
        if (!searchTerm) {
            return true;
        }
        const folderName = (folder.name || "").toLowerCase();
        return folderName.includes(searchTerm);
    });
    
    // Sort folders by date (most recent first)
    filteredFolders = filteredFolders.sort((a, b) => {
        const dateA = a.generated_at ? new Date(a.generated_at).getTime() : 0;
        const dateB = b.generated_at ? new Date(b.generated_at).getTime() : 0;
        return dateB - dateA; // Descending order (most recent first)
    });
    
    if (filteredFolders.length === 0) {
        if (searchTerm) {
            elements.folderList.innerHTML = `<p class="empty-state">No folders found matching "${state.folderSearchTerm}".</p>`;
        } else {
            elements.folderList.innerHTML = `<p class="empty-state">No output folders found.</p>`;
        }
        return;
    }
    
    elements.folderList.innerHTML = "";
    filteredFolders.forEach((folder) => {
        const folderCard = document.createElement("div");
        folderCard.className = "folder-card";
        if (state.selectedReviewFolder === folder.name) {
            folderCard.classList.add("selected");
        }
        
        const header = document.createElement("div");
        header.className = "folder-card-header";
        
        const nameEl = document.createElement("div");
        nameEl.className = "folder-name";
        nameEl.textContent = folder.name;
        header.appendChild(nameEl);
        
        if (folder.generated_at) {
            const dateEl = document.createElement("div");
            dateEl.className = "folder-date";
            try {
                const date = new Date(folder.generated_at);
                dateEl.textContent = date.toLocaleString();
            } catch {
                dateEl.textContent = folder.generated_at;
            }
            header.appendChild(dateEl);
        }
        
        // Add delete button
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "folder-delete-btn";
        deleteBtn.innerHTML = "×";
        deleteBtn.setAttribute("aria-label", `Delete folder ${folder.name}`);
        deleteBtn.type = "button";
        deleteBtn.addEventListener("click", (event) => {
            event.stopPropagation(); // Prevent folder selection when clicking delete
            deleteReviewFolder(folder.name);
        });
        header.appendChild(deleteBtn);
        
        folderCard.appendChild(header);
        
        if (folder.code_counts && (folder.code_counts.total > 0 || folder.code_counts.icd > 0 || folder.code_counts.cpt > 0)) {
            const countsEl = document.createElement("div");
            countsEl.className = "folder-counts";
            const counts = [];
            if (folder.code_counts.icd > 0) {
                counts.push(`${folder.code_counts.icd} ICD`);
            }
            if (folder.code_counts.cpt > 0) {
                counts.push(`${folder.code_counts.cpt} CPT`);
            }
            if (counts.length > 0) {
                countsEl.textContent = counts.join(", ");
            } else if (folder.code_counts.total > 0) {
                countsEl.textContent = `${folder.code_counts.total} code${folder.code_counts.total === 1 ? "" : "s"}`;
            }
            folderCard.appendChild(countsEl);
        }
        
        if (folder.note_file) {
            const noteEl = document.createElement("div");
            noteEl.className = "folder-note-file";
            noteEl.textContent = folder.note_file;
            folderCard.appendChild(noteEl);
        }
        
        folderCard.addEventListener("click", () => {
            selectReviewFolder(folder.name);
        });
        
        elements.folderList.appendChild(folderCard);
    });
}

function resetReviewWorkspace(preserveStatusMessage = null) {
    state.selectedReviewFolder = null;
    state.loadedReviewData = null;
    state.noteText = "";
    state.originalNoteText = "";
    state.noteFileName = null;
    state.finalizedCodes = [];
    state.originalReviewCodes = null;
    state.originalAdmissionId = null;
    state.selectedIcdCodeIds.clear();
    state.selectedCptCodeIds.clear();
    state.expandedCodeIds.clear();
    if (elements.admissionIdInput) {
        elements.admissionIdInput.value = "";
    }
    renderNote();
    renderFinalizedCodes();
    // Clear code highlights
    clearCodes();
    updatePageModeUI();
    updateSubmitCodesState();
    // If a status message is provided, preserve it; otherwise don't set a default message
    if (preserveStatusMessage !== null) {
        setStatus(preserveStatusMessage.message, preserveStatusMessage.type || "success");
    }
}

async function deleteReviewFolder(folderName) {
    if (!folderName) {
        return;
    }
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete folder "${folderName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        setStatus(`Deleting folder ${folderName}...`, "loading");
        setProcessing(true, "predict");
        
        const response = await fetch(`/output-folder/${encodeURIComponent(folderName)}`, {
            method: "DELETE",
        });
        
        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `Failed to delete folder: ${response.status}`);
        }
        
        // If the deleted folder was selected, clear the selection
        if (state.selectedReviewFolder === folderName) {
            resetReviewWorkspace();
        }
        
        // Reload folder list
        await loadReviewFolders();
        setStatus(`Folder "${folderName}" deleted successfully.`, "success");
    } catch (error) {
        setStatus(`Failed to delete folder: ${error.message}`, "error");
    } finally {
        setProcessing(false, "predict");
    }
}

async function deleteAllReviewFolders() {
    const folderCount = state.reviewFolders.length;
    if (!folderCount) {
        setStatus("No admissions to clear.", "info");
        return;
    }
    
    if (!confirm("This will remove all stored admissions. This action cannot be undone. Continue?")) {
        return;
    }
    
    try {
        setStatus("Deleting all folders...", "loading");
        setProcessing(true, "predict");
        
        const response = await fetch("/output-folders", {
            method: "DELETE",
        });
        
        if (!response.ok) {
            const message = await response.text();
            throw new Error(message || `Failed to delete folders: ${response.status}`);
        }
        
        resetReviewWorkspace();
        await loadReviewFolders();
        setStatus("All admissions cleared.", "success");
    } catch (error) {
        setStatus(`Failed to delete all folders: ${error.message}`, "error");
    } finally {
        setProcessing(false, "predict");
    }
}

async function selectReviewFolder(folderName) {
    if (!folderName) {
        return;
    }
    
    try {
        setStatus(`Loading folder ${folderName}...`, "loading");
        setProcessing(true, "predict");
        
        const response = await fetch(`/output-folder/${encodeURIComponent(folderName)}`);
        if (!response.ok) {
            throw new Error(`Failed to load folder: ${response.status}`);
        }
        
        const data = await response.json();
        state.selectedReviewFolder = folderName;
        state.loadedReviewData = data;
        
        // Load note
        state.noteText = normalizeNote(data.note_text || "");
        state.originalNoteText = state.noteText;
        state.noteFileName = data.note_file || "";
        
        // Store original folder name (admission ID) for change tracking
        state.originalAdmissionId = folderName;
        if (elements.admissionIdInput) {
            elements.admissionIdInput.value = folderName;
        }
        
        // Convert codes to finalized codes format
        const codesList = Array.isArray(data.codes) ? data.codes : [];
        state.finalizedCodes = codesList.map((codeEntry) => {
            const codeType = (codeEntry.code_type || "icd").toLowerCase();
            const evidenceSpans = Array.isArray(codeEntry.evidence_spans) ? codeEntry.evidence_spans : [];
            const spans = evidenceSpans.map((span) => {
                if (typeof span === "object" && span !== null) {
                    return {
                        start: Number(span.start) || 0,
                        end: Number(span.end) || 0,
                        text: typeof span.text === "string" ? span.text : "",
                    };
                }
                return null;
            }).filter(Boolean);
            
            // Parse confidence from string if needed
            let probability = null;
            if (typeof codeEntry.confidence === "string" && codeEntry.confidence.trim()) {
                const parsed = parseFloat(codeEntry.confidence);
                if (!Number.isNaN(parsed)) {
                    probability = parsed;
                }
            } else if (typeof codeEntry.confidence === "number") {
                probability = codeEntry.confidence;
            }
            
            return {
                code: codeEntry.code || "",
                description: codeEntry.description || "",
                explanation: codeEntry.explanation || "",
                probability: probability,
                type: codeType,
                spans: spans,
                icdVersion: codeType === "icd" ? (codeEntry.icd_version || null) : null,
                editing: false,
            };
        });
        
        // Store original codes for change tracking (deep copy)
        state.originalReviewCodes = JSON.parse(JSON.stringify(state.finalizedCodes));
        
        // Clear AI suggested codes (not used in review mode)
        state.icdCodes = [];
        state.cptCodes = [];
        state.selectedIcdCodeIds.clear();
        state.selectedCptCodeIds.clear();
        state.expandedCodeIds.clear();
        
        // Render everything
        renderNote();
        renderFinalizedCodes();
        renderFolderList();
        displayNoteFilename();
        updatePageModeUI();
        updateSubmitCodesState();
        
        setStatus(`Loaded folder ${folderName} with ${state.finalizedCodes.length} code${state.finalizedCodes.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
        console.error("Failed to load folder:", error);
        setStatus(`Failed to load folder: ${error.message}`, "error");
        state.selectedReviewFolder = null;
        state.loadedReviewData = null;
    } finally {
        setProcessing(false, "predict");
    }
}

// Set up circular dependency: codeSearch needs addFinalizedCode
codeSearch.setAddFinalizedCode(addFinalizedCode);

function boot() {
    initEvents();
    updateModeUI();
    updatePageModeUI();
    updateNoteWithUI("");
    clearCodes();
    clearFinalizedCodes();
    fetchOptions();
}

document.addEventListener("DOMContentLoaded", boot);
