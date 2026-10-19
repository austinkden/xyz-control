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
    doc,
    setDoc,
    deleteDoc,
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
const loadingSection = document.getElementById('loading-section');
const googleLoginBtn = document.getElementById('google-login-btn');
const loginErrorMsg = document.getElementById('login-error');

const metricTotalDevices = document.getElementById('metric-total-devices');
const metricActiveDevices = document.getElementById('metric-active-devices');
const metricBannedDevices = document.getElementById('metric-banned-devices');
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
let selectedTypeFilter = 'all';
let selectedStatusFilter = 'default';
let currentSortKey = 'lastSeen';
let currentSortOrder = 'desc';
let flashingDeviceIds = new Set();

// Helper: LocalStorage state for Hidden Devices
function getHiddenDeviceIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem('astrong_ctrl_hidden_devices') || '[]'));
    } catch (e) {
        return new Set();
    }
}

function saveHiddenDeviceIds(set) {
    localStorage.setItem('astrong_ctrl_hidden_devices', JSON.stringify(Array.from(set)));
}

function toggleHideDevice(deviceId) {
    const hiddenSet = getHiddenDeviceIds();
    if (hiddenSet.has(deviceId)) {
        hiddenSet.delete(deviceId);
    } else {
        hiddenSet.add(deviceId);
    }
    saveHiddenDeviceIds(hiddenSet);
    renderDevicesTable();
}

// Helper: LocalStorage state for Custom Device Names
function getCustomNamesMap() {
    try {
        return JSON.parse(localStorage.getItem('astrong_ctrl_custom_names') || '{}');
    } catch (e) {
        return {};
    }
}

function saveCustomNameLocal(deviceId, name) {
    const map = getCustomNamesMap();
    if (name) {
        map[deviceId] = name;
    } else {
        delete map[deviceId];
    }
    localStorage.setItem('astrong_ctrl_custom_names', JSON.stringify(map));
}

async function updateDeviceCustomName(deviceId, name) {
    saveCustomNameLocal(deviceId, name);
    const targetDev = rawDevices.find(d => d.deviceId === deviceId);
    if (targetDev) {
        targetDev.customName = name;
    }
    try {
        const deviceRef = doc(db, "devices", deviceId);
        await setDoc(deviceRef, { customName: name }, { merge: true });
    } catch (err) {
        console.warn('[Control] Firestore customName save error:', err);
    }
    renderDevicesTable();
}

// Helper: Formats the device object so that recentViews is placed at the bottom of the JSON keys

// Helper: Calculate Performance Formula for a device (Network & Standard Compute)
function calculateDevicePerformance(dev) {
    if (!dev) return { compositeScore: 50, standardScore: 50, networkScore: 50, rating: 'Moderate', badgeClass: 'perf-moderate', details: {} };

    // Standard Compute Metrics
    const cores = Number(dev.hardware?.cores || dev.hardware?.hardwareConcurrency || 0);
    const ram = Number(dev.hardware?.deviceMemory || 0);
    const dpr = Number(dev.screen?.devicePixelRatio || dev.hardware?.dpr || 1);
    const renderer = (dev.hardware?.renderer || '').toLowerCase();

    let cpuScore = 70;
    if (cores > 0) {
        if (cores >= 16) cpuScore = 100;
        else if (cores >= 12) cpuScore = 95;
        else if (cores >= 8) cpuScore = 90;
        else if (cores >= 6) cpuScore = 78;
        else if (cores >= 4) cpuScore = 65;
        else if (cores >= 2) cpuScore = 45;
        else cpuScore = 30;
    }

    let ramScore = 72;
    if (ram > 0) {
        if (ram >= 16) ramScore = 100;
        else if (ram >= 8) ramScore = 88;
        else if (ram >= 4) ramScore = 68;
        else ramScore = 45;
    }

    let gpuScore = 75;
    if (renderer) {
        if (renderer.includes('apple') || renderer.includes('nvidia') || renderer.includes('radeon') || renderer.includes('adreno 7') || renderer.includes('mali-g7')) {
            gpuScore = 95;
        } else if (renderer.includes('intel') || renderer.includes('adreno 6') || renderer.includes('mali-g5')) {
            gpuScore = 80;
        } else if (renderer.includes('swiftshader') || renderer.includes('llvmpipe')) {
            gpuScore = 35;
        }
    }
    if (dpr > 2) gpuScore = Math.min(100, gpuScore + 5);

    const standardScore = Math.round(0.45 * cpuScore + 0.40 * ramScore + 0.15 * gpuScore);

    // Network Performance Metrics
    const downlink = Number(dev.network?.downlinkMbps || dev.network?.downlink || 0);
    const rtt = Number(dev.network?.rttMs || dev.network?.rtt || 0);
    const connType = (dev.network?.effectiveType || dev.network?.connectionType || '').toLowerCase();

    let dlScore = 75;
    if (downlink > 0) {
        if (downlink >= 25) dlScore = 100;
        else dlScore = Math.min(100, Math.round((downlink / 25) * 100));
    }

    let rttScore = 75;
    if (rtt > 0) {
        if (rtt <= 30) rttScore = 100;
        else if (rtt >= 300) rttScore = 25;
        else rttScore = Math.round(100 - ((rtt - 30) / 270) * 75);
    }

    let typeScore = 80;
    if (connType) {
        if (connType === '4g' || connType.includes('wifi') || connType.includes('ethernet')) typeScore = 100;
        else if (connType === '3g') typeScore = 65;
        else if (connType === '2g') typeScore = 35;
        else if (connType.includes('slow')) typeScore = 15;
    }

    const networkScore = Math.round(0.40 * dlScore + 0.40 * rttScore + 0.20 * typeScore);

    // Composite Performance Score
    const compositeScore = Math.round(0.55 * standardScore + 0.45 * networkScore);

    let rating = 'Moderate';
    let badgeClass = 'perf-moderate';
    if (compositeScore >= 85) {
        rating = 'Fast';
        badgeClass = 'perf-fast';
    } else if (compositeScore >= 68) {
        rating = 'Good';
        badgeClass = 'perf-good';
    } else if (compositeScore < 45) {
        rating = 'Low';
        badgeClass = 'perf-low';
    }

    return {
        compositeScore,
        standardScore,
        networkScore,
        rating,
        badgeClass,
        details: {
            cores: cores || 'Unknown',
            ram: ram ? `${ram} GB` : 'Unknown',
            downlink: downlink ? `${downlink} Mbps` : 'Unknown',
            rtt: rtt ? `${rtt} ms` : 'Unknown',
            connType: connType || 'Unknown'
        }
    };
}

function formatDeviceForJson(dev) {
    if (!dev) return dev;
    const ordered = {};
    Object.keys(dev).forEach(key => {
        if (key !== 'recentViews') {
            ordered[key] = dev[key];
        }
    });
    if ('recentViews' in dev) {
        ordered['recentViews'] = dev['recentViews'];
    }
    return ordered;
}

// Helper: Check if device is online (seen within last 15 minutes)
function isDeviceOnline(dev) {
    if (!dev || !dev.meta?.lastSeen) return false;
    const lastSeenMs = new Date(dev.meta.lastSeen).getTime();
    if (isNaN(lastSeenMs)) return false;
    return (Date.now() - lastSeenMs <= 15 * 60 * 1000);
}

// Helper: LocalStorage state for Muted Devices (Hides until new activity is logged)
function getMutedDevicesMap() {
    try {
        return JSON.parse(localStorage.getItem('astrong_ctrl_muted_devices') || '{}');
    } catch (e) {
        return {};
    }
}

function saveMutedDevicesMap(map) {
    localStorage.setItem('astrong_ctrl_muted_devices', JSON.stringify(map));
}

function isDeviceMuted(dev) {
    if (!dev || !dev.deviceId) return false;
    const mutedMap = getMutedDevicesMap();
    const mutedTimestamp = mutedMap[dev.deviceId];
    if (!mutedTimestamp) return false;

    const lastSeenMs = new Date(dev.meta?.lastSeen || 0).getTime();
    // If device is online OR has logged NEW activity since being muted, auto-unmute it!
    if (isDeviceOnline(dev) || lastSeenMs > mutedTimestamp) {
        delete mutedMap[dev.deviceId];
        saveMutedDevicesMap(mutedMap);
        return false;
    }
    return true;
}

function toggleMuteDevice(dev) {
    const mutedMap = getMutedDevicesMap();
    const devId = dev.deviceId;
    if (isDeviceOnline(dev) || isDeviceMuted(dev)) {
        delete mutedMap[devId];
    } else {
        const lastSeenMs = new Date(dev.meta?.lastSeen || Date.now()).getTime();
        mutedMap[devId] = lastSeenMs;
    }
    saveMutedDevicesMap(mutedMap);
    renderDevicesTable();
}

// Helper: Firestore Banning Logic
async function toggleBanDevice(deviceId, currentBanState) {
    try {
        const newBanState = !currentBanState;
        const deviceRef = doc(db, "devices", deviceId);
        await setDoc(deviceRef, { isBanned: newBanState, bannedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
        console.error('[Control] Ban device error:', err);
        alert('Failed to update ban state: ' + err.message);
    }
}

// Helper: Firestore Deletion Logic
async function deleteDeviceRecord(deviceId) {
    try {
        const deviceRef = doc(db, "devices", deviceId);
        await deleteDoc(deviceRef);

        const hiddenSet = getHiddenDeviceIds();
        if (hiddenSet.has(deviceId)) {
            hiddenSet.delete(deviceId);
            saveHiddenDeviceIds(hiddenSet);
        }
        const mutedMap = getMutedDevicesMap();
        if (mutedMap[deviceId]) {
            delete mutedMap[deviceId];
            saveMutedDevicesMap(mutedMap);
        }
    } catch (err) {
        console.error('[Control] Delete device error:', err);
        alert('Failed to delete device record: ' + err.message);
    }
}

// 1. Firebase Authentication Observers & Handlers

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        // Authenticated State - check permissions first
        renderUserNav(user);
        loginSection.style.display = 'none';
        loadingSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        loginErrorMsg.style.display = 'none';
        
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }

        initCustomDropdowns();
        initTableSorting();
        updateSortHeaderUI();
        initFirestoreListener();
            } else {
        // Unauthenticated State
        renderSignedOutNav();
        loginSection.style.display = 'block';
        dashboardSection.style.display = 'none';
        loadingSection.style.display = 'none';
        
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
        if (error.code === 'auth/unauthorized-domain') {
            loginErrorMsg.innerHTML = `<strong>Domain Not Authorized:</strong> <code>control.astrong.xyz</code> is not authorized for Google Auth.<br>Add <code>control.astrong.xyz</code> in <strong>Firebase Console &rarr; Authentication &rarr; Settings &rarr; Authorized domains</strong>.`;
        } else {
            loginErrorMsg.textContent = error.message || 'Authentication failed. Please try again.';
        }
        loginErrorMsg.style.display = 'block';
    } finally {
        googleLoginBtn.disabled = false;
        googleLoginBtn.style.opacity = '1';
    }
});

function renderUserNav(user) {
    const avatarUrl = user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
    const displayName = user.email || user.displayName || 'Admin User';
    authStateContainer.innerHTML = `
        <div class="user-profile-badge">
            <span class="user-email" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
            <img src="${avatarUrl}" alt="${escapeHtml(displayName)}" class="user-avatar" />
            <button id="signout-btn" class="signout-btn signout-icon-btn" aria-label="Sign Out" title="Sign Out">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-log-out">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
            </button>
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

// Custom Dropdowns Logic
function initCustomDropdowns() {
    const dropdowns = [
        { id: 'dropdown-type', btnId: 'btn-type-filter', menuId: 'menu-type-filter', onSelect: (val) => { selectedTypeFilter = val; renderDevicesTable(); } },
        { id: 'dropdown-status', btnId: 'btn-status-filter', menuId: 'menu-status-filter', onSelect: (val) => { selectedStatusFilter = val; renderDevicesTable(); } }
    ];

    dropdowns.forEach(dd => {
        const container = document.getElementById(dd.id);
        const btn = document.getElementById(dd.btnId);
        const menu = document.getElementById(dd.menuId);
        if (!container || !btn || !menu) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown').forEach(d => {
                if (d !== container) d.classList.remove('open');
            });
            container.classList.toggle('open');
        });

        menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                const label = opt.textContent;
                btn.querySelector('.dropdown-label').textContent = label;
                container.classList.remove('open');
                dd.onSelect(opt.getAttribute('data-value'));
            });
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
    });
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
        let isInitialSnapshot = true;

        // Subscribe to live snapshot
        unsubscribeDevices = onSnapshot(devicesRef, (snapshot) => {
            if (!isInitialSnapshot) {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'modified' || change.type === 'added') {
                        const devData = change.doc.data();
                        const devId = devData.deviceId || change.doc.id;
                        if (devId) {
                            flashingDeviceIds.add(devId);
                            setTimeout(() => {
                                flashingDeviceIds.delete(devId);
                                const row = devicesTbody.querySelector(`tr[data-device-id="${devId}"]`);
                                if (row) {
                                    const dot = row.querySelector('.status-dot');
                                    if (dot) dot.classList.remove('flash');
                                }
                            }, 800);
                        }
                    }
                });
            } else {
                isInitialSnapshot = false;
            }

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

            // Succeeded reading data! Now hide the loading screen and show the dashboard
            loadingSection.style.display = 'none';
            dashboardSection.style.display = 'block';
        }, (error) => {
            console.error('[Control] Firestore Snapshot Error:', error);
            devicesTbody.innerHTML = `
                <tr>
                    <td colspan="8" class="table-loading-cell" style="color: var(--error-red);">
                        Error loading Firestore records. Please check security rules or API permissions.
                    </td>
                </tr>
            `;
            loadingSection.style.display = 'none';

            if (currentUser) {
                // If the user doesn't have read permissions, we display error and sign out
                loginErrorMsg.textContent = 'Access Denied: You do not have permission to view the control panel.';
                loginErrorMsg.style.display = 'block';
                signOut(auth);
            }
        });

        // Auto-refresh metrics and table every 30s so relative times & online statuses stay up to date
        setInterval(() => {
            if (rawDevices.length > 0) {
                updateMetrics(rawDevices);
                renderDevicesTable();
            }
        }, 30000);
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
    let bannedCount = 0;
    let aggregatedVisits = 0;

    devices.forEach(dev => {
        if (isDeviceOnline(dev)) {
            activeCount++;
        }

        if (dev.isBanned) {
            bannedCount++;
        }

        const visits = parseInt(dev.meta?.visitCount || 1, 10);
        aggregatedVisits += visits;
    });

    metricActiveDevices.textContent = activeCount;
    if (metricBannedDevices) metricBannedDevices.textContent = bannedCount;
    metricTotalVisits.textContent = aggregatedVisits;
}

// Table Sorting Functions
function getSortValue(dev, sortKey) {
    const isOnline = isDeviceOnline(dev);
    const isBanned = !!dev.isBanned;
    const isHidden = getHiddenDeviceIds().has(dev.deviceId);
    const isMuted = isDeviceMuted(dev);
    const currentAdminDeviceId = localStorage.getItem('astrong_device_id');
    const isInControl = currentUser && dev.deviceId && (dev.deviceId === currentAdminDeviceId);

    switch (sortKey) {
        case 'status':
            if (isInControl) return 1;
            if (isOnline) return 2;
            if (isMuted) return 3;
            if (isBanned) return 4;
            if (isHidden) return 5;
            return 6;
        case 'performance':
            return calculateDevicePerformance(dev).compositeScore;
        case 'device':
            return (dev.deviceType || '').toLowerCase() + (dev.deviceId || '').toLowerCase();
        case 'location':
            return (dev.network?.ip || '').toLowerCase() + (dev.network?.country || '').toLowerCase();
        case 'os':
            return (dev.operatingSystem?.name || '').toLowerCase() + (dev.browser?.name || '').toLowerCase();
        case 'lastSeen':
            return new Date(dev.meta?.lastSeen || 0).getTime();
        case 'visits':
            return parseInt(dev.meta?.visitCount || 1, 10);
        default:
            return 0;
    }
}

function sortDevices(devices) {
    return devices.slice().sort((a, b) => {
        const valA = getSortValue(a, currentSortKey);
        const valB = getSortValue(b, currentSortKey);

        let comparison = 0;
        if (typeof valA === 'number' && typeof valB === 'number') {
            comparison = valA - valB;
        } else {
            comparison = String(valA).localeCompare(String(valB));
        }

        return currentSortOrder === 'asc' ? comparison : -comparison;
    });
}

function initTableSorting() {
    document.querySelectorAll('.devices-table th.sortable-th').forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort');
            if (currentSortKey === sortKey) {
                currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortKey = sortKey;
                currentSortOrder = (sortKey === 'lastSeen' || sortKey === 'visits') ? 'desc' : 'asc';
            }
            updateSortHeaderUI();
            renderDevicesTable();
        });
    });
}

function updateSortHeaderUI() {
    document.querySelectorAll('.devices-table th.sortable-th').forEach(th => {
        const sortKey = th.getAttribute('data-sort');
        const icon = th.querySelector('.sort-icon');

        if (sortKey === currentSortKey) {
            th.classList.add('active-sort');
            th.classList.remove('asc', 'desc');
            th.classList.add(currentSortOrder);
            if (icon) {
                icon.setAttribute('data-lucide', currentSortOrder === 'asc' ? 'arrow-up' : 'arrow-down');
            }
        } else {
            th.classList.remove('active-sort', 'asc', 'desc');
            if (icon) {
                icon.setAttribute('data-lucide', 'arrow-up-down');
            }
        }
    });

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

// 4. Render Table with Filters & Action Icons
function renderDevicesTable() {
    const searchTerm = (searchInput.value || '').toLowerCase().trim();
    const selectedType = selectedTypeFilter;
    const selectedStatus = selectedStatusFilter;

    const now = Date.now();
    const hiddenSet = getHiddenDeviceIds();
    const customNamesMap = getCustomNamesMap();

    const filtered = rawDevices.filter(dev => {
        const isHidden = hiddenSet.has(dev.deviceId);
        const isBanned = !!dev.isBanned;
        const isMuted = isDeviceMuted(dev);

        // Search Filter
        const ip = (dev.network?.ip || '').toLowerCase();
        const devId = (dev.deviceId || '').toLowerCase();
        const customName = (dev.customName || customNamesMap[dev.deviceId] || '').toLowerCase();
        const os = (dev.operatingSystem?.name || '').toLowerCase();
        const browser = (dev.browser?.name || '').toLowerCase();
        const city = (dev.network?.city || '').toLowerCase();
        const country = (dev.network?.country || '').toLowerCase();
        const lastPath = (dev.meta?.lastPath || '').toLowerCase();
        const lastSubdomain = (dev.meta?.lastSubdomain || '').toLowerCase();
        const views = dev.recentViews || [];
        const recentSubdomainsOrUrls = views.map(v => `${v.subdomain || ''} ${v.hostname || ''} ${v.url || ''} ${v.displayPath || ''} ${v.title || ''}`).join(' ').toLowerCase();

        const matchesSearch = !searchTerm || 
            ip.includes(searchTerm) || 
            devId.includes(searchTerm) || 
            customName.includes(searchTerm) ||
            os.includes(searchTerm) || 
            browser.includes(searchTerm) || 
            city.includes(searchTerm) || 
            country.includes(searchTerm) ||
            lastPath.includes(searchTerm) ||
            lastSubdomain.includes(searchTerm) ||
            recentSubdomainsOrUrls.includes(searchTerm);

        // Type Filter
        const matchesType = selectedType === 'all' || (dev.deviceType || '').toLowerCase() === selectedType.toLowerCase();

        // Status Filter
        const lastSeenMs = new Date(dev.meta?.lastSeen || 0).getTime();
        const isOnline = isDeviceOnline(dev);
        const isRecent = (now - lastSeenMs <= 24 * 60 * 60 * 1000);

        let matchesStatus = true;
        if (selectedStatus === 'default') {
            matchesStatus = !isHidden && !isMuted; // Hide hidden AND muted devices from default view
        } else if (selectedStatus === 'all') {
            matchesStatus = true; // All Statuses shows everything (hidden, muted, banned, active, etc.)
        } else if (selectedStatus === 'online') {
            matchesStatus = isOnline && !isHidden && !isMuted;
        } else if (selectedStatus === 'recent') {
            matchesStatus = isRecent && !isHidden && !isMuted;
        } else if (selectedStatus === 'muted') {
            matchesStatus = isMuted;
        } else if (selectedStatus === 'banned') {
            matchesStatus = isBanned;
        } else if (selectedStatus === 'hidden') {
            matchesStatus = isHidden;
        }

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

    const sortedDevicesList = sortDevices(filtered);

    let rowsHtml = '';
    sortedDevicesList.forEach(dev => {
        const currentAdminDeviceId = localStorage.getItem('astrong_device_id');
        const isInControl = currentUser && dev.deviceId && (dev.deviceId === currentAdminDeviceId);
        const isOnline = isDeviceOnline(dev);
        const isBanned = !!dev.isBanned;
        const isHidden = hiddenSet.has(dev.deviceId);
        const isMuted = isDeviceMuted(dev);

        const statusDotClass = isBanned ? 'banned' : (isOnline || isInControl ? 'online' : 'offline');
        const statusLabel = isBanned ? 'Banned' : (isInControl ? 'In Control' : (isOnline ? 'Online' : 'Offline'));
        const isFlashing = flashingDeviceIds.has(dev.deviceId);

        const customName = dev.customName || customNamesMap[dev.deviceId];
        const statusDisplay = customName ? customName : statusLabel;
        const perf = calculateDevicePerformance(dev);

        const locationStr = (dev.network?.city && dev.network?.city !== 'Unknown')
            ? `${dev.network.city}${dev.network.country ? `, ${dev.network.country}` : ''}`
            : (dev.network?.country || 'Unknown');

        rowsHtml += `
            <tr data-device-id="${dev.deviceId}">
                <td>
                    <div class="status-cell-container">
                        <span class="status-dot ${statusDotClass} ${isFlashing ? 'flash' : ''}" title="${statusLabel}"></span>
                        <span class="device-custom-name-text" style="font-size: 0.88rem; font-weight: 700; color: var(--text-primary);">${statusDisplay}</span>
                        ${isInControl ? '<span class="badge-in-control">In Control</span>' : ''}
                        ${isBanned ? '<span class="badge-banned">Banned</span>' : ''}
                        ${isMuted ? '<span class="badge-muted">Muted</span>' : ''}
                        ${isHidden ? '<span class="badge-hidden">Hidden</span>' : ''}
                    </div>
                </td>
                <td>
                    <div style="font-weight: 600;">${dev.deviceType || 'Desktop'}</div>
                    <span class="sub-info mono-text">${dev.deviceId || '--'}</span>
                </td>
                <td>
                    <div class="perf-badge ${perf.badgeClass}" title="Score: ${perf.compositeScore}/100 | Net: ${perf.networkScore} | Std: ${perf.standardScore}">
                        <span class="perf-score-num">${perf.compositeScore}</span>
                        <span class="perf-score-sep">•</span>
                        <span class="perf-score-rating">${perf.rating}</span>
                    </div>
                    <div class="perf-breakdown-sub mono-text">Net ${perf.networkScore} / Std ${perf.standardScore}</div>
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
                    <div>${formatRelativeTime(dev.meta?.lastSeen)}</div>
                    <span class="sub-info">${formatDate(dev.meta?.lastSeen)}</span>
                </td>
                <td>
                    <span class="mono-text" style="font-weight: 600;">${dev.meta?.visitCount || 1}</span>
                </td>
                <td>
                    <div class="action-buttons-group">
                        <button class="act-btn rename-btn" data-device-id="${dev.deviceId}" title="Rename Device (Custom Name)">
                            <i data-lucide="pencil"></i>
                        </button>
                        <button class="act-btn ban-btn ${isBanned ? 'active' : ''}" data-device-id="${dev.deviceId}" data-banned="${isBanned}" title="${isBanned ? 'Unban Device' : 'Ban Device'}">
                            <i data-lucide="hammer"></i>
                        </button>
                        <button class="act-btn mute-btn ${isMuted ? 'active' : ''}" data-device-id="${dev.deviceId}" title="${isMuted ? 'Unmute Device' : 'Mute until next activity'}">
                            <i data-lucide="bell-off"></i>
                        </button>
                        <button class="act-btn hide-btn ${isHidden ? 'active' : ''}" data-device-id="${dev.deviceId}" title="${isHidden ? 'Unhide Device' : 'Hide Device'}">
                            <i data-lucide="x"></i>
                        </button>
                        <button class="act-btn delete-btn" data-device-id="${dev.deviceId}" title="Permanently Delete Device Record">
                            <i data-lucide="trash-2"></i>
                        </button>
                        <button class="act-btn more-btn" data-device-id="${dev.deviceId}" title="View Details (More)">
                            <i data-lucide="ellipsis"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    devicesTbody.innerHTML = rowsHtml;

    // Render Lucide Icons
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    // Attach Event Handlers for Action Buttons
    devicesTbody.querySelectorAll('.rename-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const devId = btn.getAttribute('data-device-id');
            const targetDev = rawDevices.find(d => d.deviceId === devId);
            const currentMap = getCustomNamesMap();
            const currentName = targetDev?.customName || currentMap[devId] || '';
            const newName = prompt(`Enter custom name for device ${devId}:`, currentName);
            if (newName !== null) {
                await updateDeviceCustomName(devId, newName.trim());
            }
        });
    });

    // Attach Event Handlers for Action Buttons
    devicesTbody.querySelectorAll('.ban-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = btn.getAttribute('data-device-id');
            const isBanned = btn.getAttribute('data-banned') === 'true';
            const actionText = isBanned ? 'unban' : 'ban';
            if (confirm(`Are you sure you want to ${actionText} device ${devId}?`)) {
                toggleBanDevice(devId, isBanned);
            }
        });
    });

    devicesTbody.querySelectorAll('.mute-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = btn.getAttribute('data-device-id');
            const targetDev = rawDevices.find(d => d.deviceId === devId);
            if (targetDev) {
                toggleMuteDevice(targetDev);
            }
        });
    });

    devicesTbody.querySelectorAll('.hide-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = btn.getAttribute('data-device-id');
            toggleHideDevice(devId);
        });
    });

    devicesTbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = btn.getAttribute('data-device-id');
            if (confirm(`Are you sure you want to PERMANENTLY delete device record ${devId} from Firestore? This action cannot be undone.`)) {
                deleteDeviceRecord(devId);
            }
        });
    });

    devicesTbody.querySelectorAll('.more-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const devId = btn.getAttribute('data-device-id');
            const targetDev = rawDevices.find(d => d.deviceId === devId);
            if (targetDev) {
                openDeviceModal(targetDev);
            }
        });
    });
}

// 5. Helper Formatting Functions
function parseSubdomainPageEntry(v) {
    if (!v) return { url: '', hostname: '', subdomain: 'main', path: '/', displayPath: '/', badgeLabel: 'astrong.xyz', title: '' };
    
    let urlStr = v.url || '';
    let hostname = v.hostname || '';
    let path = v.path || '';
    let displayPath = v.displayPath || '';
    let subdomain = v.subdomain || '';
    let title = v.title || '';

    // If missing hostname/subdomain (legacy entry), parse from URL
    if (!hostname && urlStr) {
        try {
            const parsedUrl = new URL(urlStr);
            hostname = parsedUrl.hostname;
            if (!path) path = parsedUrl.pathname;
        } catch (e) {}
    }

    if (!subdomain && hostname) {
        if (hostname.endsWith('.astrong.xyz')) {
            const sub = hostname.replace('.astrong.xyz', '');
            subdomain = (sub && sub !== 'www') ? sub : 'main';
        } else if (hostname !== 'astrong.xyz' && hostname.includes('.')) {
            subdomain = hostname.split('.')[0];
        } else {
            subdomain = 'main';
        }
    }

    if (!subdomain) subdomain = 'main';

    if (!displayPath) {
        if (hostname) {
            displayPath = hostname + (path === '/' ? '' : path);
        } else {
            displayPath = path || '/';
        }
    }

    const badgeLabel = hostname || (subdomain !== 'main' ? `${subdomain}.astrong.xyz` : 'astrong.xyz');

    return {
        url: urlStr,
        hostname: hostname,
        subdomain: subdomain,
        path: path,
        displayPath: displayPath,
        badgeLabel: badgeLabel,
        title: title
    };
}

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
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// 6. Device Detail Modal & Drawer Logic
function openDeviceModal(dev) {
    activeSelectedDevice = dev;
    
    const customNamesMap = getCustomNamesMap();
    const currentCustomName = dev.customName || customNamesMap[dev.deviceId] || '';
    document.getElementById('modal-device-id').textContent = currentCustomName || dev.deviceId || 'Device Details';

    const customNameInput = document.getElementById('detail-custom-name-input');
    if (customNameInput) {
        customNameInput.value = currentCustomName;
        customNameInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const saveBtn = document.getElementById('detail-save-name-btn');
                if (saveBtn) saveBtn.click();
            }
        };
    }

    const saveNameBtn = document.getElementById('detail-save-name-btn');
    if (saveNameBtn) {
        saveNameBtn.onclick = async () => {
            if (!activeSelectedDevice) return;
            const newName = document.getElementById('detail-custom-name-input').value.trim();
            await updateDeviceCustomName(activeSelectedDevice.deviceId, newName);
            document.getElementById('modal-device-id').textContent = newName || activeSelectedDevice.deviceId;
        };
    }
    
    const isOnline = isDeviceOnline(dev);
    const hiddenSet = getHiddenDeviceIds();
    const isHidden = hiddenSet.has(dev.deviceId);
    
    const isMuted = isDeviceMuted(dev);
    
    const currentAdminDeviceId = localStorage.getItem('astrong_device_id');
    const isInControl = currentUser && dev.deviceId && (dev.deviceId === currentAdminDeviceId);
    
    const badge = document.getElementById('modal-status-badge');
    if (isInControl) {
        badge.textContent = 'In Control';
        badge.className = 'modal-badge in-control';
    } else {
        badge.textContent = isOnline ? 'Online' : 'Offline';
        badge.className = `modal-badge ${isOnline ? 'online' : ''}`;
    }

    const mutedBadge = document.getElementById('modal-muted-badge');
    if (mutedBadge) mutedBadge.style.display = isMuted ? 'inline-block' : 'none';

    const bannedBadge = document.getElementById('modal-banned-badge');
    if (bannedBadge) bannedBadge.style.display = dev.isBanned ? 'inline-block' : 'none';

    const hiddenBadge = document.getElementById('modal-hidden-badge');
    if (hiddenBadge) hiddenBadge.style.display = isHidden ? 'inline-block' : 'none';

    // Overview Tab
    document.getElementById('detail-device-id').textContent = dev.deviceId || '--';
    document.getElementById('detail-device-type').textContent = dev.deviceType || '--';
    document.getElementById('detail-first-seen').textContent = formatDate(dev.meta?.firstSeen);
    document.getElementById('detail-last-seen').textContent = formatDate(dev.meta?.lastSeen);
    document.getElementById('detail-os').textContent = `${dev.operatingSystem?.name || '--'} (${dev.operatingSystem?.platform || '--'})`;
    document.getElementById('detail-browser').textContent = `${dev.browser?.name || '--'} ${dev.browser?.version || ''}`;
    document.getElementById('detail-language').textContent = dev.browser?.language || '--';
    document.getElementById('detail-timezone').textContent = dev.locale?.timeZone || '--';

    const lastPathRaw = dev.meta?.lastPath || '';
    const views = dev.recentViews || [];
    let lastPageDisplay = '--';
    if (lastPathRaw) {
        lastPageDisplay = lastPathRaw;
    } else if (views.length > 0) {
        const lastView = parseSubdomainPageEntry(views[views.length - 1]);
        lastPageDisplay = lastView.displayPath;
    }
    const lastPageEl = document.getElementById('detail-last-page');
    if (lastPageEl) lastPageEl.textContent = lastPageDisplay;

    // Hardware Tab
    document.getElementById('detail-screen').textContent = `${dev.hardware?.screenWidth} x ${dev.hardware?.screenHeight}`;
    document.getElementById('detail-avail-screen').textContent = `${dev.hardware?.screenAvailWidth} x ${dev.hardware?.screenAvailHeight}`;
    document.getElementById('detail-viewport').textContent = `${dev.hardware?.viewportWidth} x ${dev.hardware?.viewportHeight}`;
    document.getElementById('detail-dpr').textContent = `${dev.hardware?.pixelRatio}x`;
    document.getElementById('detail-cpu-cores').textContent = `${dev.hardware?.cpuCores} Cores`;
    document.getElementById('detail-ram').textContent = `${dev.hardware?.deviceMemoryGB} GB`;
    document.getElementById('detail-touch-points').textContent = dev.hardware?.maxTouchPoints;
    document.getElementById('detail-gpu').textContent = `${dev.hardware?.gpuVendor || 'Unknown'} / ${dev.hardware?.gpuRenderer || 'Unknown'}`;

    // Battery & System Tab
    const battLevel = dev.battery?.level != null ? `${dev.battery.level}%` : 'Not Available';
    const battCharging = dev.battery?.charging != null ? (dev.battery.charging ? 'Charging ⚡' : 'On Battery 🔋') : 'Not Available';
    document.getElementById('detail-battery-level').textContent = battLevel;
    document.getElementById('detail-battery-charging').textContent = battCharging;
    document.getElementById('detail-orientation').textContent = dev.preferences?.orientation || 'Unknown';
    document.getElementById('detail-color-scheme').textContent = dev.preferences?.colorScheme ? dev.preferences.colorScheme.toUpperCase() : 'Unknown';
    document.getElementById('detail-reduced-motion').textContent = dev.preferences?.reducedMotion != null ? (dev.preferences.reducedMotion ? 'Enabled' : 'Disabled') : 'Disabled';
    document.getElementById('detail-bot-status').textContent = dev.browser?.webdriver ? 'Automated WebDriver Bot 🤖' : 'Normal User Browser';

    // Network Tab
    document.getElementById('detail-ip').textContent = dev.network?.ip || '--';
    document.getElementById('detail-location').textContent = `${dev.network?.city || ''}, ${dev.network?.region || ''}, ${dev.network?.country || ''}`;
    document.getElementById('detail-isp').textContent = dev.network?.isp || '--';
    document.getElementById('detail-connection-type').textContent = dev.network?.connectionType || '--';
    document.getElementById('detail-downlink').textContent = dev.network?.downlinkMbps ? `${dev.network.downlinkMbps} Mbps` : '--';
    document.getElementById('detail-rtt').textContent = dev.network?.rttMs ? `${dev.network.rttMs} ms` : '--';

    // Page History Tab
    const historyContainer = document.getElementById('history-container');
    if (views.length === 0) {
        historyContainer.innerHTML = `<p class="empty-history-text">No page history logged for this device.</p>`;
    } else {
        let historyHtml = '';
        views.slice().reverse().forEach(v => {
            const info = parseSubdomainPageEntry(v);
            const refStr = (v.referrer && v.referrer !== 'Direct') ? `Referred from: ${escapeHtml(v.referrer)}` : '';
            historyHtml += `
                <div class="history-item">
                    <div class="history-item-left">
                        <div class="history-url-row">
                            <span class="subdomain-badge subdomain-${escapeHtml(info.subdomain)}">${escapeHtml(info.badgeLabel)}</span>
                            <span class="history-page-title">${escapeHtml(info.title || info.displayPath)}</span>
                        </div>
                        <div class="history-details-row">
                            <span class="sub-info mono-text">${escapeHtml(info.url || info.displayPath)}</span>
                            ${refStr ? `<span class="sub-info history-referrer">${refStr}</span>` : ''}
                        </div>
                    </div>
                    <span class="history-time">${formatDate(v.timestamp)}</span>
                </div>
            `;
        });
        historyContainer.innerHTML = historyHtml;
    }

    // Authentication Access Tab
    const authContainer = document.getElementById('auth-container');
    if (authContainer) {
        const isSchoolVerified = !!(dev.authorizations?.schoolSchedule || dev.schoolVerified);

        const schoolStatusBadge = isSchoolVerified
            ? `<span style="font-size: 0.72rem; font-family: var(--font-mono); font-weight: 700; padding: 0.2rem 0.55rem; background: rgba(52, 199, 89, 0.15); color: #34c759; border-radius: 4px; border: 1px solid rgba(52, 199, 89, 0.3);">ACCESS GRANTED</span>`
            : `<span style="font-size: 0.72rem; font-family: var(--font-mono); font-weight: 700; padding: 0.2rem 0.55rem; background: rgba(142, 142, 147, 0.15); color: var(--text-muted); border-radius: 4px; border: 1px solid rgba(142, 142, 147, 0.3);">NO ACCESS</span>`;

        const grantedViaText = isSchoolVerified ? 'Password Verification' : 'None';

        authContainer.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <div class="detail-item full-width" style="border-left: 3px solid ${isSchoolVerified ? '#34c759' : 'var(--border-color)'};">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <strong style="color: var(--text-primary); font-size: 0.95rem;">School Schedule Access</strong>
                            <span class="mono-text" style="font-size: 0.75rem; color: var(--text-muted);">/schedule/school</span>
                        </div>
                        ${schoolStatusBadge}
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-top: 0.5rem; font-size: 0.82rem;">
                        <div>
                            <span class="detail-label">Verification Method</span>
                            <div style="color: var(--text-primary); font-weight: 500; margin-top: 0.15rem;">${grantedViaText}</div>
                        </div>
                        <div>
                            <span class="detail-label">Permission Scope</span>
                            <div style="color: var(--text-primary); font-weight: 500; margin-top: 0.15rem;">Full Schedule View</div>
                        </div>
                        <div>
                            <span class="detail-label">Status</span>
                            <div style="color: ${isSchoolVerified ? '#34c759' : 'var(--text-muted)'}; font-weight: 600; margin-top: 0.15rem;">
                                ${isSchoolVerified ? 'Authorized Visitor' : 'Unverified Visitor (Blocked)'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Performance Box in Overview Tab
    const perfBox = document.getElementById('detail-perf-box');
    if (perfBox) {
        const perf = calculateDevicePerformance(dev);
        perfBox.innerHTML = `
            <div class="perf-modal-card">
                <div class="perf-modal-badge-row">
                    <span class="perf-badge ${perf.badgeClass}">
                        <span class="perf-score-num">${perf.compositeScore}</span>
                        <span class="perf-score-sep">•</span>
                        <span class="perf-score-rating">${perf.rating} Performance</span>
                    </span>
                </div>
                <div class="perf-metric-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-top: 0.6rem;">
                    <div class="perf-sub-card" style="background: var(--surface-variant); padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Standard Compute</div>
                        <div style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0.15rem 0;">${perf.standardScore}<span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted);">/100</span></div>
                        <div style="font-size: 0.78rem; color: var(--text-secondary);">CPU Cores: ${perf.details.cores} | RAM: ${perf.details.ram}</div>
                    </div>
                    <div class="perf-sub-card" style="background: var(--surface-variant); padding: 0.65rem 0.85rem; border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Network Speed & Latency</div>
                        <div style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 0.15rem 0;">${perf.networkScore}<span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted);">/100</span></div>
                        <div style="font-size: 0.78rem; color: var(--text-secondary);">Downlink: ${perf.details.downlink} | RTT: ${perf.details.rtt}</div>
                    </div>
                </div>
            </div>
        `;
    }

    // JSON Raw Viewer Tab
    document.getElementById('json-viewer').textContent = JSON.stringify(formatDeviceForJson(dev), null, 2);

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

if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('refreshing');
        const icon = refreshBtn.querySelector('i, svg');
        if (icon) icon.classList.add('spin-once');
        renderDevicesTable();
        setTimeout(() => {
            refreshBtn.classList.remove('refreshing');
            if (icon) icon.classList.remove('spin-once');
        }, 600);
    });
}

exportBtn.addEventListener('click', () => {
    if (rawDevices.length === 0) return;
    const formattedDevices = rawDevices.map(d => formatDeviceForJson(d));
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(formattedDevices, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `astrong-telemetry-${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
});


// Escape HTML utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
