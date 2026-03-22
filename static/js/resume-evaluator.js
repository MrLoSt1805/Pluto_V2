// Resume Evaluator with Recruiter Handbook Support
document.addEventListener('DOMContentLoaded', function() {
    const evaluationForm = document.getElementById('evaluationForm');
    const feedbackForm = document.getElementById('feedbackForm');
    const resultDiv = document.getElementById('evaluation-result');
    const submitBtn = document.getElementById('submitBtn');
    let currentRating = 0;
    let currentHandbookContent = ''; // Store current handbook content for PDF generation
    let currentHandbookData = null; // Store handbook form data for auto-filling Match Maker
    let currentEvaluationData = null; // Store current evaluation data for PDF generation

    /** Enable Matchmaker download buttons once evaluation DB id exists */
    function enableEvaluationDownloadButtons() {
        ['downloadEvaluationWithResume', 'downloadResumeUploadedBtn'].forEach(function (btnId) {
            const el = document.getElementById(btnId);
            if (el) el.disabled = false;
        });
    }
    
    // Load JobID suggestions on page load
    loadJobIdSuggestions();
    
    // Check if we're viewing a stored evaluation or handbook
    checkForViewMode();
    
    // Note: Auto-fill is now handled by sidebar script in index2.html after tab switching

    // Star rating functionality
    const starRating = document.getElementById('star-rating');
    const stars = starRating.querySelectorAll('.star');
    const ratingInput = document.getElementById('rating');

    stars.forEach(star => {
        star.addEventListener('mouseover', function() {
            const value = parseInt(this.dataset.value);
            stars.forEach(s => {
                if (parseInt(s.dataset.value) <= value) {
                    s.classList.add('selected');
                } else {
                    s.classList.remove('selected');
                }
            });
        });
    });

    starRating.addEventListener('mouseout', function() {
        stars.forEach(star => {
            if (parseInt(star.dataset.value) <= currentRating) {
                star.classList.add('selected');
            } else {
                star.classList.remove('selected');
            }
        });
    });

    stars.forEach(star => {
        star.addEventListener('click', function() {
            currentRating = parseInt(this.dataset.value);
            ratingInput.value = currentRating;
            stars.forEach(s => {
                if (parseInt(s.dataset.value) <= currentRating) {
                    s.classList.add('selected');
                } else {
                    s.classList.remove('selected');
                }
            });
        });
    });

    // Evaluation form submission with streaming support
    evaluationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Evaluating...';

        const _dr = document.getElementById('downloadResumeUploadedBtn');
        const _dm = document.getElementById('downloadEvaluationWithResume');
        if (_dr) _dr.disabled = true;
        if (_dm) _dm.disabled = true;
        
        // Ensure result div is visible and form is ready
        resultDiv.style.display = 'none'; // Hide initially, will show when results arrive
        const evaluationFormCard = evaluationForm.closest('.card');
        if (evaluationFormCard) {
            evaluationFormCard.style.display = 'block'; // Keep form visible during evaluation
        }

        const formData = new FormData(evaluationForm);
        const resumeInput = document.getElementById('resume');
        const files = resumeInput?.files || [];
        
        // Debug: Log oorwin_job_id value
        const oorwinJobId = formData.get('oorwin_job_id') || document.getElementById('oorwin_job_id')?.value || '';
        console.log('Form submission - oorwin_job_id:', oorwinJobId);
        if (!oorwinJobId && formData.get('oorwin_job_id') === null) {
            // Ensure oorwin_job_id is included even if empty
            formData.append('oorwin_job_id', '');
        }

        try {
            // If multiple files, use batch endpoint
            if (files.length && files.length > 1) {
                const batchForm = new FormData();
                for (const f of files) batchForm.append('resumes', f);
                batchForm.append('job_title', formData.get('job_title'));
                batchForm.append('job_description', formData.get('job_description'));
                batchForm.append('oorwin_job_id', formData.get('oorwin_job_id'));

                const res = await fetch('/evaluate-batch', { method: 'POST', body: batchForm });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Batch evaluation failed');

                // Prefer markdown report if provided
                if (data.report_markdown) {
                    const wrapper = document.getElementById('batch-results');
                    const table = document.getElementById('batch-results-table');
                    // Hide table and show markdown
                    table.parentElement.innerHTML = DOMPurify.sanitize(marked.parse(data.report_markdown));
                    wrapper.style.display = 'block';
                    document.getElementById('evaluation-result').style.display = 'none';
                    submitBtn.disabled = false; submitBtn.innerHTML = 'Evaluate Resume';
                    return;
                }

                // Fallback: render simple table
                document.getElementById('evaluation-result').style.display = 'none';
                const wrapper = document.getElementById('batch-results');
                const tbody = document.querySelector('#batch-results-table tbody');
                tbody.innerHTML = '';
                data.results.forEach((r, idx) => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${idx + 1}</td>
                        <td>${r.filename}</td>
                        <td><strong>${r.match_percentage}%</strong></td>
                        <td>${(r.top_strengths || []).slice(0,3).join(', ') || '-'}</td>
                        <td>${(r.key_gaps || []).slice(0,3).join(', ') || '-'}</td>
                    `;
                    tbody.appendChild(tr);
                });
                wrapper.style.display = 'block';
                submitBtn.disabled = false; submitBtn.innerHTML = 'Evaluate Resume';
                return; // stop streaming flow
            }

            const response = await fetch('/evaluate-stream', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                // Check if it's an incomplete extraction error
                const errorData = await response.json().catch(() => ({}));
                if (errorData.error === 'incomplete_extraction') {
                    // Show popup for incomplete extraction
                    showIncompleteExtractionPopup(errorData.completeness, errorData.message);
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Evaluate Resume';
                    return;
                }
                throw new Error(errorData.message || 'Network response was not ok');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let dataStore = {}; // Store all data from streaming
            let hasReceivedBasicResults = false; // Track if we've received basic results

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log('Stream ended. Has received basic results:', hasReceivedBasicResults);
                    // If stream ended but we haven't received basic results, show an error
                    if (!hasReceivedBasicResults) {
                        console.error('Stream ended without receiving basic_results!');
                        alert('Evaluation completed but results were not received. Please try again.');
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Evaluate Resume';
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.trim() === '') continue; // Skip empty lines
                    if (line.startsWith('data: ')) {
                        try {
                            const eventData = JSON.parse(line.slice(6));
                            console.log('Received event:', eventData.status, eventData);
                            
                            if (eventData.status === 'basic_results') {
                                hasReceivedBasicResults = true;
                                // Store and display basic results
                                dataStore = { ...dataStore, ...eventData };
                                
                                // Store resume_path globally for merge download
                                // Use resume_path if available, otherwise fall back to filename
                                window.currentResumePath = eventData.resume_path || eventData.filename || null;
                                console.log("Received resume_path:", eventData.resume_path);
                                console.log("Received filename:", eventData.filename);
                                console.log("Stored window.currentResumePath:", window.currentResumePath);
                                
                                // NEW: Track whether merging is allowed based on original file extension (PDF only)
                                window.canMergeResume = (eventData.can_merge !== false);
                                window.resumeOriginalExt = eventData.original_file_ext || null;
                                console.log("Original resume extension:", window.resumeOriginalExt);
                                console.log("Can merge resume:", window.canMergeResume);
                                
                                // Update Download with Evaluation button appearance based on merge capability (PDF only)
                                const mergeBtn = document.getElementById('downloadEvaluationWithResume');
                                const mergeWarning = document.getElementById('downloadWithResumeWarning');
                                if (mergeBtn) {
                                    mergeBtn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Download with Evaluation';
                                    if (!window.canMergeResume) {
                                        // Make button slightly translucent and non-clickable looking
                                        mergeBtn.style.opacity = '0.6';
                                        mergeBtn.style.cursor = 'not-allowed';
                                        // Show professional inline warning below the button
                                        if (mergeWarning) {
                                            mergeWarning.textContent =
                                                'The uploaded resume is a DOCX, not a PDF. Download with Evaluation (merged PDF) only works when the resume is a PDF.';
                                            mergeWarning.classList.remove('d-none');
                                        }
                                    } else {
                                        // Restore normal appearance
                                        mergeBtn.style.opacity = '';
                                        mergeBtn.style.cursor = '';
                                        if (mergeWarning) {
                                            mergeWarning.classList.add('d-none');
                                            mergeWarning.textContent = '';
                                        }
                                    }
                                }
                                
                                // NEW: Store db_id immediately from basic_results (evaluation saved early)
                                if (eventData.db_id) {
                                    window.currentEvaluationId = eventData.db_id;
                                    console.log("✅ [EARLY] Set window.currentEvaluationId from basic_results:", window.currentEvaluationId);
                                    
                                    // Update hidden input immediately
                                    const evalIdInput = document.getElementById('evaluation-id');
                                    if (evalIdInput) {
                                        evalIdInput.value = window.currentEvaluationId;
                                        console.log("✅ [EARLY] Updated hidden input evaluation-id to:", window.currentEvaluationId);
                                    }
                                    
                                    if (currentEvaluationData) {
                                        currentEvaluationData.id = window.currentEvaluationId;
                                        console.log("✅ [EARLY] Updated currentEvaluationData.id to:", window.currentEvaluationId);
                                    }
                                    enableEvaluationDownloadButtons();
                                } else {
                                    console.warn("⚠️ [EARLY] basic_results did not include db_id");
                                }
                                
                                // Hide form and show results
                                console.log('Received basic_results, hiding form and showing results');
                                
                                // Hide the form card (the card containing the form)
                                const evaluationFormCard = evaluationForm.closest('.card');
                                if (evaluationFormCard) {
                                    evaluationFormCard.style.display = 'none';
                                    console.log('Form card hidden');
                                }
                                
                                // Also try to hide the parent container if it exists
                                const matchmakerContent = document.getElementById('matchmakerContent');
                                if (matchmakerContent) {
                                    const formRow = matchmakerContent.querySelector('.row.mb-4.justify-content-center');
                                    if (formRow) {
                                        formRow.style.display = 'none';
                                        console.log('Form row hidden');
                                    }
                                }
                                
                                // Ensure result div is visible - try multiple ways
                                let resultDivToShow = resultDiv;
                                if (!resultDivToShow) {
                                    console.warn('resultDiv not found initially, searching again...');
                                    resultDivToShow = document.getElementById('evaluation-result');
                                }
                                
                                if (resultDivToShow) {
                                    // Force show with multiple methods
                                    resultDivToShow.style.setProperty('display', 'block', 'important');
                                    resultDivToShow.style.setProperty('visibility', 'visible', 'important');
                                    resultDivToShow.classList.remove('d-none');
                                    resultDivToShow.removeAttribute('hidden');
                                    resultDivToShow.removeAttribute('style'); // Remove inline style that might have display:none
                                    resultDivToShow.style.display = 'block';
                                    resultDivToShow.style.visibility = 'visible';
                                    
                                    // Verify it's actually visible
                                    const computedStyle = window.getComputedStyle(resultDivToShow);
                                    console.log('Result div shown - display:', computedStyle.display, 'visibility:', computedStyle.visibility);
                                    
                                    if (computedStyle.display === 'none') {
                                        console.error('Result div still hidden after setting display!');
                                        // Last resort: create a new div or move content
                                        alert('Warning: Results may not be visible. Please scroll down to see results.');
                                    }
                                } else {
                                    console.error('resultDiv element not found!');
                                    alert('Error: Results container not found. Please refresh the page.');
                                    submitBtn.disabled = false;
                                    submitBtn.innerHTML = 'Evaluate Resume';
                                    return;
                                }
                                
                                // Call displayBasicResults after ensuring div is visible
                                displayBasicResults(dataStore);
                                
                            } else if (eventData.status === 'additional_data') {
                                // Store and display job stability and career progression
                                dataStore.job_stability = eventData.job_stability;
                                dataStore.career_progression = eventData.career_progression;
                                displayAdditionalData(dataStore);
                                
                            } else if (eventData.status === 'questions') {
                                // Store and display interview questions
                                dataStore.technical_questions = eventData.technical_questions;
                                dataStore.nontechnical_questions = eventData.nontechnical_questions;
                                dataStore.behavioral_questions = eventData.behavioral_questions;
                                displayQuestions(dataStore);
                                
                            } else if (eventData.status === 'complete') {
                                console.log('Evaluation complete!');
                                console.log('Complete event data:', eventData);
                                
                                // Update evaluation ID with database ID - this is the ONLY valid ID from now on
                                // Backend sends 'db_id' in the complete event
                                const dbId = eventData.db_id;
                                
                                if (dbId) {
                                    window.currentEvaluationId = dbId;
                                    console.log('✅ Set window.currentEvaluationId to:', window.currentEvaluationId);
                                    
                                    // Update hidden input and currentEvaluationData
                                    const evalIdInput = document.getElementById('evaluation-id');
                                    if (evalIdInput) {
                                        evalIdInput.value = window.currentEvaluationId;
                                        console.log('✅ Updated hidden input evaluation-id to:', window.currentEvaluationId);
                                    } else {
                                        console.error('❌ ERROR: evaluation-id input element not found!');
                                    }
                                    
                                    if (currentEvaluationData) {
                                        currentEvaluationData.id = window.currentEvaluationId;
                                        console.log('✅ Updated currentEvaluationData.id to:', window.currentEvaluationId);
                                    }
                                    
                                    console.log('✅ Final evaluation ID:', window.currentEvaluationId);
                                    
                                    // NOW make all API calls that need the DB ID (feedback check, etc.)
                                    console.log("✅ Using evaluation ID for feedback check:", window.currentEvaluationId);
                                    checkEvaluationFeedbackExists(window.currentEvaluationId);
                                    
                                    // Enable download buttons now that we have the DB ID
                                    enableEvaluationDownloadButtons();
                                } else {
                                    console.error('❌ ERROR: complete event did not include db_id!', eventData);
                                    console.error('Complete event keys:', Object.keys(eventData));
                                    alert('Warning: Evaluation completed but ID not received. Downloads may not work. Please check browser console (F12) for details.');
                                }
                                
                                // Do NOT use eval_id (UUID) anywhere after this point
                                
                            } else if (eventData.status === 'error') {
                                // Check if it's an incomplete extraction error
                                if (eventData.error === 'incomplete_extraction') {
                                    showIncompleteExtractionPopup(eventData.completeness, eventData.message);
                                    submitBtn.disabled = false;
                                    submitBtn.innerHTML = 'Evaluate Resume';
                                    return;
                                }
                                // Mark that we received an error (so we don't show "results not received")
                                hasReceivedBasicResults = true; // Prevent the "results not received" error
                                console.error('Received error status:', eventData.message);
                                alert('Evaluation Error: ' + (eventData.message || 'Unknown error occurred'));
                                submitBtn.disabled = false;
                                submitBtn.innerHTML = 'Evaluate Resume';
                                return;
                            } else if (eventData.status === 'processing' || eventData.status === 'step1' || eventData.status === 'step2' || eventData.status === 'step3' || eventData.status === 'step4') {
                                // These are progress updates, just log them
                                console.log('Progress update:', eventData.status, eventData.message);
                            }
                            // NOTE: 'complete' event is handled above (line 264), this duplicate handler is removed
                        } catch (parseError) {
                            console.error('Error parsing SSE data:', parseError);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in evaluation:', error);
            console.error('Error stack:', error.stack);
            // Check if error message contains incomplete extraction info
            if (error.message && error.message.includes('incomplete_extraction')) {
                try {
                    const errorData = JSON.parse(error.message);
                    if (errorData.error === 'incomplete_extraction') {
                        showIncompleteExtractionPopup(errorData.completeness, errorData.message);
                        return;
                    }
                } catch (e) {
                    // Not a JSON error, show regular alert
                }
            }
            // Show detailed error message
            const errorMsg = error.message || 'Unknown error occurred';
            console.error('Full error details:', {
                message: errorMsg,
                name: error.name,
                stack: error.stack
            });
            alert('Error: ' + errorMsg + '\n\nPlease check the browser console (F12) for more details.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Evaluate Resume';
        }
    });

    function displayBasicResults(data) {
        console.log('displayBasicResults called with data:', data);
        
        // Try to find resultDiv again in case it wasn't found initially
        let resultDivToUse = resultDiv;
        if (!resultDivToUse) {
            console.warn('resultDiv not found initially, trying to find it again...');
            resultDivToUse = document.getElementById('evaluation-result');
        }
        
        if (!resultDivToUse) {
            console.error('resultDiv not found! Cannot display results.');
            alert('Error: Results container not found. Please refresh the page.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Evaluate Resume';
            return;
        }
        
        // Force show the result div with multiple methods
        resultDivToUse.style.display = 'block';
        resultDivToUse.style.visibility = 'visible';
        resultDivToUse.classList.remove('d-none');
        resultDivToUse.removeAttribute('hidden');
        resultDivToUse.setAttribute('style', 'display: block !important; visibility: visible !important;');
        console.log('Result div display set to block, visibility set to visible');
        console.log('Result div computed style:', window.getComputedStyle(resultDivToUse).display);
        
        // Store evaluation data for PDF generation
        currentEvaluationData = data;
        // CRITICAL: Do NOT store UUID id from basic_results - wait for complete event to get DB ID
        // Remove any UUID id that might be in basic_results
        if (currentEvaluationData.id && typeof currentEvaluationData.id === 'string' && currentEvaluationData.id.includes('-')) {
            // This is a UUID, not a DB ID - remove it to prevent confusion
            delete currentEvaluationData.id;
        }
        // Ensure resume_path is also stored in currentEvaluationData if not already present
        if (!currentEvaluationData.resume_path && window.currentResumePath) {
            currentEvaluationData.resume_path = window.currentResumePath;
        }
        // Also ensure resume_path is set from filename if available
        if (!currentEvaluationData.resume_path && currentEvaluationData.filename) {
            currentEvaluationData.resume_path = currentEvaluationData.filename;
        }
        console.log("currentEvaluationData after displayBasicResults:", currentEvaluationData);
        
        // Scroll to results after a short delay to ensure DOM is updated
        setTimeout(() => {
            if (resultDivToUse) {
                try {
                    resultDivToUse.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    console.log('Scrolled to results');
                } catch (scrollError) {
                    console.warn('Scroll error:', scrollError);
                    // Fallback: just show the div
                    window.scrollTo(0, resultDivToUse.offsetTop);
                }
            }
        }, 200);

        // Match Score
        document.getElementById('progress-bar').style.width = data.match_percentage + '%';
        document.getElementById('progress-bar').textContent = data.match_percentage_str || data.match_percentage + '%';
        document.getElementById('match-score').textContent = data.match_percentage_str || data.match_percentage + '%';

        // Match Factors
        const factors = data.match_factors || {};
        updateMatchFactor('skills-match', factors['Skills Match'] || 0);
        updateMatchFactor('experience-match', factors['Experience Match'] || 0);
        updateMatchFactor('education-match', factors['Education Match'] || 0);
        updateMatchFactor('industry-match', factors['Industry Knowledge'] || 0);
        
        // Handle Certification Match - show N/A if null/not applicable
        const certMatch = factors['Certification Match'];
        if (certMatch === null || certMatch === undefined) {
            updateMatchFactorNA('certification-match');
        } else {
            updateMatchFactor('certification-match', certMatch);
        }

        // Profile Summary
        document.getElementById('profile-summary').textContent = data.profile_summary || 'No summary available';
        document.getElementById('missing-keywords').innerHTML = (data.missing_keywords && data.missing_keywords.length > 0)
            ? data.missing_keywords.map(kw => `<span class="badge bg-warning text-dark">${kw}</span>`).join('')
            : '<span class="text-success">No missing keywords</span>';
        
        // NEW: Candidate Fit Analysis
        renderCandidateFitAnalysis(data.candidate_fit_analysis);
        
        // Qualification Fit Assessment - Only show if over/underqualified
        const qualificationText = data.over_under_qualification || '';
        const qualificationCard = document.getElementById('qualification-fit-card');
        const qualificationDiv = document.getElementById('overqualification-analysis');
        
        // Check if content indicates over/underqualification (hide if "perfect fit", "right fit", "well-matched", etc.)
        const hasQualificationConcern = qualificationText && 
            !qualificationText.toLowerCase().includes('perfect fit') &&
            !qualificationText.toLowerCase().includes('right fit') &&
            !qualificationText.toLowerCase().includes('well-matched') &&
            !qualificationText.toLowerCase().includes('appropriately matched') &&
            !qualificationText.toLowerCase().includes('good fit') &&
            (qualificationText.toLowerCase().includes('overqualified') || 
             qualificationText.toLowerCase().includes('underqualified') ||
             qualificationText.toLowerCase().includes('too senior') ||
             qualificationText.toLowerCase().includes('too junior') ||
             qualificationText.toLowerCase().includes('flight risk') ||
             qualificationText.toLowerCase().includes('capability gap'));
        
        if (hasQualificationConcern) {
            qualificationDiv.textContent = qualificationText;
            qualificationCard.style.display = 'block';
        } else {
            qualificationCard.style.display = 'none';
        }

        // Set evaluation ID for feedback - but DO NOT call API yet (wait for 'complete' event)
        // Only set the hidden input value, don't make API calls here
        document.getElementById('evaluation-id').value = data.id;
        
        // DO NOT call checkEvaluationFeedbackExists here - it will be called in 'complete' event
        // This prevents using UUID before DB ID is available
    }

    function updateMatchFactor(id, value) {
        const element = document.getElementById(id);
        const scoreElement = document.getElementById(id + '-score');
        if (element && scoreElement) {
            element.style.width = value + '%';
            scoreElement.textContent = value + '%';
        }
    }
    
    function updateMatchFactorNA(id) {
        const element = document.getElementById(id);
        const scoreElement = document.getElementById(id + '-score');
        const container = element?.closest('.mb-2');
        const labelElement = container?.querySelector('.form-label');
        if (element && scoreElement) {
            element.style.width = '0%';
            element.style.backgroundColor = '#6c757d'; // Gray color for N/A
            element.style.opacity = '0.5'; // Make it visually distinct
            scoreElement.textContent = 'N/A';
            scoreElement.className = 'text-muted fst-italic';
            if (labelElement) {
                labelElement.innerHTML = 'Certification Match <small class="text-muted">(Not Applicable)</small>';
            }
        }
    }

    function displayAdditionalData(data) {
        // Job Stability
        if (data.job_stability) {
            const stability = data.job_stability;
            document.getElementById('stability-score-bar').style.width = stability.StabilityScore + '%';
            document.getElementById('stability-score').textContent = stability.StabilityScore;
            document.getElementById('risk-level').textContent = stability.RiskLevel;
            document.getElementById('risk-level').className = 'badge bg-' +
                (stability.RiskLevel === 'Low' ? 'success' : stability.RiskLevel === 'Medium' ? 'warning' : 'danger');
            document.getElementById('average-tenure').textContent = stability.AverageJobTenure;
            document.getElementById('job-count').textContent = stability.JobCount;
            document.getElementById('stability-explanation').textContent = stability.ReasoningExplanation;
        }

        // Red Flags - Only show card if red flags exist
        if (data.career_progression) {
            const progression = data.career_progression;
            const redFlagsDiv = document.getElementById('red-flags');
            const redFlagsCard = document.getElementById('red-flags-card');

            if (progression.red_flags && progression.red_flags.length > 0) {
                redFlagsDiv.innerHTML = progression.red_flags.map(flag => `<div>⚠️ ${flag}</div>`).join('');
                redFlagsCard.style.display = 'block';
            } else {
                redFlagsCard.style.display = 'none';
            }
        }
    }

    function displayQuestions(data) {
        // Quick Checks
        // Helper function to extract question text (handles both string and object formats)
        const extractQuestionText = (q) => {
            if (typeof q === 'string') {
                return q;
            } else if (typeof q === 'object' && q !== null) {
                // Try common property names
                return q.question || q.text || q.content || q.value || JSON.stringify(q);
            }
            return String(q);
        };
        
        const quickChecksList = document.getElementById('quick-checks-questions');
        quickChecksList.innerHTML = (data.behavioral_questions || []).map(q =>
            `<li class="list-group-item">${extractQuestionText(q)}</li>`
        ).join('');

        // Soft Skills
        const softSkillsList = document.getElementById('soft-skills-questions');
        softSkillsList.innerHTML = (data.nontechnical_questions || []).map(q =>
            `<li class="list-group-item">${extractQuestionText(q)}</li>`
        ).join('');

        // Technical Skills
        const techSkillsList = document.getElementById('technical-skills-questions');
        techSkillsList.innerHTML = (data.technical_questions || []).map(q =>
            `<li class="list-group-item">${extractQuestionText(q)}</li>`
        ).join('');
    }

    // Feedback form submission
    feedbackForm.addEventListener('submit', function(e) {
        e.preventDefault();
        if (currentRating === 0) {
            alert('Please select a rating before submitting feedback.');
            return;
        }

        const formData = new FormData(feedbackForm);
        const feedbackData = {
            evaluation_id: formData.get('evaluation_id'),
            rating: formData.get('rating'),
            comments: formData.get('comments')
        };

        fetch('/api/feedback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(feedbackData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('Error: ' + data.error);
            } else {
                // Hide the feedback form and show success message
                const feedbackCard = feedbackForm.closest('.card');
                if (feedbackCard) {
                    feedbackCard.querySelector('.card-body').innerHTML = `
                        <div class="alert alert-success">
                            <i class="bi bi-check-circle"></i> 
                            <strong>Thank you!</strong> Your feedback has been submitted successfully.
                        </div>
                    `;
                } else {
                    alert('Feedback submitted successfully!');
                }
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('An error occurred while submitting feedback.');
        });
    });

    // Standalone Recruiter Handbook Generation
    const handbookForm = document.getElementById('handbookGenerationForm');
    const generateHandbookBtn = document.getElementById('generateHandbookBtn');
    const downloadHandbookPDFBtn = document.getElementById('downloadHandbookPDF');
    const resetHandbookBtn = document.getElementById('resetHandbookForm');

    if (handbookForm) {
        handbookForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const jobTitle = document.getElementById('handbook_job_title').value;
            const jobDescription = document.getElementById('handbook_job_description').value;
            const additionalContext = document.getElementById('handbook_additional_context').value;

            if (!jobTitle.trim()) {
                alert('Please provide a job title.');
                return;
            }

            if (!jobDescription.trim()) {
                alert('Please provide a job description.');
                return;
            }

            // Show loading state
            document.getElementById('handbook-input-section').style.display = 'none';
            document.getElementById('handbook-loading').style.display = 'block';
            document.getElementById('handbook-result-section').style.display = 'none';
            document.getElementById('handbook-error').style.display = 'none';

            generateHandbookBtn.disabled = true;

            try {
                const jobId = document.getElementById('handbook_oorwin_job_id').value.trim();
                
                const response = await fetch('/api/generate-recruiter-handbook', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        job_title: jobTitle,
                        job_description: jobDescription,
                        additional_context: additionalContext,
                        oorwin_job_id: jobId
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    // Check if this is an existing handbook
                    if (data.existing) {
                        // Show modal popup for existing handbook notification
                        showExistingHandbookModal(data);
                    }
                    
                    // Store content for PDF generation
                    currentHandbookContent = data.markdown_content;
                    
                    // Store handbook data for auto-filling Match Maker
                    currentHandbookData = {
                        jobId: jobId || data.oorwin_job_id,
                        jobTitle: data.job_title || jobTitle,
                        jobDescription: jobDescription,
                        additionalContext: additionalContext
                    };

                    // Render markdown content
                    const htmlContent = marked.parse(data.markdown_content);
                    const cleanHTML = DOMPurify.sanitize(htmlContent);
                    
                    document.getElementById('handbook-content').innerHTML = cleanHTML;
                    // Post-process formatting for clearer hierarchy
                    enhanceHandbookFormatting();
                    
                    // Add copy buttons to Boolean search samples
                    addCopyButtonsToBooleanSamples();
                    
                    // Show result section
                    document.getElementById('handbook-loading').style.display = 'none';
                    document.getElementById('handbook-result-section').style.display = 'block';
                    
                    // Initialize feedback system for this handbook
                    if (data.handbook_id) {
                        initializeHandbookFeedback(data.handbook_id);
                    }
                    
                    // Scroll to results
                    document.getElementById('handbook-result-section').scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'start' 
                    });
                } else {
                    throw new Error(data.message || 'Failed to generate handbook');
                }
            } catch (error) {
                console.error('Error:', error);
                document.getElementById('handbook-loading').style.display = 'none';
                document.getElementById('handbook-error').style.display = 'block';
                document.getElementById('handbook-error-message').textContent = error.message;
                document.getElementById('handbook-input-section').style.display = 'block';
            } finally {
                generateHandbookBtn.disabled = false;
            }
        });
    }

    // Download original uploaded resume only (direct file from server)
    const downloadResumeUploadedBtn = document.getElementById('downloadResumeUploadedBtn');
    if (downloadResumeUploadedBtn) {
        downloadResumeUploadedBtn.addEventListener('click', function () {
            let evalIdToUse = window.currentEvaluationId;
            const evalIdInput = document.getElementById('evaluation-id');
            const evalIdFromInput = evalIdInput ? evalIdInput.value : null;
            if (!evalIdToUse) evalIdToUse = evalIdFromInput;
            if (evalIdToUse && typeof evalIdToUse === 'string' && evalIdToUse.includes('-')) {
                evalIdToUse = null;
            }
            if (!evalIdToUse && currentEvaluationData?.id) {
                const idValue = currentEvaluationData.id;
                if (typeof idValue === 'number' || (typeof idValue === 'string' && /^\d+$/.test(idValue) && !idValue.includes('-'))) {
                    evalIdToUse = idValue;
                }
            }
            if (!evalIdToUse) {
                alert('Evaluation ID not available yet. Please wait for the evaluation to finish saving, then try again.');
                return;
            }
            downloadResumeUploadedBtn.disabled = true;
            downloadResumeUploadedBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Downloading...';
            window.location.href = '/api/download-resume/' + encodeURIComponent(evalIdToUse);
            setTimeout(function () {
                downloadResumeUploadedBtn.disabled = false;
                downloadResumeUploadedBtn.innerHTML = '<i class="bi bi-file-earmark-arrow-down"></i> Download Resume';
            }, 2000);
        });
    }

    // Download concise evaluation PDF + resume (merged)
    const downloadEvaluationWithResumeBtn = document.getElementById('downloadEvaluationWithResume');
    if (downloadEvaluationWithResumeBtn) {
        downloadEvaluationWithResumeBtn.addEventListener('click', async function() {
            if (!currentEvaluationData) {
                alert('No evaluation data to download.');
                return;
            }
            downloadEvaluationWithResumeBtn.disabled = true;
            downloadEvaluationWithResumeBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating PDF...';

            try {
                // IMPORTANT: Use DB ID (integer), NOT UUID
                // ONLY use window.currentEvaluationId (set from 'complete' or basic_results with db_id)
                // NEVER use UUID from basic_results

                // If merging is not allowed (e.g., DOCX upload), show message and exit early
                if (window.canMergeResume === false) {
                    alert("Cannot merge: the uploaded resume is a DOCX, not a PDF. Download with Evaluation only works when the resume is a PDF.\n\nPlease upload a PDF resume for a merged PDF.");
                    downloadEvaluationWithResumeBtn.disabled = false;
                    downloadEvaluationWithResumeBtn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Download with Evaluation';
                    return;
                }

                console.log("🔍 [MERGE DEBUG] Checking for evaluation ID...");
                console.log("🔍 [MERGE DEBUG] window.currentEvaluationId:", window.currentEvaluationId);
                
                const evalIdInput = document.getElementById('evaluation-id');
                const evalIdFromInput = evalIdInput ? evalIdInput.value : null;
                console.log("🔍 [MERGE DEBUG] evalIdFromInput (hidden input):", evalIdFromInput);
                console.log("🔍 [MERGE DEBUG] currentEvaluationData?.id:", currentEvaluationData?.id);
                
                let evalIdToUse = window.currentEvaluationId || evalIdFromInput;
                
                // Validate that evalIdToUse is NOT a UUID (UUIDs contain hyphens)
                if (evalIdToUse && typeof evalIdToUse === 'string' && evalIdToUse.includes('-')) {
                    console.error("ERROR: evalIdToUse is a UUID, not a DB ID:", evalIdToUse);
                    evalIdToUse = null;
                }
                
                // Only use currentEvaluationData.id if it's a number (DB ID), not a UUID string
                if (!evalIdToUse && currentEvaluationData?.id) {
                    const idValue = currentEvaluationData.id;
                    // Check if it's a number (DB ID) or numeric string, NOT a UUID
                    if (typeof idValue === 'number' || (typeof idValue === 'string' && /^\d+$/.test(idValue) && !idValue.includes('-'))) {
                        evalIdToUse = idValue;
                    } else {
                        console.error("ERROR: currentEvaluationData.id is a UUID:", idValue);
                    }
                }
                
                if (!evalIdToUse) {
                    console.error("❌ [MERGE DEBUG] No valid evaluation ID found!");
                    console.error("❌ [MERGE DEBUG] window.currentEvaluationId:", window.currentEvaluationId);
                    console.error("❌ [MERGE DEBUG] evalIdFromInput:", evalIdFromInput);
                    console.error("❌ [MERGE DEBUG] currentEvaluationData:", currentEvaluationData);
                    alert("Error: Evaluation ID not available. Please wait for evaluation to complete and try again.\n\nIf this persists, refresh the page and run a new evaluation.\n\nCheck browser console (F12) for debug details.");
                    downloadEvaluationWithResumeBtn.disabled = false;
                    downloadEvaluationWithResumeBtn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Download with Evaluation';
                    return;
                }
                
                console.log("Using evaluation ID:", evalIdToUse);
                console.log("Type of evalIdToUse:", typeof evalIdToUse);
                console.log("window.currentEvaluationId:", window.currentEvaluationId);
                console.log("evalIdFromInput:", evalIdFromInput);
                
                // Validate evalIdToUse is not undefined, null, or empty
                if (!evalIdToUse || evalIdToUse === 'undefined' || evalIdToUse === 'null') {
                    console.error("ERROR: evalIdToUse is invalid:", evalIdToUse);
                    alert("Error: Evaluation ID not available. Please wait for evaluation to complete and try again.\n\nIf this persists, refresh the page and run a new evaluation.");
                    downloadEvaluationWithResumeBtn.disabled = false;
                    downloadEvaluationWithResumeBtn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Download with Evaluation';
                    return;
                }
                
                // Get resume_path from global variable (set during streaming)
                // Try multiple sources: global variable, currentEvaluationData, or filename
                const resumePathToSend = window.currentResumePath || 
                                        currentEvaluationData?.resume_path || 
                                        currentEvaluationData?.filename || 
                                        null;
                
                console.log("Sending resume_path:", resumePathToSend);
                console.log("Sending evaluation_id:", evalIdToUse);
                console.log("window.currentResumePath:", window.currentResumePath);
                console.log("currentEvaluationData:", currentEvaluationData);
                
                if (!resumePathToSend) {
                    alert("Resume path missing. Please refresh evaluation.\n\nDebug info: Check browser console (F12) for details.");
                    downloadEvaluationWithResumeBtn.disabled = false;
                    downloadEvaluationWithResumeBtn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Download with Evaluation';
                    return;
                }

                const response = await fetch('/api/download-evaluation-with-resume', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        evaluation_id: evalIdToUse,
                        evaluation_data: currentEvaluationData,
                        resume_path: resumePathToSend
                    })
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    const filename = currentEvaluationData.filename || 'Resume_With_Evaluation';
                    const filename_base = filename.replace(/\.[^/.]+$/, ""); // Remove extension
                    const timestamp = new Date().getTime();
                    a.download = `Resume_With_Evaluation_${filename_base}_${timestamp}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } else {
                    const data = await response.json();
                    throw new Error(data.message || 'Failed to generate merged PDF');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to download merged PDF: ' + error.message);
            } finally {
                downloadEvaluationWithResumeBtn.disabled = false;
                downloadEvaluationWithResumeBtn.innerHTML = '<i class="bi bi-file-earmark-pdf"></i> Download with Evaluation';
            }
        });
    }

    // Download PDF button
    if (downloadHandbookPDFBtn) {
        downloadHandbookPDFBtn.addEventListener('click', async function() {
            if (!currentHandbookContent) {
                alert('No handbook content to download.');
                return;
            }

            downloadHandbookPDFBtn.disabled = true;
            downloadHandbookPDFBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generating PDF...';

            try {
                const response = await fetch('/api/download-handbook-pdf', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        markdown_content: currentHandbookContent,
                        job_title: (currentHandbookData && currentHandbookData.jobTitle) ? currentHandbookData.jobTitle : '',
                        oorwin_job_id: (currentHandbookData && currentHandbookData.jobId) ? currentHandbookData.jobId : ''
                    })
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = `Recruiter_Handbook_${new Date().getTime()}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } else {
                    const data = await response.json();
                    throw new Error(data.message || 'Failed to generate PDF');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Failed to download PDF: ' + error.message);
            } finally {
                downloadHandbookPDFBtn.disabled = false;
                downloadHandbookPDFBtn.innerHTML = '<i class="bi bi-download"></i> Download PDF';
            }
        });
    }

    /**
     * Show the handbook *generation* form and hide loading/result/error.
     * Used by "Generate New" and when user clicks Recruiter Handbook in the sidebar
     * (so sidebar always opens the create flow, not the last viewed handbook).
     */
    function resetHandbookSectionToForm() {
        const inputEl = document.getElementById('handbook-input-section');
        const loadingEl = document.getElementById('handbook-loading');
        const resultEl = document.getElementById('handbook-result-section');
        const errorEl = document.getElementById('handbook-error');
        const contentEl = document.getElementById('handbook-content');
        if (inputEl) inputEl.style.display = 'block';
        if (loadingEl) loadingEl.style.display = 'none';
        if (resultEl) resultEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'none';
        if (contentEl) contentEl.innerHTML = '';
        currentHandbookContent = '';
        currentHandbookData = null;
        if (handbookForm) {
            handbookForm.reset();
        }
        // Leaving "view from history" mode — avoid confusion if URL still has view_handbook
        try {
            const u = new URL(window.location.href);
            if (u.searchParams.has('view_handbook')) {
                u.searchParams.delete('view_handbook');
                window.history.replaceState({}, '', u.toString());
            }
        } catch (e) { /* ignore */ }
    }

    window.resetHandbookSectionToForm = resetHandbookSectionToForm;

    // Reset button to generate new handbook
    if (resetHandbookBtn) {
        resetHandbookBtn.addEventListener('click', function() {
            resetHandbookSectionToForm();
        });
    }
    
    // Function to switch to Match Maker tab and auto-fill with handbook data
    // Check if we're in view mode (viewing stored evaluation or handbook)
    function checkForViewMode() {
        const urlParams = new URLSearchParams(window.location.search);
        const viewHandbook = urlParams.get('view_handbook');
        const viewEvaluation = urlParams.get('view_evaluation');
        
        console.log('Checking view mode:', { viewHandbook, viewEvaluation });
        
        if (viewHandbook) {
            const handbookData = sessionStorage.getItem('viewHandbookData');
            console.log('Handbook data from storage:', handbookData ? 'Found' : 'Not found');
            const stripHandbookQuery = () => {
                try {
                    const u = new URL(window.location.href);
                    u.searchParams.delete('view_handbook');
                    window.history.replaceState({}, '', u.toString());
                } catch (e) { /* ignore */ }
            };
            const showHandbook = (handbook) => {
                console.log('Displaying stored handbook');
                displayStoredHandbook(handbook);
                try { sessionStorage.removeItem('viewHandbookData'); } catch (e) { /* ignore */ }
                // Must defer: resume-evaluator's DOMContentLoaded runs before index2.html's listener.
                // Stripping ?view_handbook= synchronously made index2 think we were on a plain load,
                // so its 100ms timeout forced Matchmaker and hid the handbook from History.
                setTimeout(() => stripHandbookQuery(), 0);
            };
            if (handbookData) {
                try {
                    showHandbook(JSON.parse(handbookData));
                } catch (e) {
                    console.error('Failed to parse viewHandbookData', e);
                    fetch(`/api/handbook/${encodeURIComponent(viewHandbook)}`)
                        .then(r => r.json())
                        .then(data => {
                            if (data.success && data.handbook) {
                                showHandbook(data.handbook);
                            } else {
                                alert(data.message || 'Could not load handbook.');
                            }
                        })
                        .catch(err => alert('Could not load handbook: ' + err.message));
                }
            } else {
                // New tab / storage cleared — load by id from API
                fetch(`/api/handbook/${encodeURIComponent(viewHandbook)}`)
                    .then(r => r.json())
                    .then(data => {
                        if (data.success && data.handbook) {
                            showHandbook(data.handbook);
                        } else {
                            alert(data.message || 'Could not load handbook.');
                        }
                    })
                    .catch(err => alert('Could not load handbook: ' + err.message));
            }
        } else if (viewEvaluation) {
            const evaluationData = sessionStorage.getItem('viewEvaluationData');
            console.log('Evaluation data from storage:', evaluationData ? 'Found' : 'Not found');
            if (evaluationData) {
                const evaluation = JSON.parse(evaluationData);
                console.log('Displaying stored evaluation');
                displayStoredEvaluation(evaluation);
                sessionStorage.removeItem('viewEvaluationData'); // Clean up
            }
        } else {
            // Check for auto-fill parameters (from handbook navigation)
            const jobId = urlParams.get('job_id');
            const jobTitle = urlParams.get('job_title');
            const jobDescription = urlParams.get('job_description');
            const additionalContext = urlParams.get('additional_context');
            
            if (jobId || jobTitle || jobDescription) {
                // Auto-fill the form with query parameters
                setTimeout(() => {
                    const jobIdInput = document.getElementById('oorwin_job_id');
                    const jobTitleInput = document.getElementById('job_title');
                    const jobDescTextarea = document.getElementById('job_description');
                    const evalAdditionalContext = document.getElementById('evaluation_additional_context');
                    
                    if (jobIdInput && jobId) {
                        jobIdInput.value = jobId;
                    }
                    if (jobTitleInput && jobTitle) {
                        jobTitleInput.value = decodeURIComponent(jobTitle);
                    }
                    if (jobDescTextarea && jobDescription) {
                        jobDescTextarea.value = decodeURIComponent(jobDescription);
                    }
                    if (evalAdditionalContext && additionalContext) {
                        evalAdditionalContext.value = decodeURIComponent(additionalContext);
                    }
                    
                    // Switch to matchmaker section if on Pluto page
                    const matchmakerSidebarItem = document.querySelector('.hr-sidebar-item[data-section="matchmaker"]');
                    const matchmakerSection = document.getElementById('matchmaker-section');
                    const handbookSection = document.getElementById('handbook-section');
                    
                    if (matchmakerSidebarItem && matchmakerSection) {
                        // Remove active from all sidebar items
                        document.querySelectorAll('.hr-sidebar-item').forEach(item => {
                            item.classList.remove('active');
                        });
                        
                        // Add active to matchmaker
                        matchmakerSidebarItem.classList.add('active');
                        
                        // Show matchmaker section, hide handbook section if it exists
                        if (handbookSection) handbookSection.style.display = 'none';
                        matchmakerSection.style.display = 'block';
                    }
                    
                    // Scroll to form
                    const formElement = document.getElementById('evaluationForm');
                    if (formElement) {
                        formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 300);
            }
        }
    }
    
    // Display a stored handbook (from history)
    function displayStoredHandbook(handbook) {
        /** Show result view and render markdown as soon as the section is visible (no artificial delay). */
        function applyHandbookContent() {
            const inputEl = document.getElementById('handbook-input-section');
            const loadingEl = document.getElementById('handbook-loading');
            const errorEl = document.getElementById('handbook-error');
            const resultEl = document.getElementById('handbook-result-section');
            if (inputEl) inputEl.style.display = 'none';
            if (loadingEl) loadingEl.style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            if (resultEl) resultEl.style.display = 'block';

            const handbookContentDiv = document.getElementById('handbook-content');
            if (handbookContentDiv && handbook.markdown_content) {
                const rawHtml = marked.parse(handbook.markdown_content);
                handbookContentDiv.innerHTML = DOMPurify.sanitize(rawHtml);
                enhanceHandbookFormatting();
                addCopyButtonsToBooleanSamples();
            }

            currentHandbookContent = handbook.markdown_content;
            currentHandbookData = {
                jobId: handbook.oorwin_job_id || '',
                jobTitle: handbook.job_title || '',
                jobDescription: handbook.job_description || ''
            };

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Function to try switching to handbook with retries
        function switchToHandbook(retries = 0) {
            const handbookSidebarItem = document.querySelector('.hr-sidebar-item[data-section="handbook"]');
            console.log('Attempt', retries + 1, '- Handbook sidebar item:', handbookSidebarItem ? 'Found' : 'Not found');

            if (handbookSidebarItem) {
                document.querySelectorAll('.hr-sidebar-item').forEach(item => {
                    item.classList.remove('active');
                });
                handbookSidebarItem.classList.add('active');

                const handbookSection = document.getElementById('handbook-section');
                const matchmakerSection = document.getElementById('matchmaker-section');

                if (handbookSection) handbookSection.style.display = 'block';
                if (matchmakerSection) matchmakerSection.style.display = 'none';

                console.log('Switched to Handbook section');
                applyHandbookContent();
                return true;
            }
            if (retries < 5) {
                setTimeout(() => switchToHandbook(retries + 1), 100);
                return false;
            }
            return false;
        }

        switchToHandbook();
    }
    
    // Display a stored evaluation (from history)
    function displayStoredEvaluation(evaluation) {
        console.log('displayStoredEvaluation called');
        
        // Function to try switching to matchmaker with retries
        function switchToMatchMaker(retries = 0) {
            const matchmakerSidebarItem = document.querySelector('.hr-sidebar-item[data-section="matchmaker"]');
            console.log('Attempt', retries + 1, '- Matchmaker sidebar item:', matchmakerSidebarItem ? 'Found' : 'Not found');
            
            if (matchmakerSidebarItem) {
                // Remove active from all sidebar items
                document.querySelectorAll('.hr-sidebar-item').forEach(item => {
                    item.classList.remove('active');
                });
                
                // Add active to matchmaker
                matchmakerSidebarItem.classList.add('active');
                
                // Show matchmaker section, hide handbook section
                const handbookSection = document.getElementById('handbook-section');
                const matchmakerSection = document.getElementById('matchmaker-section');
                
                if (handbookSection) handbookSection.style.display = 'none';
                if (matchmakerSection) matchmakerSection.style.display = 'block';
                
                console.log('Switched to Match Maker section');
                return true;
            } else if (retries < 5) {
                // Retry after a short delay
                setTimeout(() => switchToMatchMaker(retries + 1), 100);
                return false;
            }
            return false;
        }
        
        // Try to switch to matchmaker
        switchToMatchMaker();
        
        // Wait for section to be visible before displaying content
        setTimeout(() => {
            console.log('Timeout complete, displaying content');
            // Hide form card, show results
            const evaluationForm = document.getElementById('evaluationForm');
            if (evaluationForm && evaluationForm.closest('.card')) {
                evaluationForm.closest('.card').parentElement.style.display = 'none';
            }
            document.getElementById('evaluation-result').style.display = 'block';
            
            // Display using the same functions as real-time evaluation
            console.log('Calling displayBasicResults');
            displayBasicResults(evaluation);
            
            console.log('Calling displayAdditionalData');
            displayAdditionalData(evaluation);
            
            // Display interview questions if available
            if (evaluation.technical_questions || evaluation.nontechnical_questions || evaluation.behavioral_questions) {
                console.log('Displaying questions');
                const quickChecksList = document.getElementById('quick-checks-questions');
                const softSkillsList = document.getElementById('soft-skills-questions');
                const skillChecksList = document.getElementById('technical-skills-questions');
                
                // Helper function to extract question text (handles both string and object formats)
                const extractQuestionText = (q) => {
                    if (typeof q === 'string') {
                        return q;
                    } else if (typeof q === 'object' && q !== null) {
                        // Try common property names
                        return q.question || q.text || q.content || q.value || JSON.stringify(q);
                    }
                    return String(q);
                };
                
                // Quick Checks = Behavioral Questions
                if (quickChecksList && evaluation.behavioral_questions && evaluation.behavioral_questions.length > 0) {
                    quickChecksList.innerHTML = evaluation.behavioral_questions.map(q => 
                        `<li class="list-group-item">${extractQuestionText(q)}</li>`
                    ).join('');
                } else if (quickChecksList) {
                    quickChecksList.innerHTML = '<li class="list-group-item text-muted">No behavioral questions available</li>';
                }
                
                // Soft Skills = Non-Technical Questions
                if (softSkillsList && evaluation.nontechnical_questions && evaluation.nontechnical_questions.length > 0) {
                    softSkillsList.innerHTML = evaluation.nontechnical_questions.map(q => 
                        `<li class="list-group-item">${extractQuestionText(q)}</li>`
                    ).join('');
                } else if (softSkillsList) {
                    softSkillsList.innerHTML = '<li class="list-group-item text-muted">No non-technical questions available</li>';
                }
                
                // Skill Checks = Technical Questions
                if (skillChecksList && evaluation.technical_questions && evaluation.technical_questions.length > 0) {
                    skillChecksList.innerHTML = evaluation.technical_questions.map(q => 
                        `<li class="list-group-item">${extractQuestionText(q)}</li>`
                    ).join('');
                } else if (skillChecksList) {
                    skillChecksList.innerHTML = '<li class="list-group-item text-muted">No technical questions available</li>';
                }
            }
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 300); // Wait for sidebar animation
    }
    
    function evaluateCandidatesFromHandbook() {
        if (!currentHandbookData) {
            alert('No handbook data available. Please generate a handbook first.');
            return;
        }
        
        // Try to switch to Match Maker section on the same page first
        const matchmakerSidebarItem = document.querySelector('.hr-sidebar-item[data-section="matchmaker"]');
        const handbookSection = document.getElementById('handbook-section');
        const matchmakerSection = document.getElementById('matchmaker-section');
        
        if (matchmakerSidebarItem && matchmakerSection && handbookSection) {
            // We're on the Pluto page with sections - switch sections
            // Remove active from all sidebar items
            document.querySelectorAll('.hr-sidebar-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active to matchmaker
            matchmakerSidebarItem.classList.add('active');
            
            // Show matchmaker section, hide handbook section
            handbookSection.style.display = 'none';
            matchmakerSection.style.display = 'block';
            
            // Auto-fill Match Maker form
            setTimeout(() => {
                const jobIdInput = document.getElementById('oorwin_job_id');
                const jobTitleInput = document.getElementById('job_title');
                const jobDescTextarea = document.getElementById('job_description');
                const evalAdditionalContext = document.getElementById('evaluation_additional_context');
                
                if (jobIdInput && currentHandbookData.jobId) {
                    jobIdInput.value = currentHandbookData.jobId;
                }
                if (jobTitleInput) {
                    jobTitleInput.value = currentHandbookData.jobTitle;
                }
                if (jobDescTextarea) {
                    jobDescTextarea.value = currentHandbookData.jobDescription;
                }
                if (evalAdditionalContext) {
                    evalAdditionalContext.value = currentHandbookData.additionalContext || '';
                }
                
                // Scroll to top of the page
                window.scrollTo({ top: 0, behavior: 'smooth' });
                
                // Show success notification
                const notification = document.createElement('div');
                notification.className = 'alert alert-info alert-dismissible fade show';
                notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
                notification.innerHTML = `
                    <strong>✓ Ready to Evaluate!</strong> 
                    Job details have been auto-filled. Upload candidate resume(s) to start evaluating.
                    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
                `;
                document.body.appendChild(notification);
                
                // Auto-remove notification after 5 seconds
                setTimeout(() => {
                    notification.classList.remove('show');
                    setTimeout(() => notification.remove(), 150);
                }, 5000);
            }, 100); // Small delay to ensure section is visible
        } else {
            // We're not on the Pluto page - navigate to resume evaluator with job data
            const params = new URLSearchParams();
            if (currentHandbookData.jobId) {
                params.append('job_id', currentHandbookData.jobId);
            }
            if (currentHandbookData.jobTitle) {
                params.append('job_title', currentHandbookData.jobTitle);
            }
            if (currentHandbookData.jobDescription) {
                params.append('job_description', currentHandbookData.jobDescription);
            }
            if (currentHandbookData.additionalContext) {
                params.append('additional_context', currentHandbookData.additionalContext);
            }
            
            // Navigate to resume evaluator page
            window.location.href = `/resume-evaluator?${params.toString()}`;
        }
    }
    
    // "Evaluate Candidates Now" button (top banner)
    const evaluateCandidatesBtn = document.getElementById('evaluateCandidatesFromHandbook');
    if (evaluateCandidatesBtn) {
        evaluateCandidatesBtn.addEventListener('click', function() {
            evaluateCandidatesFromHandbook();
        });
    }
    
    // "Start Evaluating" button (bottom footer)
    const evaluateCandidatesFooterBtn = document.getElementById('evaluateCandidatesFromHandbookFooter');
    if (evaluateCandidatesFooterBtn) {
        evaluateCandidatesFooterBtn.addEventListener('click', function() {
            evaluateCandidatesFromHandbook();
        });
    }
    
    // Auto-fill job description when JobID is entered in handbook form
    const handbookJobIdInput = document.getElementById('handbook_oorwin_job_id');
    if (handbookJobIdInput) {
        handbookJobIdInput.addEventListener('blur', async function() {
            const jobId = this.value.trim();
            if (jobId) {
                await autoFillJobDescription(jobId);
            }
        });
    }
    
    // Add event listener for handbook history tab
    // Event listeners for context-specific history tabs removed
    // Users should use the main /history page for viewing all handbooks and evaluations
    
});

// Helper functions
function getLevelColor(level) {
    const colors = {
        'Entry': 'secondary',
        'Mid': 'info',
        'Senior': 'primary',
        'Lead': 'success',
        'Manager': 'warning'
    };
    return colors[level] || 'secondary';
}

function getProgressionColor(progression) {
    const colors = {
        'Promotion': 'success',
        'Lateral': 'warning',
        'Step Back': 'danger'
    };
    return colors[progression] || 'secondary';
}

// Load JobID suggestions for auto-suggest
async function loadJobIdSuggestions() {
    try {
        const response = await fetch('/api/get-job-ids');
        const data = await response.json();
        
        if (data.success && data.job_ids) {
            // Populate datalist for Match Maker form
            const jobIdDatalist = document.getElementById('jobIdSuggestions');
            if (jobIdDatalist) {
                jobIdDatalist.innerHTML = data.job_ids.map(id => 
                    `<option value="${id}">`
                ).join('');
            }
            
            // Populate datalist for Handbook form
            const handbookJobIdDatalist = document.getElementById('handbookJobIdSuggestions');
            if (handbookJobIdDatalist) {
                handbookJobIdDatalist.innerHTML = data.job_ids.map(id => 
                    `<option value="${id}">`
                ).join('');
            }
        }
    } catch (error) {
        console.error('Error loading JobID suggestions:', error);
    }
}

// Auto-fill job description based on JobID
async function autoFillJobDescription(jobId) {
    try {
        const response = await fetch(`/api/get-job-data/${encodeURIComponent(jobId)}`);
        const data = await response.json();
        
        if (data.success) {
            const jobDescTextarea = document.getElementById('handbook_job_description');
            if (jobDescTextarea && !jobDescTextarea.value.trim()) {
                // Only auto-fill if the field is empty
                jobDescTextarea.value = data.job_description;
                
                // Show a small notification
                const notification = document.createElement('small');
                notification.className = 'text-success';
                notification.textContent = `✓ Auto-filled from ${data.source}`;
                jobDescTextarea.parentElement.appendChild(notification);
                
                setTimeout(() => notification.remove(), 3000);
            }
        }
    } catch (error) {
        console.error('Error auto-filling job description:', error);
    }
}

// Check URL parameter and auto-fill form if job_id is present
window.checkUrlParameterAndAutoFill = async function checkUrlParameterAndAutoFill() {
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get('job_id');
    
    if (!jobId) return; // No job_id parameter, skip
    
    console.log('Found job_id in URL:', jobId);
    
    try {
        const response = await fetch(`/api/get-job-data/${encodeURIComponent(jobId)}`);
        const data = await response.json();
        
        if (data.success) {
            console.log('API Response data:', data);
            
            // Auto-fill Match Maker form (not handbook form)
            const jobIdInput = document.getElementById('oorwin_job_id');
            const jobTitleInput = document.getElementById('job_title');
            const jobDescTextarea = document.getElementById('job_description');
            
            console.log('Form elements found:', {
                jobIdInput: !!jobIdInput,
                jobTitleInput: !!jobTitleInput,
                jobDescTextarea: !!jobDescTextarea
            });
            
            if (jobIdInput) {
                jobIdInput.value = jobId;
                console.log('Set JobID to:', jobId);
                // Trigger input event to ensure form recognizes the value
                jobIdInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                console.error('oorwin_job_id input field not found!');
            }
            if (jobTitleInput) {
                jobTitleInput.value = data.job_title || '';
                console.log('Set Job Title to:', data.job_title);
            }
            if (jobDescTextarea) {
                const jdValue = data.job_description || '';
                jobDescTextarea.value = jdValue;
                console.log('Set Job Description length:', jdValue.length);
                console.log('Job Description preview:', jdValue.substring(0, 100));
                
                // Verify it was set
                setTimeout(() => {
                    console.log('Verifying after 100ms - JD field value length:', jobDescTextarea.value.length);
                    if (jobDescTextarea.value.length === 0 && jdValue.length > 0) {
                        console.error('JD field was cleared! Attempting to set again...');
                        jobDescTextarea.value = jdValue;
                    }
                }, 100);
            }
            
            // Switch to Match Maker section (sidebar) - handled by sidebar script in index2.html
            // The sidebar auto-switches when job_id URL parameter is detected
            
            // Show success notification
            const notification = document.createElement('div');
            notification.className = 'alert alert-success alert-dismissible fade show';
            notification.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
            notification.innerHTML = `
                <strong>✓ Job Loaded!</strong> 
                JobID: <strong>${jobId}</strong> has been loaded. 
                You can now upload resume(s) to evaluate candidates.
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            `;
            document.body.appendChild(notification);
            
            // Auto-remove notification after 5 seconds
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 150);
            }, 5000);
            
            console.log('Auto-filled form with job data from:', data.source);
        } else {
            console.warn('Job data not found for JobID:', jobId);
            alert(`JobID "${jobId}" not found in database. Please check the JobID or create a new handbook first.`);
        }
    } catch (error) {
        console.error('Error loading job data from URL parameter:', error);
    }
}

// Enhance formatting of Screening Framework and similar blocks
function enhanceHandbookFormatting() {
    const container = document.getElementById('handbook-content');
    if (!container) return;

    // STEP 1: First, ensure all headings have IDs (before any DOM manipulation)
    let headings = Array.from(container.querySelectorAll('h1, h2, h3, h4')).filter(h => {
        const text = h.textContent.trim();
        return text && text.length > 0;
    });
    
    headings.forEach((h, idx) => {
        if (!h.id || h.id === '') {
            let id = (h.textContent || '').trim().toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            
            if (!id || id.length === 0) {
                id = `section-${idx + 1}`;
            }
            
            let finalId = id;
            let counter = 1;
            while (document.getElementById(finalId)) {
                finalId = `${id}-${counter}`;
                counter++;
            }
            
            h.id = finalId;
        }
    });

    // Ensure anchor targets exist for specific sections even when rendered as <strong> labels
    const ensureAnchorForLabel = (regex, fallbackId) => {
        // Try headings first
        let el = Array.from(container.querySelectorAll('h1,h2,h3,h4,strong,b'))
            .find(node => regex.test((node.textContent || '').trim()));
        if (el) {
            // If it's a <strong>/<b> inside a paragraph, prefer the parent block as anchor target
            if ((el.tagName === 'STRONG' || el.tagName === 'B') && el.parentElement) {
                el = el.parentElement;
            }
            if (!el.id) {
                el.id = fallbackId;
            }
            // Add scroll margin for fixed header offset
            el.style.scrollMarginTop = '120px';
        }
        return el ? el.id : null;
    };

    const screeningId = ensureAnchorForLabel(/^\s*2\.?\s*Screening\s+Framework/i, 'screening-framework');
    const poolsId = ensureAnchorForLabel(/^\s*3\.?\s*Target\s+Talent\s+Pools/i, 'target-talent-pools');

    // STEP 1b: If there are no H2/H3 headings, convert known section titles (exact matches) into H2s
    let hasRealHeadings = container.querySelector('h2, h3') !== null;
    if (!hasRealHeadings) {
        const sectionPatterns = [
            { regex: /^Introduction\s*:?\s*$/i, id: 'introduction' },
            { regex: /^\s*1\.?\s*Primary\s+Sourcing\s+Parameters\s*\(Must-Have\)\s*:?\s*$/i, id: 'primary-sourcing-parameters-must-have' },
            { regex: /^\s*2\.?\s*Screening\s+Framework\s*:?\s*$/i, id: 'screening-framework' },
            { regex: /^\s*3\.?\s*Target\s+Talent\s+Pools\s*:?\s*$/i, id: 'target-talent-pools' },
            { regex: /^\s*4\.?\s*Red\s+Flags\s+to\s+Watch\s*:?\s*$/i, id: 'red-flags-to-watch' },
            { regex: /^\s*5\.?\s*Recruiter\s+Sales\s+Pitch\s*\(to\s+candidates\)\s*:?\s*$/i, id: 'recruiter-sales-pitch' },
            { regex: /^\s*6\.?\s*Recruiter\s+Checklist\s*\(Pre-call\)\s*:?\s*$/i, id: 'recruiter-checklist' },
            { regex: /^\s*7\.?\s*Overqualification\/Overkill\s+Risk\s+Assessment\s*:?\s*$/i, id: 'overqualification-risk-assessment' },
            // Variants without leading numbers
            { regex: /^Primary\s+Sourcing\s+Parameters\s*\(Must-Have\)\s*:?\s*$/i, id: 'primary-sourcing-parameters-must-have' },
            { regex: /^Screening\s+Framework\s*:?\s*$/i, id: 'screening-framework' },
            { regex: /^Target\s+Talent\s+Pools\s*:?\s*$/i, id: 'target-talent-pools' },
            { regex: /^Red\s+Flags\s+to\s+Watch\s*:?\s*$/i, id: 'red-flags-to-watch' },
            { regex: /^Recruiter\s+Sales\s+Pitch\s*\(to\s+candidates\)\s*:?\s*$/i, id: 'recruiter-sales-pitch' },
            { regex: /^Recruiter\s+Checklist\s*\(Pre-call\)\s*:?\s*$/i, id: 'recruiter-checklist' },
            { regex: /^Overqualification\/Overkill\s+Risk\s+Assessment\s*:?\s*$/i, id: 'overqualification-risk-assessment' },
        ];

        const blocks = Array.from(container.querySelectorAll('p, strong, b, div'));
        blocks.forEach((el) => {
            const textRaw = (el.textContent || '').trim();
            if (!textRaw) return;

            const pattern = sectionPatterns.find(({ regex }) => regex.test(textRaw));
            if (!pattern) return;

            const heading = document.createElement('h2');
            const headingText = textRaw.replace(/\s*:$/,'').trim();
            heading.textContent = headingText;

            let baseId = pattern.id;
            if (!baseId) {
                baseId = headingText.toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-');
            }
            let finalId = baseId;
            let counter = 1;
            while (document.getElementById(finalId)) {
                finalId = `${baseId}-${counter}`;
                counter += 1;
            }
            heading.id = finalId;

            el.parentNode.insertBefore(heading, el);

            // Remove the original element if it only contained the heading label
            el.remove();
        });
    }

    // STEP 1c: After potential conversions, refresh heading list and apply classes/IDs
    let refreshedHeadings = Array.from(container.querySelectorAll('h1, h2, h3, h4')).filter(h => {
        const text = (h.textContent || '').trim();
        return text && text.length > 0;
    });

    refreshedHeadings.forEach((h, idx) => {
        if (!h.id || h.id === '') {
            let id = (h.textContent || '').trim().toLowerCase()
                .replace(/[^\w\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            if (!id || id.length === 0) {
                id = `section-${idx + 1}`;
            }
            let finalId = id;
            let counter = 1;
            while (document.getElementById(finalId)) {
                finalId = `${id}-${counter}`;
                counter += 1;
            }
            h.id = finalId;
        }
    });

    // STEP 1d: Add blue color class to the seven main section titles (exclude Introduction)
    const mainSectionTitles = [
        /^\s*\d+\.?\s*Primary\s+Sourcing\s+Parameters\s*\(Must-Have\)\s*:?\s*$/i,
        /^\s*\d+\.?\s*Screening\s+Framework\s*:?\s*$/i,
        /^\s*\d+\.?\s*Target\s+Talent\s+Pools\s*:?\s*$/i,
        /^\s*\d+\.?\s*Red\s+Flags\s+to\s+Watch\s*:?\s*$/i,
        /^\s*\d+\.?\s*Recruiter\s+Sales\s+Pitch\s*\(to\s+candidates\)\s*:?\s*$/i,
        /^\s*\d+\.?\s*Recruiter\s+Checklist\s*\(Pre-call\)\s*:?\s*$/i,
        /^\s*\d+\.?\s*Overqualification\/Overkill\s+Risk\s+Assessment\s*:?\s*$/i,
        /^Primary\s+Sourcing\s+Parameters\s*\(Must-Have\)\s*:?\s*$/i,
        /^Screening\s+Framework\s*:?\s*$/i,
        /^Target\s+Talent\s+Pools\s*:?\s*$/i,
        /^Red\s+Flags\s+to\s+Watch\s*:?\s*$/i,
        /^Recruiter\s+Sales\s+Pitch\s*\(to\s+candidates\)\s*:?\s*$/i,
        /^Recruiter\s+Checklist\s*\(Pre-call\)\s*:?\s*$/i,
        /^Overqualification\/Overkill\s+Risk\s+Assessment\s*:?\s*$/i,
    ];

    refreshedHeadings.forEach((h) => {
        const text = (h.textContent || '').trim();
        if (/^Introduction\b/i.test(text)) {
            h.classList.remove('main-section-title');
            return;
        }
        const isMainSection = mainSectionTitles.some(regex => regex.test(text));
        if (isMainSection) {
            h.classList.add('main-section-title');
        } else {
            h.classList.remove('main-section-title');
        }
    });

    // Replace the original headings list with the refreshed one for subsequent steps
    headings = refreshedHeadings;

    // STEP 1e: Clean up the first paragraph if it starts with "Introduction"
    const firstParagraph = container.querySelector('p');
    if (firstParagraph && !firstParagraph.previousElementSibling) {
        const originalHTML = firstParagraph.innerHTML;
        const cleanedHTML = originalHTML.replace(/^(\s*<(strong|b)>\s*)?Introduction\s*:?\s*(<\/(strong|b)>\s*)?/i, '').trim();
        if (cleanedHTML !== originalHTML.trim()) {
            firstParagraph.innerHTML = cleanedHTML;
        }
    }

    // STEP 2: Make A./B./C. category titles appear on their own line and slightly smaller
    const items = container.querySelectorAll('li');
    items.forEach(li => {
        const html = li.innerHTML.trim();
        // Pattern: A. Title - rest of text
        const match = html.match(/^([A-G])\.(\s*)([^\-–:]+?)(\s*[-–:])\s*(.*)$/);
        if (match) {
            const category = `${match[1]}. ${match[3].trim()}`;
            const rest = match[5];
            li.innerHTML = `<span class="sf-category">${category}</span><div class="sf-detail">${rest}</div>`;
        }
    });

    // STEP 3: Fix "Likely Companies" and "Likely Titles" - split comma-separated items into separate bullets
    const targetTalentSection = Array.from(container.querySelectorAll('h2, h3')).find(h => 
        /target talent pools/i.test(h.textContent)
    );
    
    if (targetTalentSection) {
        let current = targetTalentSection.nextElementSibling;
        let foundCompanies = false;
        let foundTitles = false;
        
        while (current && current.tagName !== 'H2' && current.tagName !== 'H3') {
            // Check if this is a paragraph or list containing "Likely Companies"
            if (current.tagName === 'P' && /likely companies/i.test(current.textContent)) {
                const text = current.textContent;
                const companiesMatch = text.match(/likely companies[:\s]+(.*)/i);
                if (companiesMatch && companiesMatch[1]) {
                    const companies = companiesMatch[1].split(',').map(c => c.trim()).filter(c => c);
                    if (companies.length > 0) {
                        const ul = document.createElement('ul');
                        companies.forEach(company => {
                            const li = document.createElement('li');
                            li.textContent = company;
                            ul.appendChild(li);
                        });
                        current.replaceWith(ul);
                        foundCompanies = true;
                    }
                }
            }
            
            // Check if this is a paragraph or list containing "Likely Titles"
            if (current.tagName === 'P' && /likely titles/i.test(current.textContent)) {
                const text = current.textContent;
                const titlesMatch = text.match(/likely titles[:\s]+(.*)/i);
                if (titlesMatch && titlesMatch[1]) {
                    const titles = titlesMatch[1].split(',').map(t => t.trim()).filter(t => t);
                    if (titles.length > 0) {
                        const ul = document.createElement('ul');
                        titles.forEach(title => {
                            const li = document.createElement('li');
                            li.textContent = title;
                            ul.appendChild(li);
                        });
                        current.replaceWith(ul);
                        foundTitles = true;
                    }
                }
            }
            
            // Check if it's a list item with comma-separated values
            if (current.tagName === 'LI') {
                const text = current.textContent.trim();
                if (/likely companies/i.test(text) && text.includes(',')) {
                    const parts = text.split(/likely companies[:\s]+/i);
                    if (parts.length > 1) {
                        const companies = parts[1].split(',').map(c => c.trim()).filter(c => c);
                        if (companies.length > 1) {
                            const parent = current.parentElement;
                            const index = Array.from(parent.children).indexOf(current);
                            current.textContent = 'Likely Companies:';
                            companies.forEach(company => {
                                const newLi = document.createElement('li');
                                newLi.textContent = company;
                                parent.insertBefore(newLi, parent.children[index + 1]);
                            });
                            foundCompanies = true;
                        }
                    }
                }
                if (/likely titles/i.test(text) && text.includes(',')) {
                    const parts = text.split(/likely titles[:\s]+/i);
                    if (parts.length > 1) {
                        const titles = parts[1].split(',').map(t => t.trim()).filter(t => t);
                        if (titles.length > 1) {
                            const parent = current.parentElement;
                            const index = Array.from(parent.children).indexOf(current);
                            current.textContent = 'Likely Titles:';
                            titles.forEach(title => {
                                const newLi = document.createElement('li');
                                newLi.textContent = title;
                                parent.insertBefore(newLi, parent.children[index + 1]);
                            });
                            foundTitles = true;
                        }
                    }
                }
            }
            
            current = current.nextElementSibling;
        }
    }

    // STEP 4: Ensure all headings have scroll-margin-top for proper scrolling
    headings.forEach(h => {
        if (!h.style.scrollMarginTop) {
            h.style.scrollMarginTop = '120px';
        }
    });

    // STEP 5: Remove any previously inserted TOC (requested to disable TOC)
    const existingToc = container.querySelector('.toc-nav');
    if (existingToc) existingToc.remove();

    // Link inline TOC items to the enforced anchors for two sections requested
    container.addEventListener('click', function(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const txt = (a.textContent || '').trim().toLowerCase();
        let targetId = null;
        if (txt.includes('screening framework')) targetId = 'screening-framework';
        if (txt.includes('target talent pools')) targetId = 'target-talent-pools';
        if (!targetId) return;
        const target = document.getElementById(targetId);
        if (target) {
            e.preventDefault();
            const y = target.getBoundingClientRect().top + window.pageYOffset - 120;
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            if (history.replaceState) history.replaceState(null, '', `#${targetId}`);
        }
    });

    // Remove duplicate "Introduction:" sections (keep only the first proper heading)
    // First, find the first proper "Introduction" heading
    const allNodes = Array.from(container.children);
    let firstIntroHeadingIndex = -1;
    
    allNodes.forEach((node, index) => {
        const text = (node.textContent || '').trim();
        const isProperIntroHeading = node.tagName && /^h[1-6]$/i.test(node.tagName) && /^Introduction\s*:?\s*$/i.test(text);
        if (isProperIntroHeading && firstIntroHeadingIndex === -1) {
            firstIntroHeadingIndex = index;
        }
    });
    
    // Collect nodes to remove (to avoid index issues during removal)
    const nodesToRemove = [];
    
    // Now find any paragraphs/strong/bold that start with "Introduction" and appear before the proper heading
    allNodes.forEach((node, index) => {
        if (firstIntroHeadingIndex === -1 || index >= firstIntroHeadingIndex) {
            return; // Skip if no proper heading found or we're at/after the proper heading
        }
        
        const text = (node.textContent || '').trim();
        
        // Check if this node starts with "Introduction" (various formats)
        const startsWithIntro = /^Introduction\s*:?\s*/i.test(text);
        
        // Check if it's a paragraph that starts with "Introduction" followed by text
        const isIntroParagraph = node.tagName === 'P' && startsWithIntro && text.length > 15;
        
        // Check if it's a standalone "Introduction" element
        const isStandaloneIntro = /^Introduction\s*:?\s*$/i.test(text) && 
                                   (node.tagName === 'P' || node.tagName === 'STRONG' || node.tagName === 'B');
        
        // Check if paragraph has "Introduction" in a strong/bold tag at the start
        const firstChild = node.querySelector && node.querySelector('strong:first-child, b:first-child');
        const hasIntroInBold = node.tagName === 'P' && firstChild && 
                               /^Introduction\s*:?\s*/i.test((firstChild.textContent || '').trim());
        
        if (isIntroParagraph || isStandaloneIntro || hasIntroInBold) {
            nodesToRemove.push(node);
        }
    });
    
    // Remove collected nodes
    nodesToRemove.forEach(node => node.remove());
    
    // Remove duplicate inline TOC blocks at the very top (pipe-separated or many anchors)
    const topNodes = Array.from(container.children).slice(0, 8);
    topNodes.forEach(node => {
        const text = (node.textContent || '').trim();
        const manyPipes = (text.match(/\|/g) || []).length >= 3; // e.g., "Intro | 1. JD Analysis | 2. ..."
        const manyLinks = (node.querySelectorAll && node.querySelectorAll('a').length) >= 5; // list of numbered links
        if (manyPipes || manyLinks) {
            node.remove();
        }
    });

    // Convert JD Snapshot bullets to summary tiles (first UL after a heading containing 'JD Snapshot')
    const snapshotHeading = Array.from(container.querySelectorAll('h2, h3')).find(h => /jd snapshot/i.test(h.textContent) || /quick summary/i.test(h.textContent) || /key role themes/i.test(h.textContent));
    if (snapshotHeading) {
        let ul = snapshotHeading.nextElementSibling;
        // Skip non-list siblings
        while (ul && ul.tagName && ul.tagName.toLowerCase() !== 'ul' && ul.tagName.toLowerCase() !== 'ol') { 
            ul = ul.nextElementSibling; 
        }
        if (ul && (ul.tagName.toLowerCase() === 'ul' || ul.tagName.toLowerCase() === 'ol')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'summary-tiles row g-3 mt-2 mb-4';
            const items = Array.from(ul.querySelectorAll(':scope > li'));
            items.forEach(li => {
                const col = document.createElement('div');
                col.className = 'col-md-6 col-lg-4';
                const card = document.createElement('div');
                card.className = 'card h-100 shadow-sm';
                card.style.border = '1px solid #e0e0e0';
                const body = document.createElement('div');
                body.className = 'card-body p-3';
                
                // Parse the list item text - split by colon
                const text = li.textContent.trim();
                const colonIndex = text.indexOf(':');
                if (colonIndex > 0) {
                    const label = text.substring(0, colonIndex).trim();
                    const value = text.substring(colonIndex + 1).trim();
                    body.innerHTML = `<div class="fw-semibold mb-2 text-primary">${label}</div><div class="text-muted small">${value}</div>`;
                } else {
                    body.innerHTML = `<div class="text-muted">${text}</div>`;
                }
                
                card.appendChild(body);
                col.appendChild(card);
                wrapper.appendChild(col);
            });
            ul.replaceWith(wrapper);
        }
    }
}

// Add copy buttons to Boolean search samples
function addCopyButtonsToBooleanSamples() {
    const handbookContent = document.getElementById('handbook-content');
    if (!handbookContent) return;
    
    // Find all code blocks that contain Boolean samples
    const codeElements = handbookContent.querySelectorAll('code');
    
    codeElements.forEach(code => {
        const text = code.textContent;
        
        // Check if it looks like a Boolean search (contains AND/OR and parentheses)
        if ((text.includes('AND') || text.includes('OR')) && text.includes('(') && text.length > 20 && text.length < 250) {
            // Wrap code in a container with copy button
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            wrapper.style.width = '100%';
            wrapper.style.marginBottom = '10px';
            
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-sm btn-outline-primary';
            copyBtn.style.marginLeft = '10px';
            copyBtn.innerHTML = '<i class="bi bi-clipboard"></i> Copy';
            copyBtn.onclick = function() {
                copyToClipboard(text, copyBtn);
            };
            
            // Insert wrapper before code element
            code.parentNode.insertBefore(wrapper, code);
            wrapper.appendChild(code);
            wrapper.appendChild(copyBtn);
        }
    });

    // Fallback: also detect boolean strings inside list items without backticks
    const listItems = handbookContent.querySelectorAll('li');
    listItems.forEach(li => {
        // If we already inserted a copy button here, skip
        if (li.querySelector('button.btn-outline-primary')) return;

        const text = li.textContent.trim();
        const match = text.match(/\[(.*?)\]/); // content inside []
        const candidate = match ? match[1] : text;
        if ((candidate.includes('AND') || candidate.includes('OR')) && candidate.includes('(') && candidate.length > 20 && candidate.length < 250) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'btn btn-sm btn-outline-primary ms-2';
            copyBtn.innerHTML = '<i class="bi bi-clipboard"></i> Copy';
            copyBtn.onclick = function() { copyToClipboard(candidate, copyBtn); };
            li.appendChild(copyBtn);
        }
    });
}

// Copy text to clipboard
function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        const originalHTML = button.innerHTML;
        button.innerHTML = '<i class="bi bi-check"></i> Copied!';
        button.classList.remove('btn-outline-primary');
        button.classList.add('btn-success');
        
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('btn-success');
            button.classList.add('btn-outline-primary');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
    });
}

// Render Candidate Fit Analysis tables and narrative
function renderCandidateFitAnalysis(fitAnalysis) {
    const fitAnalysisSection = document.getElementById('candidate-fit-analysis');
    
    if (!fitAnalysis || Object.keys(fitAnalysis).length === 0) {
        console.warn('No candidate fit analysis data provided - this is normal for older evaluations');
        // Hide the section for old evaluations that don't have this data
        if (fitAnalysisSection) {
            fitAnalysisSection.style.display = 'none';
        }
        return;
    }
    
    if (fitAnalysisSection) {
        fitAnalysisSection.style.display = 'block';
    }
    
    // Table 1: Dimension Evaluation
    const dimensionsBody = document.getElementById('fit-dimensions-body');
    if (fitAnalysis['Dimension Evaluation'] && fitAnalysis['Dimension Evaluation'].length > 0) {
        dimensionsBody.innerHTML = fitAnalysis['Dimension Evaluation'].map(dim => `
            <tr>
                <td><strong>${escapeHtml(dim.Dimension || '')}</strong></td>
                <td>${dim.Evaluation || ''}</td>
                <td>${escapeHtml(dim['Recruiter Comments'] || '')}</td>
            </tr>
        `).join('');
    } else {
        dimensionsBody.innerHTML = '<tr><td colspan="3" class="text-muted">No dimension evaluation available</td></tr>';
    }
    
    // Table 2: Risk & Gaps
    const risksBody = document.getElementById('fit-risks-body');
    const risksContainer = document.getElementById('fit-risks-container');
    if (fitAnalysis['Risk and Gaps'] && fitAnalysis['Risk and Gaps'].length > 0) {
        risksBody.innerHTML = fitAnalysis['Risk and Gaps'].map(risk => `
            <tr>
                <td><strong>${escapeHtml(risk.Area || '')}</strong></td>
                <td>${escapeHtml(risk.Risk || '')}</td>
                <td>${escapeHtml(risk['Recruiter Strategy'] || '')}</td>
            </tr>
        `).join('');
        risksContainer.style.display = 'block';
    } else {
        risksBody.innerHTML = '<tr><td colspan="3" class="text-success text-center"><strong>✓ No Major Risks Identified</strong></td></tr>';
        risksContainer.style.display = 'block';
    }
    
    // Table 3: Recruiter Recommendation
    const recommendationBody = document.getElementById('fit-recommendation-body');
    if (fitAnalysis['Recommendation']) {
        const rec = fitAnalysis['Recommendation'];
        recommendationBody.innerHTML = `
            <tr>
                <td><strong>${rec.Verdict || 'N/A'}</strong></td>
                <td class="text-center"><strong>${rec['Fit Level'] || 'N/A'}</strong></td>
                <td>${escapeHtml(rec.Rationale || 'No rationale provided')}</td>
            </tr>
        `;
    } else {
        recommendationBody.innerHTML = '<tr><td colspan="3" class="text-muted">No recommendation available</td></tr>';
    }
    
    // Recruiter Narrative
    const narrativeDiv = document.getElementById('recruiter-narrative');
    if (fitAnalysis['Recruiter Narrative']) {
        narrativeDiv.innerHTML = `<p class="mb-0"><em>${escapeHtml(fitAnalysis['Recruiter Narrative'])}</em></p>`;
    } else {
        narrativeDiv.innerHTML = '<p class="mb-0 text-muted">No recruiter narrative available</p>';
    }
}

// Helper function to escape HTML (prevent XSS)
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Context-Specific History Functions (DISABLED)
// These have been removed - use main /history page instead
// ============================================

/*
// Load Handbook History
function loadHandbookHistory() {
    console.log('loadHandbookHistory called');
    
    // FORCE the tab to show by manually adding Bootstrap classes
    const handbookHistoryPane = document.getElementById('handbook-history');
    const generateHandbookPane = document.getElementById('generate-handbook');
    
    if (handbookHistoryPane && generateHandbookPane) {
        // Remove active/show from generate handbook tab
        generateHandbookPane.classList.remove('show', 'active');
        // Add active/show to handbook history tab
        handbookHistoryPane.classList.add('show', 'active');
        console.log('Manually switched handbook tab panes');
    }
    
    const loadingDiv = document.getElementById('handbook-history-loading');
    const tableBody = document.getElementById('handbook-history-table-body');
    const noHandbooksMsg = document.getElementById('no-handbooks-message');
    
    if (!loadingDiv || !tableBody || !noHandbooksMsg) {
        console.error('Missing required handbook elements!');
        return;
    }
    
    loadingDiv.style.display = 'block';
    noHandbooksMsg.style.display = 'none';
    
    fetch('/api/handbooks-only')
        .then(response => response.json())
        .then(data => {
            loadingDiv.style.display = 'none';
            
            if (data.success && data.handbooks && data.handbooks.length > 0) {
                tableBody.innerHTML = '';
                data.handbooks.forEach(handbook => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td><strong>${escapeHtml(handbook.job_title)}</strong></td>
                        <td><span class="badge bg-secondary">${escapeHtml(handbook.oorwin_job_id || 'N/A')}</span></td>
                        <td>${new Date(handbook.timestamp).toLocaleString()}</td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick="viewHandbookFromHistory(${handbook.id})">
                                <i class="bi bi-eye"></i> View
                            </button>
                        </td>
                    `;
                    tableBody.appendChild(row);
                });
                
                // FORCE dimensions via JavaScript (Bootstrap tab pane has 0 width issue)
                setTimeout(() => {
                    const handbookHistoryPane = document.getElementById('handbook-history');
                    const card = handbookHistoryPane ? handbookHistoryPane.querySelector('.card') : null;
                    
                    // FIX: Force width on tab pane (critical - without this, everything has 0 width!)
                    if (handbookHistoryPane) {
                        handbookHistoryPane.style.width = '100%';
                        handbookHistoryPane.style.minWidth = '700px';
                        handbookHistoryPane.style.minHeight = '700px';
                    }
                    
                    if (tableBody) {
                        tableBody.style.height = 'auto';
                        tableBody.style.minHeight = '500px';
                        Array.from(tableBody.children).forEach(row => {
                            row.style.height = 'auto';
                            row.style.minHeight = '50px';
                            row.querySelectorAll('td').forEach(cell => {
                                cell.style.height = 'auto';
                                cell.style.minHeight = '50px';
                                cell.style.padding = '12px';
                                cell.style.fontSize = '14px';
                                cell.style.lineHeight = '1.5';
                            });
                        });
                    }
                    if (card) card.style.minHeight = '600px';
                    console.log('Handbook history dimensions forced');
                }, 50);
            } else {
                tableBody.innerHTML = '';
                noHandbooksMsg.style.display = 'block';
            }
        })
        .catch(error => {
            console.error('Error loading handbook history:', error);
            loadingDiv.style.display = 'none';
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Error loading history</td></tr>';
        });
}

// Load Evaluation History
function loadEvaluationHistory() {
    console.log('loadEvaluationHistory called');
    
    // FORCE the tab to show by manually adding Bootstrap classes
    const evaluationHistoryPane = document.getElementById('evaluation-history');
    const evaluateResumePane = document.getElementById('evaluate-resume');
    
    if (evaluationHistoryPane && evaluateResumePane) {
        // Remove active/show from evaluate resume tab
        evaluateResumePane.classList.remove('show', 'active');
        // Add active/show to evaluation history tab
        evaluationHistoryPane.classList.add('show', 'active');
        console.log('Manually switched evaluation tab panes');
    }
    
    const loadingDiv = document.getElementById('evaluation-history-loading');
    const tableBody = document.getElementById('evaluation-history-table-body');
    const noEvaluationsMsg = document.getElementById('no-evaluations-message');
    
    console.log('Elements found:', {
        loadingDiv: !!loadingDiv,
        tableBody: !!tableBody,
        noEvaluationsMsg: !!noEvaluationsMsg
    });
    
    if (!loadingDiv || !tableBody || !noEvaluationsMsg) {
        console.error('Missing required elements!');
        return;
    }
    
    loadingDiv.style.display = 'block';
    noEvaluationsMsg.style.display = 'none';
    
    console.log('Fetching evaluations from API...');
    fetch('/api/evaluations-only')
        .then(response => {
            console.log('API Response status:', response.status);
            return response.json();
        })
        .then(data => {
            console.log('API Data received:', data);
            loadingDiv.style.display = 'none';
            
            if (data.success && data.evaluations && data.evaluations.length > 0) {
                console.log(`Rendering ${data.evaluations.length} evaluations`);
                tableBody.innerHTML = '';
                data.evaluations.forEach(evaluation => {
                    const row = document.createElement('tr');
                    const matchClass = evaluation.match_percentage >= 75 ? 'success' : 
                                      evaluation.match_percentage >= 50 ? 'warning' : 'danger';
                    row.innerHTML = `
                        <td><strong>${escapeHtml(evaluation.filename)}</strong></td>
                        <td>${escapeHtml(evaluation.job_title)}</td>
                        <td><span class="badge bg-secondary">${escapeHtml(evaluation.oorwin_job_id)}</span></td>
                        <td><span class="badge bg-${matchClass}">${evaluation.match_percentage}%</span></td>
                        <td>${new Date(evaluation.timestamp).toLocaleString()}</td>
                    `;
                    tableBody.appendChild(row);
                });
                console.log('Table populated successfully');
                
                // FORCE dimensions via JavaScript (Bootstrap tab pane has 0 width issue)
                setTimeout(() => {
                    const historyPane = document.getElementById('evaluation-history');
                    const card = historyPane ? historyPane.querySelector('.card') : null;
                    
                    // FIX: Force width on tab pane (critical - without this, everything has 0 width!)
                    if (historyPane) {
                        historyPane.style.width = '100%';
                        historyPane.style.minWidth = '700px';
                        historyPane.style.minHeight = '700px';
                    }
                    
                    if (tableBody) {
                        tableBody.style.height = 'auto';
                        tableBody.style.minHeight = '500px';
                        Array.from(tableBody.children).forEach(row => {
                            row.style.height = 'auto';
                            row.style.minHeight = '50px';
                            row.querySelectorAll('td').forEach(cell => {
                                cell.style.height = 'auto';
                                cell.style.minHeight = '50px';
                                cell.style.padding = '12px';
                                cell.style.fontSize = '14px';
                                cell.style.lineHeight = '1.5';
                            });
                        });
                    }
                    if (card) card.style.minHeight = '600px';
                    console.log('Forced dimensions applied');
                }, 50);
            } else {
                console.log('No evaluations found or empty data');
                tableBody.innerHTML = '';
                noEvaluationsMsg.style.display = 'block';
            }
        })
        .catch(error => {
            console.error('Error loading evaluation history:', error);
            loadingDiv.style.display = 'none';
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger">Error loading history</td></tr>';
        });
}

// View Handbook from History (same logic as before, but switch to generate tab)
function viewHandbookFromHistory(handbookId) {
    // Fetch full handbook data
    fetch(`/api/handbook/${handbookId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.handbook) {
                const handbook = data.handbook;
                
                // Store and display handbook
                sessionStorage.setItem('viewHandbookData', JSON.stringify(handbook));
                window.location.href = `/resume-evaluator?view_handbook=${handbook.id}`;
            } else {
                alert('Handbook not found');
            }
        })
        .catch(error => {
            console.error('Error fetching handbook:', error);
            alert('Error loading handbook details');
        });
}

// View Evaluation from History (DISABLED - removed from UI)
/* function viewEvaluationFromHistory(evalId) {
    // Fetch full evaluation data
    fetch(`/api/evaluation-full/${evalId}`)
        .then(response => response.json())
        .then(data => {
            if (data.success && data.evaluation) {
                const evaluation = data.evaluation;
                
                // Switch to "Evaluate Resume" tab
                const evaluateTab = document.getElementById('evaluate-resume-tab');
                if (evaluateTab) {
                    evaluateTab.click();
                }
                
                // Store and display evaluation
                sessionStorage.setItem('viewEvaluationData', JSON.stringify(evaluation));
                window.location.href = `/resume-evaluator?view_evaluation=${evaluation.id}`;
            }
        })
        .catch(error => {
            console.error('Error fetching evaluation:', error);
            alert('Error loading evaluation details');
        });
}
*/

// ============================================
// Unified Feedback System Functions
// ============================================

// Store current handbook ID globally
let currentHandbookId = null;

// Check if feedback already exists for evaluation
async function checkEvaluationFeedbackExists(evaluationId) {
    // Use window.currentEvaluationId if available (DB ID), otherwise fall back to provided ID
    const idToUse = window.currentEvaluationId || evaluationId;
    console.log("Using evaluation ID for feedback check:", idToUse);
    try {
        const response = await fetch(`/api/feedback/check/evaluation/${idToUse}`);
        const data = await response.json();
        
        if (data.success && data.exists) {
            // Hide feedback form, show already submitted message
            const feedbackForm = document.getElementById('feedbackForm');
            const feedbackCard = feedbackForm?.closest('.card');
            
            if (feedbackCard) {
                feedbackCard.querySelector('.card-body').innerHTML = `
                    <div class="alert alert-success">
                        <i class="bi bi-check-circle"></i> 
                        <strong>Thank you!</strong> You've already submitted feedback for this evaluation.
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error checking evaluation feedback:', error);
    }
}

// Show popup for incomplete text extraction
function showIncompleteExtractionPopup(completeness, message) {
    // Create modal HTML
    const modalHTML = `
        <div class="modal fade" id="incompleteExtractionModal" tabindex="-1" aria-labelledby="incompleteExtractionModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title" id="incompleteExtractionModalLabel">
                            <i class="bi bi-exclamation-triangle"></i> Incomplete Text Extraction
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-warning">
                            <p><strong>Text extraction was incomplete.</strong></p>
                            <p>${message || 'Please upload a normal PDF or DOCX file for best compatibility.'}</p>
                        </div>
                        <p class="mb-0"><strong>Recommended:</strong></p>
                        <ul>
                            <li>Use a text-based PDF (not scanned)</li>
                            <li>Use DOCX format (modern Word document)</li>
                            <li>Avoid scanned images or complex layouts</li>
                        </ul>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="uploadNewFileBtn">
                            <i class="bi bi-upload"></i> Upload New File
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('incompleteExtractionModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Show modal
    const modalElement = document.getElementById('incompleteExtractionModal');
    if (modalElement && typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
        
        // Add click handler for Upload button
        const uploadBtn = document.getElementById('uploadNewFileBtn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', function() {
                // Close the modal first
                modal.hide();
                
                // Find the resume file input and trigger click
                const resumeInput = document.getElementById('resume');
                if (resumeInput) {
                    // Clear previous file selection
                    resumeInput.value = '';
                    // Trigger file picker
                    resumeInput.click();
                } else {
                    console.error('Resume file input not found');
                    alert('File input not found. Please refresh the page and try again.');
                }
            });
        }
        
        // Remove modal from DOM when hidden
        modalElement.addEventListener('hidden.bs.modal', function() {
            modalElement.remove();
        });
    } else if (modalElement && typeof $ !== 'undefined') {
        // Fallback to jQuery Bootstrap
        $(modalElement).modal('show');
        
        // Add click handler for Upload button
        $('#uploadNewFileBtn').on('click', function() {
            $(modalElement).modal('hide');
            const resumeInput = document.getElementById('resume');
            if (resumeInput) {
                resumeInput.value = '';
                resumeInput.click();
            }
        });
        
        $(modalElement).on('hidden.bs.modal', function() {
            $(modalElement).remove();
        });
    } else {
        // Last resort: Simple alert with option to upload
        if (confirm(`Incomplete Text Extraction\n\n${message || 'Please upload a normal PDF or DOCX file for best compatibility.'}\n\nClick OK to select a new file.`)) {
            const resumeInput = document.getElementById('resume');
            if (resumeInput) {
                resumeInput.value = '';
                resumeInput.click();
            }
        }
    }
}

// Check if feedback already exists for handbook
async function checkHandbookFeedbackExists(handbookId) {
    try {
        const response = await fetch(`/api/feedback/check/handbook/${handbookId}`);
        const data = await response.json();
        
        const alreadySubmitted = document.getElementById('handbook-feedback-already-submitted');
        const feedbackForm = document.getElementById('handbookFeedbackForm');
        
        if (data.success && data.exists) {
            // Show already submitted message, hide form
            alreadySubmitted.style.display = 'block';
            feedbackForm.style.display = 'none';
        } else {
            // Show form, hide already submitted message
            alreadySubmitted.style.display = 'none';
            feedbackForm.style.display = 'block';
        }
    } catch (error) {
        console.error('Error checking handbook feedback:', error);
        // On error, show the form anyway
        document.getElementById('handbookFeedbackForm').style.display = 'block';
    }
}

// Handle handbook star rating
function initializeHandbookFeedback(handbookId) {
    currentHandbookId = handbookId;
    document.getElementById('handbook-feedback-id').value = handbookId;
    
    // Check if feedback already submitted
    checkHandbookFeedbackExists(handbookId);
    
    // Handbook star rating
    const handbookStarRating = document.getElementById('handbook-star-rating');
    const handbookStars = handbookStarRating?.querySelectorAll('.star');
    const handbookRatingInput = document.getElementById('handbook-rating-value');
    let handbookCurrentRating = 0;
    
    if (handbookStars) {
        handbookStars.forEach(star => {
            star.addEventListener('mouseover', function() {
                const value = parseInt(this.dataset.value);
                handbookStars.forEach(s => {
                    if (parseInt(s.dataset.value) <= value) {
                        s.classList.add('selected');
                    } else {
                        s.classList.remove('selected');
                    }
                });
            });
            
            star.addEventListener('mouseout', function() {
                handbookStars.forEach(s => {
                    if (parseInt(s.dataset.value) <= handbookCurrentRating) {
                        s.classList.add('selected');
                    } else {
                        s.classList.remove('selected');
                    }
                });
            });
            
            star.addEventListener('click', function() {
                handbookCurrentRating = parseInt(this.dataset.value);
                handbookRatingInput.value = handbookCurrentRating;
                handbookStars.forEach(s => {
                    if (parseInt(s.dataset.value) <= handbookCurrentRating) {
                        s.classList.add('selected');
                    } else {
                        s.classList.remove('selected');
                    }
                });
            });
        });
    }
    
    // Handbook feedback form submission
    const handbookFeedbackForm = document.getElementById('handbookFeedbackForm');
    if (handbookFeedbackForm) {
        handbookFeedbackForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            const feedbackData = {
                handbook_id: parseInt(formData.get('handbook_id')),
                rating: parseInt(formData.get('rating')),
                comments: formData.get('comments')
            };
            
            if (!feedbackData.rating) {
                alert('Please select a rating before submitting');
                return;
            }
            
            try {
                const response = await fetch('/api/feedback/handbook', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(feedbackData)
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Show success message
                    const feedbackSection = document.getElementById('handbook-feedback-section');
                    feedbackSection.querySelector('.card-body').innerHTML = `
                        <div class="alert alert-success">
                            <i class="bi bi-check-circle"></i> 
                            <strong>Thank you!</strong> Your feedback has been submitted successfully.
                        </div>
                    `;
                } else {
                    alert(data.error || 'Failed to submit feedback');
                }
            } catch (error) {
                console.error('Error submitting handbook feedback:', error);
                alert('An error occurred while submitting feedback');
            }
        });
    }
}

// Export for global access
window.checkEvaluationFeedbackExists = checkEvaluationFeedbackExists;
window.initializeHandbookFeedback = initializeHandbookFeedback;

// View Evaluation from History (optional helper function)
function viewEvaluationFromHistory(evalId) {
    window.location.href = `/resume-evaluator?view_evaluation=${evalId}`;
}

function showExistingHandbookModal(data) {
    // Remove existing modal if present
    const existingModal = document.getElementById('existingHandbookModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create modal HTML
    const modalHTML = `
        <div class="modal fade" id="existingHandbookModal" tabindex="-1" aria-labelledby="existingHandbookModalLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-info text-white">
                        <h5 class="modal-title" id="existingHandbookModalLabel">
                            <i class="bi bi-info-circle-fill me-2"></i>Handbook Already Exists
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info mb-0">
                            <i class="bi bi-info-circle me-2"></i>
                            <strong>${data.message}</strong>
                        </div>
                        ${data.created_by ? `
                            <div class="mt-3">
                                <small class="text-muted">
                                    <i class="bi bi-person-circle me-1"></i>
                                    <strong>Created by:</strong> ${data.created_by}
                                    <br>
                                    <i class="bi bi-calendar3 me-1"></i>
                                    <strong>Created on:</strong> ${new Date(data.created_at).toLocaleString()}
                                </small>
                            </div>
                        ` : ''}
                        <p class="mt-3 mb-0">
                            The existing handbook is displayed below. You can view, download, or provide feedback on it.
                        </p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                            <i class="bi bi-check-circle me-1"></i>Okay, Got it
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Insert modal into body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Show modal using Bootstrap
    const modalElement = document.getElementById('existingHandbookModal');
    
    // Use Bootstrap Modal API
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
        const modal = new bootstrap.Modal(modalElement, {
            backdrop: true,
            keyboard: true
        });
        modal.show();
        
        // Clean up modal when hidden
        modalElement.addEventListener('hidden.bs.modal', function() {
            modalElement.remove();
        });
    } else {
        // Fallback: Use jQuery if Bootstrap JS not loaded but jQuery is available
        if (typeof $ !== 'undefined') {
            $(modalElement).modal('show');
            $(modalElement).on('hidden.bs.modal', function() {
                $(modalElement).remove();
            });
        } else {
            // Last resort: Simple alert
            alert(`Handbook Already Exists: ${data.message}\n\nThe existing handbook is displayed below.`);
        }
    }
}
