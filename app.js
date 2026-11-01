/**
 * Clever Clouds Enterprise Verification Controller
 * Didit KYC Protocol Integration
 */

let activeSessionId = null;
let activeCandidate = null;
let pollTimer = null;

// Toast Notification
function notify(text, isError = false) {
  const stack = document.getElementById('toastContainer');
  if (!stack) return;

  const item = document.createElement('div');
  item.className = 'app-toast';
  item.style.borderColor = isError ? 'rgba(239, 68, 68, 0.5)' : 'rgba(99, 102, 241, 0.4)';
  item.innerHTML = `<span>${isError ? '⚠️' : '🛡️'}</span> <span>${text}</span>`;
  stack.appendChild(item);

  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateX(100%)';
    item.style.transition = 'all 0.3s ease';
    setTimeout(() => item.remove(), 300);
  }, 4000);
}

function showError(msg) {
  const alertBox = document.getElementById('errorAlert');
  if (alertBox) {
    alertBox.textContent = msg;
    alertBox.style.display = 'block';
  }
}

function clearError() {
  const alertBox = document.getElementById('errorAlert');
  if (alertBox) {
    alertBox.textContent = '';
    alertBox.style.display = 'none';
  }
}

// Stepper updater
function setStep(stepNum) {
  const s1 = document.getElementById('step1');
  const s2 = document.getElementById('step2');
  const s3 = document.getElementById('step3');
  const c1 = document.getElementById('conn1');
  const c2 = document.getElementById('conn2');

  s1.className = 'step-item';
  s2.className = 'step-item';
  s3.className = 'step-item';

  if (stepNum === 1) {
    s1.classList.add('active');
  } else if (stepNum === 2) {
    s1.classList.add('completed');
    s2.classList.add('active');
    c1.style.background = 'var(--accent-emerald)';
  } else if (stepNum === 3) {
    s1.classList.add('completed');
    s2.classList.add('completed');
    s3.classList.add('active', 'completed');
    c1.style.background = 'var(--accent-emerald)';
    c2.style.background = 'var(--accent-emerald)';
  }
}

// Start Verification Handler
async function handleStartVerification(event) {
  event.preventDefault();
  clearError();

  const nameInput = document.getElementById('clientName');
  const emailInput = document.getElementById('clientEmail');
  const refInput = document.getElementById('clientRef');
  const consentCheck = document.getElementById('consentCheck');
  const startBtn = document.getElementById('startBtn');

  if (!consentCheck.checked) {
    showError('Please check the consent box to proceed with the identity verification.');
    notify('Consent required.', true);
    return;
  }

  const fullName = nameInput.value.trim();
  const email = emailInput.value.trim();
  const clientRef = refInput.value.trim() || `cli_${Date.now()}`;

  activeCandidate = { name: fullName, email: email, ref: clientRef };

  startBtn.disabled = true;
  startBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 0.8s linear infinite;">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
    <span>Initializing Secure Session...</span>
  `;

  try {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendorData: clientRef,
        email: email,
        name: fullName
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.detail || err.error || `Server responded with HTTP ${response.status}.`;
      showError(`Unable to start verification: ${msg}`);
      notify('Session creation failed.', true);
      startBtn.disabled = false;
      startBtn.innerHTML = `<span>Start Identity Verification</span> &rarr;`;
      return;
    }

    const data = await response.json();
    if (!data.url) {
      showError('Didit verification service did not return an active session URL.');
      notify('Invalid session response.', true);
      startBtn.disabled = false;
      startBtn.innerHTML = `<span>Start Identity Verification</span> &rarr;`;
      return;
    }

    activeSessionId = data.session_id;

    // Transition view
    document.getElementById('viewForm').style.display = 'none';
    document.getElementById('viewVerification').style.display = 'block';
    setStep(2);

    // Show iframe loading spinner
    const loader = document.getElementById('iframeLoader');
    if (loader) loader.style.display = 'flex';

    // Inject verified Didit session URL
    const iframe = document.getElementById('diditIframe');
    iframe.src = data.url;

    // External link
    const ext = document.getElementById('externalLink');
    if (ext) ext.href = data.url;

    notify('Didit session active.', false);

    // Listen for iframe events
    window.addEventListener('message', onDiditMessage);

    // Start background status poller
    startPolling(data.session_id);

  } catch (err) {
    console.error('[Verification Network Error]', err);
    showError('Could not reach the verification API. Please check your network connection.');
    notify('Network error.', true);
    startBtn.disabled = false;
    startBtn.innerHTML = `<span>Start Identity Verification</span> &rarr;`;
  }
}

// Background session poller
function startPolling(sessionId) {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status) {
          const badge = document.getElementById('sessionStatusBadge');
          if (badge) badge.textContent = `Status: ${data.status}`;

          if (data.status === 'Approved' || data.status === 'In Review') {
            clearInterval(pollTimer);
            showCompletionScreen(data.status);
          } else if (data.status === 'Declined') {
            clearInterval(pollTimer);
            showCompletionScreen('Declined');
          }
        }
      }
    } catch (e) {
      // Ignore background network jitter
    }
  }, 3500);
}

// Manual refresh trigger
async function checkStatusManually() {
  if (!activeSessionId) {
    notify('Checking session...', false);
    return;
  }
  try {
    const res = await fetch(`/api/session/${activeSessionId}`);
    if (res.ok) {
      const data = await res.json();
      notify(`Current Status: ${data.status || 'In Progress'}`);
      if (data.status === 'Approved') {
        showCompletionScreen('Approved');
      }
    }
  } catch (e) {
    notify('Status check queued.', false);
  }
}

// Message handler from Didit
function onDiditMessage(event) {
  if (event.origin && event.origin.includes('didit.me')) {
    console.log('[Didit Message Event]', event.data);
    if (event.data && (event.data.status === 'completed' || event.data.type === 'verification.complete')) {
      showCompletionScreen('Approved');
    }
  }
}

// View 3: Completion
function showCompletionScreen(finalStatus = 'Approved') {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  document.getElementById('viewVerification').style.display = 'none';
  document.getElementById('viewCompletion').style.display = 'block';
  setStep(3);

  const nameSpan = document.getElementById('resClientName');
  const sessSpan = document.getElementById('resSessionId');
  const statusSpan = document.getElementById('resStatus');
  const heading = document.getElementById('resultHeading');
  const msg = document.getElementById('resultMessage');
  const icon = document.getElementById('resultIcon');

  if (activeCandidate) {
    nameSpan.textContent = activeCandidate.name;
  }
  if (activeSessionId) {
    sessSpan.textContent = activeSessionId;
  }

  if (finalStatus === 'Approved') {
    statusSpan.textContent = 'Approved';
    statusSpan.className = 'receipt-pill approved';
    heading.textContent = 'Verification Complete';
    msg.textContent = 'Your identity documents and 3D biometric liveness have been verified successfully.';
  } else if (finalStatus === 'In Review') {
    statusSpan.textContent = 'In Review';
    statusSpan.className = 'receipt-pill';
    statusSpan.style.color = '#fbbf24';
    heading.textContent = 'Verification In Review';
    msg.textContent = 'Your submission has been safely received and is being processed by our compliance team.';
  } else {
    statusSpan.textContent = 'Declined';
    statusSpan.className = 'receipt-pill';
    statusSpan.style.color = '#ef4444';
    heading.textContent = 'Verification Needs Attention';
    msg.textContent = 'The system was unable to verify your document. Please ensure your document is clearly legible and retry.';
    icon.style.borderColor = '#ef4444';
    icon.innerHTML = `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  }
}
