/**
 * Clever Clouds Enterprise Identity Screening Controller
 * peopleHum Design Integration • Powered by Didit KYC
 */

let currentSessionId = null;
let currentCandidate = null;
let statusPoller = null;

// Toast Notifications
function showNotification(message, isError = false) {
  const container = document.getElementById('phToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'ph-toast';
  toast.style.borderColor = isError ? '#ef4444' : '#3b82f6';
  toast.innerHTML = `<span>${isError ? '⚠️' : '🛡️'}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function displayError(text) {
  const alert = document.getElementById('phAlert');
  if (alert) {
    alert.textContent = text;
    alert.style.display = 'block';
  }
}

function clearError() {
  const alert = document.getElementById('phAlert');
  if (alert) {
    alert.textContent = '';
    alert.style.display = 'none';
  }
}

// Stepper updater
function updateStepper(step) {
  const s1 = document.getElementById('phStep1');
  const s2 = document.getElementById('phStep2');
  const s3 = document.getElementById('phStep3');

  s1.className = 'ph-step';
  s2.className = 'ph-step';
  s3.className = 'ph-step';

  if (step === 1) {
    s1.classList.add('active');
  } else if (step === 2) {
    s1.classList.add('completed');
    s2.classList.add('active');
  } else if (step === 3) {
    s1.classList.add('completed');
    s2.classList.add('completed');
    s3.classList.add('active', 'completed');
  }
}

// Form Submission & Session Creation
async function handleCandidateSubmit(event) {
  event.preventDefault();
  clearError();

  const nameInput = document.getElementById('cName');
  const emailInput = document.getElementById('cEmail');
  const refInput = document.getElementById('cRef');
  const consentBox = document.getElementById('cConsent');
  const submitBtn = document.getElementById('phStartBtn');

  if (!consentBox.checked) {
    displayError('Please check the authorization box to consent to document and biometric verification.');
    showNotification('Consent authorization required.', true);
    return;
  }

  const candidateName = nameInput.value.trim();
  const candidateEmail = emailInput.value.trim();
  const candidateRef = refInput.value.trim() || `cand_${Date.now()}`;

  currentCandidate = {
    name: candidateName,
    email: candidateEmail,
    ref: candidateRef
  };

  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
    <span>Initializing Secure Session...</span>
  `;

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorData: candidateRef,
        email: candidateEmail,
        name: candidateName
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.detail || err.error || `Server returned HTTP ${res.status}.`;
      displayError(`Verification session could not be established: ${msg}`);
      showNotification('Session setup failed.', true);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Start Identity Verification</span> &rarr;`;
      return;
    }

    const data = await res.json();
    if (!data.url) {
      displayError('Didit verification service did not return an active session URL.');
      showNotification('Missing session URL.', true);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Start Identity Verification</span> &rarr;`;
      return;
    }

    currentSessionId = data.session_id;

    // Transition view to Didit window
    document.getElementById('phFormView').style.display = 'none';
    document.getElementById('phVerifyView').style.display = 'flex';
    updateStepper(2);

    // Show loader
    const loader = document.getElementById('phLoader');
    if (loader) loader.style.display = 'flex';

    // Inject iframe
    const iframe = document.getElementById('phDiditIframe');
    iframe.src = data.url;

    // External link
    const ext = document.getElementById('phExtLink');
    if (ext) ext.href = data.url;

    showNotification('Didit KYC Session loaded successfully.', false);

    // Listen for iframe messages
    window.addEventListener('message', onDiditMessage);

    // Start background status poller
    startPolling(data.session_id);

  } catch (err) {
    console.error('[API Connection Error]', err);
    displayError('Unable to connect to verification API. Please check your network connection.');
    showNotification('Network connection error.', true);
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Start Identity Verification</span> &rarr;`;
  }
}

// Background session polling
function startPolling(sessionId) {
  if (statusPoller) clearInterval(statusPoller);

  statusPoller = setInterval(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status) {
          const statusBadge = document.getElementById('phSessionStatus');
          if (statusBadge) statusBadge.textContent = `Status: ${data.status}`;

          if (data.status === 'Approved' || data.status === 'In Review') {
            clearInterval(statusPoller);
            showCompletionScreen(data.status);
          } else if (data.status === 'Declined') {
            clearInterval(statusPoller);
            showCompletionScreen('Declined');
          }
        }
      }
    } catch (_) {
      // Ignore background network fluctuations
    }
  }, 3500);
}

// Manual status refresh
async function checkStatusManually() {
  if (!currentSessionId) {
    showNotification('Checking status...', false);
    return;
  }
  try {
    const res = await fetch(`/api/session/${currentSessionId}`);
    if (res.ok) {
      const data = await res.json();
      showNotification(`Current status: ${data.status || 'In Progress'}`);
      if (data.status === 'Approved') {
        showCompletionScreen('Approved');
      }
    }
  } catch (_) {
    showNotification('Status check queued.', false);
  }
}

// Message handler from Didit iframe
function onDiditMessage(event) {
  if (event.origin && event.origin.includes('didit.me')) {
    console.log('[Didit Message Event]', event.data);
    if (event.data && (event.data.status === 'completed' || event.data.type === 'verification.complete')) {
      showCompletionScreen('Approved');
    }
  }
}

// Completion view
function showCompletionScreen(finalStatus = 'Approved') {
  if (statusPoller) {
    clearInterval(statusPoller);
    statusPoller = null;
  }

  document.getElementById('phVerifyView').style.display = 'none';
  document.getElementById('phCompletionView').style.display = 'block';
  updateStepper(3);

  const nameVal = document.getElementById('phCandidateName');
  const sessVal = document.getElementById('phSessionId');
  const statusVal = document.getElementById('phFinalStatus');
  const heading = document.getElementById('phHeading');
  const desc = document.getElementById('phDesc');

  if (currentCandidate) {
    nameVal.textContent = currentCandidate.name;
  }
  if (currentSessionId) {
    sessVal.textContent = currentSessionId;
  }

  if (finalStatus === 'Approved') {
    statusVal.textContent = 'Verified / Approved';
    statusVal.className = 'ph-status-pill';
    heading.textContent = 'Screening Completed';
    desc.textContent = 'Your identity documents and 3D biometric facial liveness have been verified successfully.';
  } else if (finalStatus === 'In Review') {
    statusVal.textContent = 'In Review';
    statusVal.className = 'ph-status-pill';
    statusVal.style.background = '#fef3c7';
    statusVal.style.color = '#d97706';
    statusVal.style.borderColor = '#fde68a';
    heading.textContent = 'Screening In Review';
    desc.textContent = 'Your submission has been safely received and is undergoing automated compliance checks.';
  } else {
    statusVal.textContent = 'Declined';
    statusVal.className = 'ph-status-pill';
    statusVal.style.background = '#fee2e2';
    statusVal.style.color = '#dc2626';
    statusVal.style.borderColor = '#fecaca';
    heading.textContent = 'Verification Needs Attention';
    desc.textContent = 'The system was unable to verify your document. Please ensure your document is clearly legible and retry.';
  }
}
