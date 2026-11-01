/**
 * Clever Clouds Client Verification Portal Controller
 * Powered by Didit KYC Protocol
 */

let activeSessionId = null;
let activeCandidate = null;
let pollTimer = null;

// Notification helper
function notify(text, isError = false) {
  const tray = document.getElementById('toastContainer');
  if (!tray) return;

  const item = document.createElement('div');
  item.className = 'portal-toast';
  item.style.borderColor = isError ? 'rgba(239, 68, 68, 0.5)' : 'rgba(99, 102, 241, 0.4)';
  item.innerHTML = `<span>${isError ? '⚠️' : '🛡️'}</span> <span>${text}</span>`;
  tray.appendChild(item);

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
function setStep(stepNumber) {
  const n1 = document.getElementById('stepNode1');
  const n2 = document.getElementById('stepNode2');
  const n3 = document.getElementById('stepNode3');
  const l1 = document.getElementById('stepLine1');
  const l2 = document.getElementById('stepLine2');

  n1.className = 'step-node';
  n2.className = 'step-node';
  n3.className = 'step-node';

  if (stepNumber === 1) {
    n1.classList.add('active');
  } else if (stepNumber === 2) {
    n1.classList.add('completed');
    n2.classList.add('active');
    l1.style.background = 'var(--accent-emerald)';
  } else if (stepNumber === 3) {
    n1.classList.add('completed');
    n2.classList.add('completed');
    n3.classList.add('active', 'completed');
    l1.style.background = 'var(--accent-emerald)';
    l2.style.background = 'var(--accent-emerald)';
  }
}

// Form Submission -> Start Verification
async function handleStartVerification(event) {
  event.preventDefault();
  clearError();

  const nameInput = document.getElementById('clientName');
  const emailInput = document.getElementById('clientEmail');
  const refInput = document.getElementById('clientRef');
  const consentCheck = document.getElementById('consentCheck');
  const startBtn = document.getElementById('startBtn');

  if (!consentCheck.checked) {
    notify('Please check the consent box to proceed.', true);
    return;
  }

  const fullName = nameInput.value.trim();
  const email = emailInput.value.trim();
  const clientRef = refInput.value.trim() || `cli_${Date.now()}`;

  activeCandidate = { name: fullName, email: email, ref: clientRef };

  startBtn.disabled = true;
  startBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
    <span>Generating Verification Session...</span>
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
      const msg = err.detail || err.error || `Server returned HTTP ${response.status}. Please check Didit API key.`;
      showError(`Unable to start verification: ${msg}`);
      notify('Session initiation failed.', true);
      startBtn.disabled = false;
      startBtn.innerHTML = `<span>Proceed to ID Verification</span> &rarr;`;
      return;
    }

    const data = await response.json();
    if (!data.url) {
      showError('Didit server did not return a valid verification URL.');
      notify('Invalid verification response.', true);
      startBtn.disabled = false;
      startBtn.innerHTML = `<span>Proceed to ID Verification</span> &rarr;`;
      return;
    }

    activeSessionId = data.session_id;

    // Transition to Step 2
    document.getElementById('formSection').style.display = 'none';
    document.getElementById('verificationSection').style.display = 'block';
    setStep(2);

    // Show iframe loader
    const loader = document.getElementById('iframeLoader');
    if (loader) loader.style.display = 'flex';

    // Set the live Didit verification URL into the iframe
    const iframe = document.getElementById('diditIframe');
    iframe.src = data.url;

    // Set external link
    const extLink = document.getElementById('externalLink');
    extLink.href = data.url;

    notify('Verification session started.', false);

    // Listen for completion messages
    window.addEventListener('message', onDiditMessage);

    // Start background status polling
    startPolling(data.session_id);

  } catch (err) {
    console.error('Connection Exception:', err);
    showError('Could not connect to /api/verify endpoint. Ensure the server or Vercel deployment is active.');
    notify('Network connection error.', true);
    startBtn.disabled = false;
    startBtn.innerHTML = `<span>Proceed to ID Verification</span> &rarr;`;
  }
}

// Background session status poller
function startPolling(sessionId) {
  if (pollTimer) clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/session/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status) {
          const title = document.getElementById('statusTitle');
          if (title) title.textContent = `Status: ${data.status}`;

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
      // Ignore polling errors
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

// Handle message from Didit iframe
function onDiditMessage(event) {
  if (event.origin && event.origin.includes('didit.me')) {
    console.log('[Didit Message Event]', event.data);
    if (event.data && (event.data.status === 'completed' || event.data.type === 'verification.complete')) {
      showCompletionScreen('Approved');
    }
  }
}

// Transition to Step 3: Completion Screen
function showCompletionScreen(finalStatus = 'Approved') {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  document.getElementById('verificationSection').style.display = 'none';
  document.getElementById('completionSection').style.display = 'block';
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
    statusSpan.className = 'row-val tag-approved';
    heading.textContent = 'Verification Complete!';
    msg.textContent = 'Your identity documents and 3D biometric liveness have been verified successfully.';
  } else if (finalStatus === 'In Review') {
    statusSpan.textContent = 'In Review';
    statusSpan.className = 'row-val';
    statusSpan.style.color = '#fbbf24';
    heading.textContent = 'Verification In Review';
    msg.textContent = 'Your submission has been safely received and is being processed by our compliance team.';
  } else {
    statusSpan.textContent = 'Declined';
    statusSpan.className = 'row-val';
    statusSpan.style.color = '#ef4444';
    heading.textContent = 'Verification Needs Attention';
    msg.textContent = 'The system was unable to verify your document. Please ensure your document is clearly legible and retry.';
    icon.style.borderColor = '#ef4444';
    icon.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  }
}
