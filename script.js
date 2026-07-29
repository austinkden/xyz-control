// control/script.js - Firebase Auth & Firestore Control Panel Logic
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    onSnapshot, 
    query, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "https://astrong.xyz/firebase-config.js";

// Initialize Firebase App, Auth, Firestore
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// DOM Elements
const authStateContainer = document.getElementById('auth-state-container');
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const googleLoginBtn = document.getElementById('google-login-btn');
const loginErrorMsg = document.getElementById('login-error');

const metricTotalDevices = document.getElementById('metric-total-devices');
const metricActiveDevices = document.getElementById('metric-active-devices');
const metricCountries = document.getElementById('metric-countries');
const metricTotalVisits = document.getElementById('metric-total-visits');

const searchInput = document.getElementById('search-input');
const typeFilter = document.getElementById('type-filter');
const statusFilter = document.getElementById('status-filter');
const devicesTbody = document.getElementById('devices-tbody');
const refreshBtn = document.getElementById('refresh-btn');
const exportBtn = document.getElementById('export-btn');

const deviceModal = document.getElementById('device-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');

// State
let currentUser = null;
let rawDevices = [];
let unsubscribeDevices = null;
let activeSelectedDevice = null;

// 1. Firebase Authentication Observers & Handlers
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        // Authenticated State
        renderUserNav(user);
        loginSection.style.display = 'none';
        dashboardSection.style.display = 'block';
        loginErrorMsg.style.display = 'none';
        
        // Start Live Telemetry Firestore Listener
        initFirestoreListener();
    } else {
        // Unauthenticated State
        renderSignedOutNav();
        loginSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        
        if (unsubscribeDevices) {
            unsubscribeDevices();
            unsubscribeDevices = null;
        }
    }
});

googleLoginBtn.addEventListener('click', async () => {
    try {
        loginErrorMsg.style.display = 'none';
        googleLoginBtn.disabled = true;
        googleLoginBtn.style.opacity = '0.7';
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error('[Control] Google Auth Error:', error);
        loginErrorMsg.textContent = error.message || 'Authentication failed. Please try again.';
        loginErrorMsg.style.display = 'block';
    } finally {
        googleLoginBtn.disabled = false;
        googleLoginBtn.style.opacity = '1';
    }
});

function renderUserNav(user) {
    const avatarUrl = user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    authStateContainer.innerHTML = `
        <div class="user-profile-badge">
            <img src="${avatarUrl}" alt="${user.displayName || 'Admin'}" class="user-avatar" />
            <span class="user-email">${user.email || 'Admin User'}</span>
            <button id="signout-btn" class="signout-btn">Sign Out</button>
        </div>
    `;

    document.getElementById('signout-btn').addEventListener('click', () => {
        signOut(auth);
    });
}

function renderSignedOutNav() {
    authStateContainer.innerHTML = `
        <span style="font-size: 0.82rem; color: var(--text-muted);">Signed Out</span>
    `;
}

// 2. Real-time Telemetry Firestore Observer
function initFirestoreListener() {
    devicesTbody.innerHTML = `
        <tr>
            <td colspan="8" class="table-loading-cell">
                <div class="auth-loading-spinner"></div>
                <span>Listening to live device updates from Firestore...</span>
            </td>
        </tr>
    `;

    try {
        const devicesRef = collection(db, "devices");
        // Subscribe to live snapshot
        unsubscribeDevices = onSnapshot(devicesRef, (snapshot) => {
            rawDevices = [];
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                rawDevices.push(data);
            });

            // Sort by last active timestamp descending
            rawDevices.sort((a, b) => {
                const timeA = new Date(a.meta?.lastSeen || 0).getTime();
                const timeB = new Date(b.meta?.lastSeen || 0).getTime();
                return timeB - timeA;
            });

            updateMetrics(rawDevices);
            renderDevicesTable();
        }, (error) => {
            console.error('[Control] Firestore Snapshot Error:', error);
            devicesTbody.innerHTML = `
                <tr>
                    <td colspan="8" class="table-loading-cell" style="color: var(--error-red);">
                        Error loading Firestore records. Please check security rules or API permissions.
                    </td>
                </tr>
            `;
        });
    } catch (err) {
        console.error('[Control] Listener Init Error:', err);
    }
}

// 3. Update Metrics Summary Cards
function updateMetrics(devices) {
    metricTotalDevices.textContent = devices.length;

    const now = Date.now();
    const fifteenMinMs = 15 * 60 * 1000;
    
    let activeCount = 0;
    let countriesSet = new Set();
    let aggregatedVisits = 0;

    devices.forEach(dev => {
        const lastSeenMs = new Date(dev.meta?.lastSeen || 0).getTime();
        if (now - lastSeenMs <= fifteenMinMs) {
            activeCount++;
        }

        if (dev.network?.country && dev.network.country !== 'Unknown') {
            countriesSet.add(dev.network.country);
        }

        const visits = parseInt(dev.meta?.visitCount || 1, 10);
        aggregatedVisits += visits;
    });

    metricActiveDevices.textContent = activeCount;
    metricCountries.textContent = countriesSet.size;
    metricTotalVisits.textContent = aggregatedVisits;
}

// 4. Render Table with Filters
function renderDevicesTable() {
    const searchTerm = (searchInput.value || '').toLowerCase().trim();
    const selectedType = typeFilter.value;
    const selectedStatus = statusFilter.value;

    const now = Date.now();
    const fifteenMinMs = 15 * 60 * 1000;

    const filtered = rawDevices.filter(dev => {
        // Search Filter
        const ip = (dev.network?.ip || '').toLowerCase();
        const devId = (dev.deviceId || '').toLowerCase();
        const os = (dev.operatingSystem?.name || '').toLowerCase();
        const browser = (dev.browser?.name || '').toLowerCase();
        const city = (dev.network?.city || '').toLowerCase();
        const country = (dev.network?.country || '').toLowerCase();

        const matchesSearch = !searchTerm || 
            ip.includes(searchTerm) || 
            devId.includes(searchTerm) || 
            os.includes(searchTerm) || 
            browser.includes(searchTerm) || 
            city.includes(searchTerm) || 
            country.includes(searchTerm);

        // Type Filter
        const matchesType = selectedType === 'all' || (dev.deviceType || '').toLowerCase() === selectedType.toLowerCase();

        // Status Filter
        const lastSeenMs = new Date(dev.meta?.lastSeen || 0).getTime();
        const isOnline = (now - lastSeenMs <= fifteenMinMs);
        const isRecent = (now - lastSeenMs <= 24 * 60 * 60 * 1000);

        let matchesStatus = true;
        if (selectedStatus === 'online') matchesStatus = isOnline;
        else if (selectedStatus === 'recent') matchesStatus = isRecent;

        return matchesSearch && matchesType && matchesStatus;
    });

    if (filtered.length === 0) {
        devicesTbody.innerHTML = `
            <tr>
                <td colspan="8" class="table-loading-cell">
                    No devices match the current filters.
                </td>
            </tr>
        `;
        return;
    }

    let rowsHtml = '';
    filtered.forEach(dev => {
        const lastSeenMs = new Date(dev.meta?.lastSeen || 0).getTime();
        const isOnline = (now - lastSeenMs <= fifteenMinMs);
        const statusClass = isOnline ? 'online' : 'offline';
        const statusLabel = isOnline ? 'Online' : 'Offline';

        const locationStr = (dev.network?.city && dev.network?.city !== 'Unknown')
            ? `${dev.network.city}, ${dev.network.country || ''}`
            : (dev.network?.country || 'Unknown');

        const hwStr = `${dev.hardware?.cpuCores || '?'} Cores, ${dev.hardware?.deviceMemoryGB || '?'}GB RAM`;
        const resStr = `${dev.hardware?.screenWidth || '?'}x${dev.hardware?.screenHeight || '?'}`;

        rowsHtml += `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span class="status-dot ${statusClass}" title="${statusLabel}"></span>
                        <span style="font-size: 0.8rem; color: var(--text-secondary);">${statusLabel}</span>
                    </div>
                </td>
                <td>
                    <div style="font-weight: 600;">${dev.deviceType || 'Desktop'}</div>
                    <span class="sub-info mono-text">${dev.deviceId || '--'}</span>
                </td>
                <td>
                    <div class="mono-text" style="font-weight: 600;">${dev.network?.ip || 'Unknown'}</div>
                    <span class="sub-info">${locationStr}</span>
                </td>
                <td>
                    <div style="font-weight: 600;">${dev.operatingSystem?.name || 'OS'}</div>
                    <span class="sub-info">${dev.browser?.name || 'Browser'} ${dev.browser?.version || ''}</span>
                </td>
                <td>
                    <div>${resStr}</div>
                    <span class="sub-info">${hwStr}</span>
                </td>
                <td>
                    <div>${formatRelativeTime(dev.meta?.lastSeen)}</div>
                    <span class="sub-info">${formatDate(dev.meta?.lastSeen)}</span>
                </td>
                <td>
                    <span class="mono-text" style="font-weight: 600;">${dev.meta?.visitCount || 1}</span>
                </td>
                <td>
                    <button class="ctrl-btn view-btn" data-device-id="${dev.deviceId}">View Details</button>
                </td>
            </tr>
        `;
    });

    devicesTbody.innerHTML = rowsHtml;

    // Attach View Details Click Handlers
    devicesTbody.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const devId = e.currentTarget.getAttribute('data-device-id');
            const targetDev = rawDevices.find(d => d.deviceId === devId);
            if (targetDev) {
                openDeviceModal(targetDev);
            }
        });
    });
}

// 5. Helper Formatting Functions
function formatRelativeTime(isoStr) {
    if (!isoStr) return '--';
    const timestamp = new Date(isoStr).getTime();
    if (isNaN(timestamp)) return '--';

    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatDate(isoStr) {
    if (!isoStr) return '--';
    const date = new Date(isoStr);
    if (isNaN(date.getTime())) return '--';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 6. Device Detail Modal & Drawer Logic
function openDeviceModal(dev) {
    activeSelectedDevice = dev;
    
    document.getElementById('modal-device-id').textContent = dev.deviceId || 'Device Details';
    
    const now = Date.now();
    const lastSeenMs = new Date(dev.meta?.lastSeen || 0).getTime();
    const isOnline = (now - lastSeenMs <= 15 * 60 * 1000);
    
    const badge = document.getElementById('modal-status-badge');
    badge.textContent = isOnline ? 'Online' : 'Offline';
    badge.className = `modal-badge ${isOnline ? 'online' : ''}`;

    // Overview Tab
    document.getElementById('detail-device-id').textContent = dev.deviceId || '--';
    document.getElementById('detail-device-type').textContent = dev.deviceType || '--';
    document.getElementById('detail-first-seen').textContent = formatDate(dev.meta?.firstSeen);
    document.getElementById('detail-last-seen').textContent = formatDate(dev.meta?.lastSeen);
    document.getElementById('detail-os').textContent = `${dev.operatingSystem?.name || '--'} (${dev.operatingSystem?.platform || '--'})`;
    document.getElementById('detail-browser').textContent = `${dev.browser?.name || '--'} ${dev.browser?.version || ''}`;
    document.getElementById('detail-language').textContent = dev.browser?.language || '--';
    document.getElementById('detail-timezone').textContent = dev.locale?.timeZone || '--';

    // Hardware Tab
    document.getElementById('detail-screen').textContent = `${dev.hardware?.screenWidth} x ${dev.hardware?.screenHeight}`;
    document.getElementById('detail-avail-screen').textContent = `${dev.hardware?.screenAvailWidth} x ${dev.hardware?.screenAvailHeight}`;
    document.getElementById('detail-viewport').textContent = `${dev.hardware?.viewportWidth} x ${dev.hardware?.viewportHeight}`;
    document.getElementById('detail-dpr').textContent = `${dev.hardware?.pixelRatio}x`;
    document.getElementById('detail-cpu-cores').textContent = `${dev.hardware?.cpuCores} Cores`;
    document.getElementById('detail-ram').textContent = `${dev.hardware?.deviceMemoryGB} GB`;
    document.getElementById('detail-touch-points').textContent = dev.hardware?.maxTouchPoints;
    document.getElementById('detail-gpu').textContent = `${dev.hardware?.gpuVendor || 'Unknown'} / ${dev.hardware?.gpuRenderer || 'Unknown'}`;

    // Network Tab
    document.getElementById('detail-ip').textContent = dev.network?.ip || '--';
    document.getElementById('detail-location').textContent = `${dev.network?.city || ''}, ${dev.network?.region || ''}, ${dev.network?.country || ''}`;
    document.getElementById('detail-isp').textContent = dev.network?.isp || '--';
    document.getElementById('detail-connection-type').textContent = dev.network?.connectionType || '--';
    document.getElementById('detail-downlink').textContent = dev.network?.downlinkMbps ? `${dev.network.downlinkMbps} Mbps` : '--';
    document.getElementById('detail-rtt').textContent = dev.network?.rttMs ? `${dev.network.rttMs} ms` : '--';

    // Page History Tab
    const historyContainer = document.getElementById('history-container');
    const views = dev.recentViews || [];
    if (views.length === 0) {
        historyContainer.innerHTML = `<p class="empty-history-text">No page history logged.</p>`;
    } else {
        let historyHtml = '';
        views.slice().reverse().forEach(v => {
            historyHtml += `
                <div class="history-item">
                    <div>
                        <div class="history-url">${v.title || v.path || 'Page'}</div>
                        <span class="sub-info mono-text">${v.url || ''}</span>
                    </div>
                    <span class="history-time">${formatDate(v.timestamp)}</span>
                </div>
            `;
        });
        historyContainer.innerHTML = historyHtml;
    }

    // JSON Raw Viewer Tab
    document.getElementById('json-viewer').textContent = JSON.stringify(dev, null, 2);

    // Open Modal
    deviceModal.classList.add('active');
    deviceModal.setAttribute('aria-hidden', 'false');
}

function closeDeviceModal() {
    deviceModal.classList.remove('active');
    deviceModal.setAttribute('aria-hidden', 'true');
}

modalCloseBtn.addEventListener('click', closeDeviceModal);
deviceModal.querySelector('.ctrl-modal-overlay').addEventListener('click', closeDeviceModal);

// Modal Tab Switcher
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');
        
        document.querySelectorAll('.tab-btn').forEach(tb => tb.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));

        e.currentTarget.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
    });
});

// 7. Event Listeners for Filters & Controls
searchInput.addEventListener('input', renderDevicesTable);
typeFilter.addEventListener('change', renderDevicesTable);
statusFilter.addEventListener('change', renderDevicesTable);

refreshBtn.addEventListener('click', () => {
    renderDevicesTable();
    if (window.showToast) window.showToast('Device telemetry refreshed');
});

exportBtn.addEventListener('click', () => {
    if (rawDevices.length === 0) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(rawDevices, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `astrong-telemetry-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});
