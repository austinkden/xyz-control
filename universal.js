// universal.js - Loads and applies the persistent accent theme across all pages
(function () {
    console.log('%c[astrong.xyz]%c Universal runtime initialized (%s)', 'color: #8859ff; font-weight: bold;', 'color: inherit;', window.location.pathname);

    // Prevent 'Confirm Form Resubmission' dialog on page reload
    if (window.history && window.history.replaceState) {
        window.history.replaceState(null, null, window.location.href);
    }

    // 0. Subdomain Storage Policy Enforcement & Root Cookie Helpers
    const isSubdomain = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
    if (isSubdomain) {
        try {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem = function () { };
            sessionStorage.setItem = function () { };
        } catch (e) { }
    }

    function getRootCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function setRootCookie(name, value, days) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        const expires = `expires=${d.toUTCString()}`;
        const domainStr = window.location.hostname.endsWith('astrong.xyz') ? '; domain=.astrong.xyz' : '';
        document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax; Secure${domainStr}`;
    }

    // Device & Session Telemetry Collector
    (async function initTelemetry() {
        try {
            const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
            const { getFirestore, doc, getDoc, setDoc, arrayUnion, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
            const { firebaseConfig } = await import("https://astrong.xyz/firebase-config.js");

            // Initialize Firebase App & Firestore
            const app = initializeApp(firebaseConfig);
            const db = getFirestore(app);

            // 1. Device & Session ID Setup (8-character alphanumeric uppercase format)
            function generate8CharDeviceId() {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let res = '';
                const array = new Uint8Array(8);
                if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                    crypto.getRandomValues(array);
                    for (let i = 0; i < 8; i++) {
                        res += chars.charAt(array[i] % chars.length);
                    }
                } else {
                    for (let i = 0; i < 8; i++) {
                        res += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                }
                return res;
            }

            let deviceId = getRootCookie('astrong_device_id');
            if (!deviceId && !isSubdomain) {
                try { deviceId = localStorage.getItem('astrong_device_id'); } catch (e) { }
            }

            if (!deviceId || !/^[A-Z0-9]{8}$/.test(deviceId)) {
                let candidate = generate8CharDeviceId();
                let attempts = 0;
                while (attempts < 5) {
                    try {
                        const checkRef = doc(db, "devices", candidate);
                        const checkSnap = await getDoc(checkRef);
                        if (checkSnap.exists()) {
                            candidate = generate8CharDeviceId();
                            attempts++;
                        } else {
                            break;
                        }
                    } catch (e) {
                        break;
                    }
                }
                deviceId = candidate;
            }
            setRootCookie('astrong_device_id', deviceId, 3650);
            if (!isSubdomain) {
                try { localStorage.setItem('astrong_device_id', deviceId); } catch (e) { }
            }
            window.__ASTRONG_DEVICE_ID__ = deviceId;
            console.log(`[Telemetry] Active Device ID: ${deviceId}`);

            function syncDeviceIdUI() {
                const loader = document.getElementById('astrong-loading-screen');
                if (loader && !loader.querySelector('#loading-device-id')) {
                    const idDiv = document.createElement('div');
                    idDiv.className = 'loading-device-id';
                    idDiv.id = 'loading-device-id';
                    idDiv.innerHTML = `<span>${deviceId}</span>`;
                    loader.appendChild(idDiv);
                }
                const displays = document.querySelectorAll('#loading-device-id span, #help-device-id, .device-id-display');
                displays.forEach(el => {
                    el.textContent = deviceId;
                });
            }
            syncDeviceIdUI();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', syncDeviceIdUI);
            }

            let sessionId = getRootCookie('astrong_session_id');
            if (!sessionId && !isSubdomain) {
                try { sessionId = sessionStorage.getItem('astrong_session_id'); } catch (e) { }
            }
            let isNewSession = false;
            if (!sessionId) {
                sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
                setRootCookie('astrong_session_id', sessionId, 1);
                if (!isSubdomain) {
                    try { sessionStorage.setItem('astrong_session_id', sessionId); } catch (e) { }
                }
                isNewSession = true;
            }

            let firstSeen = getRootCookie('astrong_first_seen');
            if (!firstSeen && !isSubdomain) {
                try { firstSeen = localStorage.getItem('astrong_first_seen'); } catch (e) { }
            }
            if (!firstSeen) {
                firstSeen = new Date().toISOString();
                setRootCookie('astrong_first_seen', firstSeen, 3650);
                if (!isSubdomain) {
                    try { localStorage.setItem('astrong_first_seen', firstSeen); } catch (e) { }
                }
            }

            let visitCount = parseInt(getRootCookie('astrong_visit_count') || (!isSubdomain ? localStorage.getItem('astrong_visit_count') : '0') || '0', 10);
            if (isNewSession) {
                visitCount += 1;
                setRootCookie('astrong_visit_count', visitCount.toString(), 3650);
                if (!isSubdomain) {
                    try { localStorage.setItem('astrong_visit_count', visitCount.toString()); } catch (e) { }
                }
            }

            // 2. Parse User Agent for Browser & OS
            const ua = navigator.userAgent || '';
            let browserName = 'Unknown Browser';
            let browserVer = '';
            let osName = 'Unknown OS';

            // Detect OS
            if (ua.indexOf('Win') !== -1) osName = 'Windows';
            else if (ua.indexOf('Mac') !== -1) {
                if (ua.indexOf('iPhone') !== -1 || ua.indexOf('iPad') !== -1 || ua.indexOf('iPod') !== -1) osName = 'iOS';
                else osName = 'macOS';
            } else if (ua.indexOf('Android') !== -1) osName = 'Android';
            else if (ua.indexOf('Linux') !== -1) osName = 'Linux';
            else if (ua.indexOf('CrOS') !== -1) osName = 'ChromeOS';

            // Detect Browser
            if (ua.indexOf('Firefox') !== -1) {
                browserName = 'Firefox';
                browserVer = ua.match(/Firefox\/([\d.]+)/)?.[1] || '';
            } else if (ua.indexOf('SamsungBrowser') !== -1) {
                browserName = 'Samsung Internet';
                browserVer = ua.match(/SamsungBrowser\/([\d.]+)/)?.[1] || '';
            } else if (ua.indexOf('Opera') !== -1 || ua.indexOf('OPR') !== -1) {
                browserName = 'Opera';
                browserVer = ua.match(/(?:Opera|OPR)\/([\d.]+)/)?.[1] || '';
            } else if (ua.indexOf('Edg') !== -1) {
                browserName = 'Microsoft Edge';
                browserVer = ua.match(/Edg\/([\d.]+)/)?.[1] || '';
            } else if (ua.indexOf('Chrome') !== -1) {
                browserName = 'Google Chrome';
                browserVer = ua.match(/Chrome\/([\d.]+)/)?.[1] || '';
            } else if (ua.indexOf('Safari') !== -1) {
                browserName = 'Safari';
                browserVer = ua.match(/Version\/([\d.]+)/)?.[1] || '';
            }

            // Device Category
            let deviceType = 'Desktop';
            if (/Mobi|Android|iPhone|iPod/i.test(ua)) deviceType = 'Mobile';
            else if (/Tablet|iPad/i.test(ua) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && osName === 'macOS')) deviceType = 'Tablet';

            // Tab Visibility, Focus Dwell Time & Active Engagement Tracking (Item 6)
            let activeDwellSec = 0;
            let backgroundDwellSec = 0;
            let lastDwellTick = Date.now();
            setInterval(() => {
                const now = Date.now();
                const delta = Math.max(1, Math.round((now - lastDwellTick) / 1000));
                lastDwellTick = now;
                if (document.visibilityState === 'visible') {
                    activeDwellSec += delta;
                } else {
                    backgroundDwellSec += delta;
                }
            }, 1000);

            // 3. Hardware & Graphics Telemetry (Items 3, 4, 5, 8)
            let gpuVendor = 'Unknown';
            let gpuRenderer = 'Unknown';
            let maxTextureSize = null;
            let maxRenderbufferSize = null;
            let webglExtensionsCount = null;
            try {
                const canvas = document.createElement('canvas');
                const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                if (gl) {
                    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                    if (debugInfo) {
                        gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'Unknown';
                        gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'Unknown';
                    }
                    maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || null;
                    maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || null;
                    const exts = gl.getSupportedExtensions();
                    webglExtensionsCount = exts ? exts.length : null;
                }
            } catch (e) {
                // WebGL detection fallback
            }

            // Display HDR & Color Gamut Telemetry (Item 3)
            let hdrSupport = false;
            let colorGamut = 'sRGB';
            try {
                if (window.matchMedia) {
                    hdrSupport = window.matchMedia('(dynamic-range: high)').matches;
                    if (window.matchMedia('(color-gamut: rec2020)').matches) {
                        colorGamut = 'Rec. 2020';
                    } else if (window.matchMedia('(color-gamut: p3)').matches) {
                        colorGamut = 'Display P3';
                    } else if (window.matchMedia('(color-gamut: srgb)').matches) {
                        colorGamut = 'sRGB';
                    }
                }
            } catch (e) { }

            // Storage Quota Telemetry (Item 4)
            let storageEstimate = { quotaGB: null, usageMB: null };
            try {
                if (navigator.storage && typeof navigator.storage.estimate === 'function') {
                    const est = await navigator.storage.estimate();
                    if (est && est.quota) {
                        storageEstimate.quotaGB = +(est.quota / (1024 * 1024 * 1024)).toFixed(1);
                    }
                    if (est && est.usage != null) {
                        storageEstimate.usageMB = +(est.usage / (1024 * 1024)).toFixed(2);
                    }
                }
            } catch (e) { }

            // Input Device Modality & Pointer Precision (Item 5)
            let inputModality = 'Unknown';
            try {
                if (window.matchMedia) {
                    const finePointer = window.matchMedia('(pointer: fine)').matches;
                    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
                    const canHover = window.matchMedia('(hover: hover)').matches;
                    if (finePointer && coarsePointer) {
                        inputModality = canHover ? 'Hybrid (Mouse + Touch)' : 'Hybrid (Touch + Stylus)';
                    } else if (finePointer) {
                        inputModality = canHover ? 'Mouse / Trackpad (Fine)' : 'Precision Stylus';
                    } else if (coarsePointer) {
                        inputModality = 'Touchscreen (Coarse)';
                    } else {
                        inputModality = 'Keyboard / None';
                    }
                }
            } catch (e) { }

            // Battery Telemetry
            let batteryInfo = { level: null, charging: null, chargingTime: null, dischargingTime: null };
            try {
                if (typeof navigator.getBattery === 'function') {
                    const battery = await navigator.getBattery();
                    batteryInfo = {
                        level: Math.round(battery.level * 100),
                        charging: battery.charging,
                        chargingTime: battery.chargingTime !== Infinity ? battery.chargingTime : null,
                        dischargingTime: battery.dischargingTime !== Infinity ? battery.dischargingTime : null
                    };
                }
            } catch (e) { }

            // Connection Telemetry
            let connectionInfo = { effectiveType: 'Unknown', downlink: null, rtt: null, saveData: false };
            if (navigator.connection) {
                connectionInfo = {
                    effectiveType: navigator.connection.effectiveType || 'Unknown',
                    downlink: navigator.connection.downlink || null,
                    rtt: navigator.connection.rtt || null,
                    saveData: !!navigator.connection.saveData
                };
            }

            // Display & Preferences Telemetry
            const orientationType = screen.orientation?.type || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
            const orientationAngle = screen.orientation?.angle || 0;
            const colorScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'no-preference');
            const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const isAutomatedBot = !!navigator.webdriver;

            // 4. IP & Geolocation Fetching (with localStorage caching and ipify check)
            let ipData = {
                ip: 'Unknown',
                city: 'Unknown',
                region: 'Unknown',
                country: 'Unknown',
                countryCode: '',
                isp: 'Unknown',
                org: 'Unknown',
                lat: null,
                lon: null
            };

            async function fetchIpData() {
                let cached = null;
                try {
                    const rawCookie = getRootCookie('astrong_cached_ip_data');
                    if (rawCookie) {
                        cached = JSON.parse(decodeURIComponent(rawCookie));
                    } else if (window.location.hostname === 'astrong.xyz') {
                        cached = JSON.parse(localStorage.getItem('astrong_cached_ip_data') || 'null');
                    }
                } catch (e) { }

                function cacheIpData(freshData) {
                    try {
                        const jsonStr = JSON.stringify(freshData);
                        setRootCookie('astrong_cached_ip_data', encodeURIComponent(jsonStr), 7);
                        if (window.location.hostname === 'astrong.xyz') {
                            localStorage.setItem('astrong_cached_ip_data', jsonStr);
                        }
                    } catch (e) { }
                }

                let currentIp = null;
                try {
                    const ipifyRes = await fetch('https://api.ipify.org?format=json').catch(() => null);
                    if (ipifyRes && ipifyRes.ok) {
                        const data = await ipifyRes.json();
                        currentIp = data.ip || null;
                    }
                } catch (e) { }

                // Reuse cached location data if IP matches or ipify was unreachable but cache exists
                if (cached && cached.ip && (currentIp === null || currentIp === cached.ip)) {
                    console.log(`[Telemetry] IP cache hit (${cached.ip} - ${cached.city}, ${cached.country}). Skipping IP API fetch.`);
                    return cached;
                }

                console.log(`[Telemetry] Uncached or changed IP (${currentIp || 'Unknown'}). Fetching geolocation data...`);

                // Primary Provider: ipapi.co
                try {
                    const res = await fetch('https://ipapi.co/json/').catch(() => null);
                    if (res && res.ok) {
                        const data = await res.json().catch(() => null);
                        if (data && !data.error) {
                            const freshData = {
                                ip: data.ip || currentIp || 'Unknown',
                                city: data.city || 'Unknown',
                                region: data.region || 'Unknown',
                                country: data.country_name || data.country || 'Unknown',
                                countryCode: data.country_code || '',
                                isp: data.org || data.asn || 'Unknown',
                                org: data.org || 'Unknown',
                                lat: data.latitude || null,
                                lon: data.longitude || null
                            };
                            cacheIpData(freshData);
                            console.log(`[Telemetry] Successfully updated IP cache for ${freshData.ip}`);
                            return freshData;
                        }
                    }
                } catch (err) { }

                // Secondary Fallback Provider: ipwho.is (CORS enabled)
                try {
                    const res = await fetch('https://ipwho.is/').catch(() => null);
                    if (res && res.ok) {
                        const data = await res.json().catch(() => null);
                        if (data && data.success !== false) {
                            const freshData = {
                                ip: data.ip || currentIp || 'Unknown',
                                city: data.city || 'Unknown',
                                region: data.region || 'Unknown',
                                country: data.country || 'Unknown',
                                countryCode: data.country_code || '',
                                isp: data.connection?.isp || data.connection?.org || 'Unknown',
                                org: data.connection?.org || 'Unknown',
                                lat: data.latitude || null,
                                lon: data.longitude || null
                            };
                            cacheIpData(freshData);
                            console.log(`[Telemetry] Successfully updated IP cache for ${freshData.ip} (via ipwho.is)`);
                            return freshData;
                        }
                    }
                } catch (err) { }

                if (cached) return cached;
                if (currentIp) ipData.ip = currentIp;
                return ipData;
            }

            ipData = await fetchIpData();

            // 5. Build Telemetry Payload
            const nowIso = new Date().toISOString();

            const pageVisitEntry = {
                url: window.location.href,
                path: window.location.pathname,
                title: document.title,
                timestamp: nowIso,
                referrer: document.referrer || 'Direct'
            };

            const devicePayload = {
                deviceId: deviceId,
                lastSessionId: sessionId,
                deviceType: deviceType,
                browser: {
                    name: browserName,
                    version: browserVer,
                    userAgent: ua,
                    language: navigator.language || 'Unknown',
                    languages: navigator.languages ? Array.from(navigator.languages) : [],
                    cookiesEnabled: navigator.cookieEnabled,
                    online: navigator.onLine,
                    doNotTrack: navigator.doNotTrack || 'Unspecified',
                    pdfViewerEnabled: navigator.pdfViewerEnabled ?? null,
                    webdriver: isAutomatedBot
                },
                operatingSystem: {
                    name: osName,
                    platform: navigator.platform || 'Unknown'
                },
                hardware: {
                    screenWidth: screen.width,
                    screenHeight: screen.height,
                    screenAvailWidth: screen.availWidth,
                    screenAvailHeight: screen.availHeight,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    pixelRatio: window.devicePixelRatio || 1,
                    colorDepth: screen.colorDepth || 24,
                    pixelDepth: screen.pixelDepth || 24,
                    cpuCores: navigator.hardwareConcurrency || 'Unknown',
                    deviceMemoryGB: navigator.deviceMemory || 'Unknown',
                    maxTouchPoints: navigator.maxTouchPoints || 0,
                    gpuVendor: gpuVendor,
                    gpuRenderer: gpuRenderer,
                    hdrSupport: hdrSupport ? 'Supported (HDR)' : 'SDR Only',
                    colorGamut: colorGamut,
                    storageQuotaGB: storageEstimate.quotaGB,
                    storageUsageMB: storageEstimate.usageMB,
                    inputModality: inputModality,
                    maxTextureSize: maxTextureSize,
                    maxRenderbufferSize: maxRenderbufferSize,
                    webglExtensionsCount: webglExtensionsCount
                },
                preferences: {
                    colorScheme: colorScheme,
                    reducedMotion: reducedMotion,
                    orientation: `${orientationType} (${orientationAngle}°)`
                },
                network: {
                    ip: ipData.ip,
                    city: ipData.city,
                    region: ipData.region,
                    country: ipData.country,
                    countryCode: ipData.countryCode || '',
                    isp: ipData.isp,
                    lat: ipData.lat,
                    lon: ipData.lon,
                    connectionType: connectionInfo.effectiveType,
                    downlinkMbps: connectionInfo.downlink,
                    rttMs: connectionInfo.rtt,
                    saveData: connectionInfo.saveData
                },
                battery: batteryInfo,
                locale: {
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
                    timeZoneOffsetMinutes: new Date().getTimezoneOffset()
                },
                meta: {
                    firstSeen: firstSeen,
                    lastSeen: nowIso,
                    updatedAt: serverTimestamp(),
                    visitCount: visitCount,
                    lastPath: window.location.pathname,
                    lastReferrer: document.referrer || 'Direct',
                    engagement: {
                        activeDwellSec: activeDwellSec,
                        backgroundDwellSec: backgroundDwellSec,
                        tabVisibility: document.visibilityState || 'visible'
                    }
                },
                recentViews: arrayUnion(pageVisitEntry)
            };

            // 6. Check Ban Status & Write Telemetry Record to Firestore
            const deviceRef = doc(db, "devices", deviceId);

            try {
                const docSnap = await getDoc(deviceRef);
                if (docSnap.exists()) {
                    const record = docSnap.data();
                    if (record.isBanned) {
                        enforceBanScreen();
                        window.__ASTRONG_BAN_VERIFIED__ = true;
                        window.dispatchEvent(new CustomEvent('astrong-ban-verified'));
                        return;
                    }
                }
            } catch (err) {
                if (err.code === 'permission-denied' || (err.message && err.message.includes('permissions'))) {
                    console.warn(`[Telemetry] Firestore Security Rules Warning: Unauthenticated access to "/devices/${deviceId}" was denied. Ensure Firestore Rules allow get access for /devices/{deviceId}.`);
                }
            } finally {
                window.__ASTRONG_BAN_VERIFIED__ = true;
                window.dispatchEvent(new CustomEvent('astrong-ban-verified'));
            }

            await setDoc(deviceRef, devicePayload, { merge: true }).catch(() => { });

            // 7. Periodic Telemetry Heartbeat & User Activity Listeners (Every 30s & on interaction)
            async function sendHeartbeat() {
                try {
                    let currentBattery = batteryInfo;
                    if (typeof navigator.getBattery === 'function') {
                        try {
                            const b = await navigator.getBattery();
                            currentBattery = {
                                level: Math.round(b.level * 100),
                                charging: b.charging,
                                chargingTime: b.chargingTime !== Infinity ? b.chargingTime : null,
                                dischargingTime: b.dischargingTime !== Infinity ? b.dischargingTime : null
                            };
                        } catch (e) { }
                    }

                    let currentConn = connectionInfo;
                    if (navigator.connection) {
                        currentConn = {
                            effectiveType: navigator.connection.effectiveType || 'Unknown',
                            downlink: navigator.connection.downlink || null,
                            rtt: navigator.connection.rtt || null,
                            saveData: !!navigator.connection.saveData
                        };
                    }

                    const heartbeatPayload = {
                        meta: {
                            lastSeen: new Date().toISOString(),
                            updatedAt: serverTimestamp(),
                            lastPath: window.location.pathname,
                            engagement: {
                                activeDwellSec: activeDwellSec,
                                backgroundDwellSec: backgroundDwellSec,
                                tabVisibility: document.visibilityState || 'visible'
                            }
                        },
                        battery: currentBattery,
                        network: {
                            connectionType: currentConn.effectiveType,
                            downlinkMbps: currentConn.downlink,
                            rttMs: currentConn.rtt,
                            saveData: currentConn.saveData
                        },
                        hardware: {
                            viewportWidth: window.innerWidth,
                            viewportHeight: window.innerHeight,
                            inputModality: inputModality
                        }
                    };

                    await setDoc(deviceRef, heartbeatPayload, { merge: true });

                    // Check ban status on heartbeat
                    const checkSnap = await getDoc(deviceRef).catch(() => null);
                    if (checkSnap && checkSnap.exists()) {
                        const isBanned = !!checkSnap.data().isBanned;
                        if (isBanned) {
                            enforceBanScreen();
                        }
                    }
                } catch (err) { }
            }

            // Send periodic heartbeat every 30 seconds
            setInterval(sendHeartbeat, 30000);

            // Send immediate heartbeat on visibility or window focus/blur
            document.addEventListener('visibilitychange', () => {
                sendHeartbeat();
            });

            window.addEventListener('focus', () => {
                sendHeartbeat();
            });

            window.addEventListener('blur', () => {
                sendHeartbeat();
            });

            // Send telemetry update on SPA navigation (history popstate)
            window.addEventListener('popstate', () => {
                const pathPayload = {
                    meta: {
                        lastSeen: new Date().toISOString(),
                        updatedAt: serverTimestamp(),
                        lastPath: window.location.pathname,
                        engagement: {
                            activeDwellSec: activeDwellSec,
                            backgroundDwellSec: backgroundDwellSec,
                            tabVisibility: document.visibilityState || 'visible'
                        }
                    },
                    recentViews: arrayUnion({
                        url: window.location.href,
                        path: window.location.pathname,
                        title: document.title,
                        timestamp: new Date().toISOString(),
                        referrer: document.referrer || 'Direct'
                    })
                };
                setDoc(deviceRef, pathPayload, { merge: true }).catch(() => { });
            });

        } catch (error) {
            console.error('[Telemetry] Error logging device telemetry:', error);
        }
    })();

    function enforceBanScreen() {
        window.__ASTRONG_BANNED__ = true;

        try {
            if (window.stop) window.stop();
        } catch (e) { }

        // Ensure banned loading screen style is present in head
        if (!document.getElementById('astrong-banned-loading-style')) {
            const style = document.createElement('style');
            style.id = 'astrong-banned-loading-style';
            style.textContent = `
                html, body {
                    background-color: #121016 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                }
                #astrong-loading-screen {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background-color: #121016 !important;
                    display: flex !important;
                    justify-content: center !important;
                    align-items: center !important;
                    z-index: 2147483647 !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    pointer-events: all !important;
                }
                .loading-spinner {
                    width: 58px !important;
                    height: 58px !important;
                    animation: banned-spin 1.2s linear infinite !important;
                    will-change: transform !important;
                }
                .loading-device-id {
                    position: absolute !important;
                    bottom: 16px !important;
                    right: 20px !important;
                    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                    font-size: 0.75rem !important;
                    color: #eb3f56 !important;
                    letter-spacing: 0.05em !important;
                    user-select: none !important;
                    -webkit-user-select: none !important;
                    z-index: 2147483648 !important;
                    cursor: pointer !important;
                    transition: color 0.2s ease !important;
                }
                .loading-device-id:hover {
                    color: #ff6b7e !important;
                }
                @keyframes banned-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        const activeDevId = window.__ASTRONG_DEVICE_ID__ || localStorage.getItem('astrong_device_id') || '';
        const devIdMarkup = `<div class="loading-device-id banned" id="loading-device-id"><span>${activeDevId}</span></div>`;
        const loaderSvgHtml = '<svg viewBox="0 0 1 1" class="loading-spinner"><path d="M0.3955 0.0590C0.4007 0.0547 0.4033 0.0526 0.4057 0.0508C0.4615 0.0081 0.5385 0.0081 0.5943 0.0508C0.5967 0.0526 0.5993 0.0547 0.6045 0.0590C0.6068 0.0609 0.6079 0.0619 0.6091 0.0628C0.6354 0.0837 0.6675 0.0955 0.7010 0.0966C0.7024 0.0966 0.7039 0.0966 0.7069 0.0967C0.7136 0.0968 0.7170 0.0968 0.7199 0.0970C0.7898 0.1005 0.8488 0.1506 0.8644 0.2195C0.8651 0.2224 0.8657 0.2257 0.8670 0.2324C0.8675 0.2353 0.8678 0.2368 0.8681 0.2383C0.8749 0.2713 0.8921 0.3013 0.9170 0.3238C0.9181 0.3248 0.9192 0.3258 0.9215 0.3277C0.9265 0.3321 0.9959 0.4612 0.9640 0.5241C0.9627 0.5267 0.9610 0.5297 0.9577 0.5356C0.9563 0.5382 0.9556 0.5396 0.9549 0.5409C0.9391 0.5706 0.9331 0.6047 0.9379 0.6381C0.9381 0.6396 0.9383 0.6411 0.9388 0.6440C0.9399 0.6507 0.9404 0.6541 0.9408 0.6570C0.9495 0.7272 0.9109 0.7946 0.8465 0.8221C0.8438 0.8232 0.8406 0.8244 0.8343 0.8268C0.8315 0.8279 0.8301 0.8284 0.8288 0.8290C0.7978 0.8415 0.7715 0.8638 0.7539 0.8925C0.7531 0.8937 0.7524 0.8950 0.7508 0.8976C0.7474 0.9034 0.7457 0.9063 0.7441 0.9089C0.7061 0.9682 0.6337 0.9948 0.5668 0.9740C0.5640 0.9732 0.5608 0.9720 0.5545 0.9698C0.5517 0.9688 0.5503 0.9683 0.5489 0.9679C0.5171 0.9573 0.4829 0.9573 0.4511 0.9679C0.4497 0.9683 0.4483 0.9688 0.4455 0.9698C0.4392 0.9720 0.4360 0.9732 0.4332 0.9740C0.3663 0.9948 0.2939 0.9682 0.2559 0.9089C0.2543 0.9063 0.2526 0.9034 0.2492 0.8976C0.2476 0.8950 0.2469 0.8937 0.2461 0.8925C0.2285 0.8638 0.2022 0.8415 0.1712 0.8290C0.1699 0.8284 0.1685 0.8279 0.1657 0.8268C0.1594 0.8244 0.1562 0.8232 0.1535 0.8221C0.0891 0.7946 0.0505 0.7272 0.0592 0.6570C0.0596 0.6541 0.0601 0.6507 0.0612 0.6440C0.0617 0.6411 0.0619 0.6396 0.0621 0.6381C0.0669 0.6047 0.0609 0.5706 0.0451 0.5409C0.0444 0.5396 0.0437 0.5382 0.0423 0.5356C0.0390 0.5297 0.0373 0.5267 0.0360 0.5241C0.0041 0.4612 0.0175 0.3845 0.0687 0.3364C0.0709 0.3343 0.0735 0.3321 0.0785 0.3277C0.0808 0.3258 0.0819 0.3248 0.0830 0.3238C0.1079 0.3013 0.1251 0.2713 0.1319 0.2383C0.1322 0.2368 0.1325 0.2353 0.1330 0.2324C0.1343 0.2257 0.1349 0.2224 0.1356 0.2195C0.1512 0.1506 0.2102 0.1005 0.2801 0.0970C0.2830 0.0968 0.2864 0.0968 0.2931 0.0967C0.2961 0.0966 0.2976 0.0966 0.2990 0.0966C0.3325 0.0955 0.3646 0.0837 0.3909 0.0628C0.3921 0.0619 0.3932 0.0609 0.3955 0.0590Z" fill="#ffffff" /></svg>' + devIdMarkup;

        function purgeAndLock() {
            if (!document.body) return;
            let loader = document.getElementById('astrong-loading-screen');
            if (!loader) {
                loader = document.createElement('div');
                loader.id = 'astrong-loading-screen';
            }
            loader.innerHTML = loaderSvgHtml;
            loader.className = '';
            loader.removeAttribute('style');

            // Delete everything under document.body so no site elements exist in the DOM
            document.body.replaceChildren(loader);
        }

        purgeAndLock();

        // Guard against DevTools deletion or DOM un-hiding modifications
        if (!window.__astrong_ban_observer) {
            const observer = new MutationObserver(() => {
                if (window.__ASTRONG_BANNED__) {
                    const loader = document.getElementById('astrong-loading-screen');
                    if (!loader || document.body.children.length !== 1 || document.body.firstElementChild !== loader) {
                        purgeAndLock();
                    }
                }
            });
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
                window.__astrong_ban_observer = observer;
            }
        }
    }

    // 0. Universal Loading Screen
    (function () {
        let loader = null;
        const initialDevId = (!isSubdomain ? (localStorage.getItem('astrong_device_id') || '') : '') || getRootCookie('astrong_device_id') || '';
        const devIdMarkup = `<div class="loading-device-id" id="loading-device-id"><span>${initialDevId}</span></div>`;

        // Inject loading screen styles unconditionally for both static & dynamic loaders
        if (!document.getElementById('astrong-loading-style')) {
            const style = document.createElement('style');
            style.id = 'astrong-loading-style';
            style.textContent = `
                #astrong-loading-screen {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    background-color: var(--background, #121016);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 999999;
                    opacity: 1;
                    transition: opacity 0.3s ease, visibility 0.3s ease;
                    visibility: visible;
                }
                #astrong-loading-screen.fade-out {
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none !important;
                }
                .loading-spinner {
                    width: 58px;
                    height: 58px;
                    animation: loading-spin 1.2s linear infinite;
                    will-change: transform;
                }
                .loading-device-id {
                    position: absolute;
                    bottom: 16px;
                    right: 20px;
                    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 0.75rem;
                    color: rgba(255, 255, 255, 0.4);
                    letter-spacing: 0.05em;
                    user-select: none;
                    -webkit-user-select: none;
                    z-index: 10;
                    cursor: pointer;
                    transition: color 0.2s ease;
                }
                .loading-device-id:hover {
                    color: rgba(255, 255, 255, 0.85);
                }
                @keyframes loading-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        function createOrEnsureLoader() {
            let el = document.getElementById('astrong-loading-screen');
            if (!el) {
                el = document.createElement('div');
                el.id = 'astrong-loading-screen';
                el.innerHTML = '<svg viewBox="0 0 1 1" class="loading-spinner"><path d="M0.3955 0.0590C0.4007 0.0547 0.4033 0.0526 0.4057 0.0508C0.4615 0.0081 0.5385 0.0081 0.5943 0.0508C0.5967 0.0526 0.5993 0.0547 0.6045 0.0590C0.6068 0.0609 0.6079 0.0619 0.6091 0.0628C0.6354 0.0837 0.6675 0.0955 0.7010 0.0966C0.7024 0.0966 0.7039 0.0966 0.7069 0.0967C0.7136 0.0968 0.7170 0.0968 0.7199 0.0970C0.7898 0.1005 0.8488 0.1506 0.8644 0.2195C0.8651 0.2224 0.8657 0.2257 0.8670 0.2324C0.8675 0.2353 0.8678 0.2368 0.8681 0.2383C0.8749 0.2713 0.8921 0.3013 0.9170 0.3238C0.9181 0.3248 0.9192 0.3258 0.9215 0.3277C0.9265 0.3321 0.9291 0.3343 0.9313 0.3364C0.9825 0.3845 0.9959 0.4612 0.9640 0.5241C0.9627 0.5267 0.9610 0.5297 0.9577 0.5356C0.9563 0.5382 0.9556 0.5396 0.9549 0.5409C0.9391 0.5706 0.9331 0.6047 0.9379 0.6381C0.9381 0.6396 0.9383 0.6411 0.9388 0.6440C0.9399 0.6507 0.9404 0.6541 0.9408 0.6570C0.9495 0.7272 0.9109 0.7946 0.8465 0.8221C0.8438 0.8232 0.8406 0.8244 0.8343 0.8268C0.8315 0.8279 0.8301 0.8284 0.8288 0.8290C0.7978 0.8415 0.7715 0.8638 0.7539 0.8925C0.7531 0.8937 0.7524 0.8950 0.7508 0.8976C0.7474 0.9034 0.7457 0.9063 0.7441 0.9089C0.7061 0.9682 0.6337 0.9948 0.5668 0.9740C0.5640 0.9732 0.5608 0.9720 0.5545 0.9698C0.5517 0.9688 0.5503 0.9683 0.5489 0.9679C0.5171 0.9573 0.4829 0.9573 0.4511 0.9679C0.4497 0.9683 0.4483 0.9688 0.4455 0.9698C0.4392 0.9720 0.4360 0.9732 0.4332 0.9740C0.3663 0.9948 0.2939 0.9682 0.2559 0.9089C0.2543 0.9063 0.2526 0.9034 0.2492 0.8976C0.2476 0.8950 0.2469 0.8937 0.2461 0.8925C0.2285 0.8638 0.2022 0.8415 0.1712 0.8290C0.1699 0.8284 0.1685 0.8279 0.1657 0.8268C0.1594 0.8244 0.1562 0.8232 0.1535 0.8221C0.0891 0.7946 0.0505 0.7272 0.0592 0.6570C0.0596 0.6541 0.0601 0.6507 0.0612 0.6440C0.0617 0.6411 0.0619 0.6396 0.0621 0.6381C0.0669 0.6047 0.0609 0.5706 0.0451 0.5409C0.0444 0.5396 0.0437 0.5382 0.0423 0.5356C0.0390 0.5297 0.0373 0.5267 0.0360 0.5241C0.0041 0.4612 0.0175 0.3845 0.0687 0.3364C0.0709 0.3343 0.0735 0.3321 0.0785 0.3277C0.0808 0.3258 0.0819 0.3248 0.0830 0.3238C0.1079 0.3013 0.1251 0.2713 0.1319 0.2383C0.1322 0.2368 0.1325 0.2353 0.1330 0.2324C0.1343 0.2257 0.1349 0.2224 0.1356 0.2195C0.1512 0.1506 0.2102 0.1005 0.2801 0.0970C0.2830 0.0968 0.2864 0.0968 0.2931 0.0967C0.2961 0.0966 0.2976 0.0966 0.2990 0.0966C0.3325 0.0955 0.3646 0.0837 0.3909 0.0628C0.3921 0.0619 0.3932 0.0609 0.3955 0.0590Z" fill="#ffffff" /></svg>';
            }
            if (!el.querySelector('#loading-device-id')) {
                el.insertAdjacentHTML('beforeend', devIdMarkup);
            }
            if (document.body && !document.body.contains(el)) {
                document.body.insertBefore(el, document.body.firstChild);
            }
            loader = el;
            return el;
        }

        loader = createOrEnsureLoader();

        // Handle page load and fade out loader
        let startTime = performance.now();
        const minDuration = 100; // minimum duration in ms (reduced from 400ms for faster page loads)

        let isWindowLoaded = false;
        let isScheduleDecided = !window.__ASTRONG_WAIT_FOR_SCHEDULE__ || window.__ASTRONG_SCHEDULE_READY__ === true;
        let isPrerequisitesReady = false;
        let hideTimeoutId = null;

        function checkHomeReady() {
            if (document.getElementById('live-status-bar') || window.__ASTRONG_WAIT_FOR_HOME_READY__) {
                return window.__ASTRONG_HOME_READY__ === true;
            }
            return true;
        }

        async function waitPrerequisites() {
            const promises = [];

            // 1. Wait for document fonts
            if (document.fonts && document.fonts.ready) {
                promises.push(document.fonts.ready.catch(() => {}));
            }

            // 2. Wait for profile picture image(s) to load & decode
            const pfps = Array.from(document.querySelectorAll('.pfp-wrapper img, .pfp-wrapper-small img, img.pfp'));
            pfps.forEach(img => {
                if (!img.complete) {
                    promises.push(new Promise(resolve => {
                        img.addEventListener('load', resolve, { once: true });
                        img.addEventListener('error', resolve, { once: true });
                        if (typeof img.decode === 'function') {
                            img.decode().then(resolve).catch(resolve);
                        }
                    }));
                }
            });

            // 3. Wait for homepage availability status if on homepage
            if (document.getElementById('live-status-bar') || window.__ASTRONG_WAIT_FOR_HOME_READY__) {
                if (window.__ASTRONG_HOME_READY__ !== true) {
                    promises.push(new Promise(resolve => {
                        window.addEventListener('astrong-home-ready', resolve, { once: true });
                    }));
                }
            }

            try {
                await Promise.race([
                    Promise.allSettled(promises),
                    new Promise(resolve => setTimeout(resolve, 3500))
                ]);
            } catch (e) {}

            isPrerequisitesReady = true;
            tryHideLoader();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', waitPrerequisites);
        } else {
            waitPrerequisites();
        }

        function tryHideLoader() {
            if (window.__ASTRONG_BANNED__) return;
            const isBanVerified = window.__ASTRONG_BAN_VERIFIED__ === true;
            const isScheduleReady = isScheduleDecided || !window.__ASTRONG_WAIT_FOR_SCHEDULE__ || window.__ASTRONG_SCHEDULE_READY__ === true;
            const isHomeReady = checkHomeReady();

            if (isWindowLoaded && isBanVerified && isScheduleReady && isPrerequisitesReady && isHomeReady) {
                const elapsed = performance.now() - startTime;
                const remaining = Math.max(0, minDuration - elapsed);
                if (hideTimeoutId) clearTimeout(hideTimeoutId);
                hideTimeoutId = setTimeout(() => {
                    if (window.__ASTRONG_BANNED__) return;
                    if (loader) {
                        loader.classList.add('fade-out');
                        setTimeout(() => {
                            if (loader && loader.parentNode && !window.__ASTRONG_BANNED__) {
                                loader.parentNode.removeChild(loader);
                            }
                        }, 300);
                    }
                }, remaining);
            }
        }

        function prepareLoaderForDisplay() {
            const el = createOrEnsureLoader();
            el.classList.remove('fade-out');
        }

        // Prepare loader before page unloads so bfcache snapshots include the visible loader
        window.addEventListener('pagehide', () => {
            prepareLoaderForDisplay();
        });

        // Trigger loading screen animation on back/forward navigation (or page restore)
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                prepareLoaderForDisplay();
                startTime = performance.now();
                isWindowLoaded = true;
                isScheduleDecided = true;
                isPrerequisitesReady = true;
                window.__ASTRONG_BAN_VERIFIED__ = true;
                window.__ASTRONG_SCHEDULE_READY__ = true;
                window.__ASTRONG_HOME_READY__ = true;
                tryHideLoader();
            }
        });

        window.addEventListener('load', () => {
            isWindowLoaded = true;
            tryHideLoader();
        });

        window.addEventListener('astrong-ban-verified', () => {
            tryHideLoader();
        });

        window.addEventListener('astrong-schedule-ready', () => {
            isScheduleDecided = true;
            window.__ASTRONG_SCHEDULE_READY__ = true;
            tryHideLoader();
        });

        window.addEventListener('astrong-home-ready', () => {
            tryHideLoader();
        });

        // Safety fallback in case network resources take unusually long
        const fallbackDelay = 4000;
        setTimeout(() => {
            if (loader && !loader.classList.contains('fade-out')) {
                isWindowLoaded = true;
                isScheduleDecided = true;
                isPrerequisitesReady = true;
                window.__ASTRONG_BAN_VERIFIED__ = true;
                window.__ASTRONG_SCHEDULE_READY__ = true;
                window.__ASTRONG_HOME_READY__ = true;
                tryHideLoader();
            }
        }, fallbackDelay);
    })();

    // Cookie helpers
    function getThemeCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function setThemeCookie(name, val) {
        const hostname = window.location.hostname;
        const domainStr = hostname.endsWith('astrong.xyz') ? '; domain=.astrong.xyz' : '';
        document.cookie = `${name}=${val}; path=/; max-age=31536000; SameSite=Lax; Secure${domainStr}`;
    }

    // 1. Theme Loader
    const isSubdomainHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
    const savedAccent = getThemeCookie('astrong_accent') || (!isSubdomainHost ? localStorage.getItem('astrong_accent') : null) || 'purple';
    const savedMode = getThemeCookie('astrong_mode') || (!isSubdomainHost ? localStorage.getItem('astrong_mode') : null) || 'dark';
    let isInitialThemeApplied = false;

    function applyTheme(accent, mode) {
        if (!accent) {
            accent = getThemeCookie('astrong_accent') || (!isSubdomainHost ? localStorage.getItem('astrong_accent') : null) || 'purple';
        }
        if (!mode) {
            mode = getThemeCookie('astrong_mode') || (!isSubdomainHost ? localStorage.getItem('astrong_mode') : null) || 'dark';
        }

        if (isInitialThemeApplied) {
            document.documentElement.classList.add('theme-switching');
            if (window.__themeSwitchTimer) clearTimeout(window.__themeSwitchTimer);
            window.__themeSwitchTimer = setTimeout(() => {
                document.documentElement.classList.remove('theme-switching');
            }, 350);
        } else {
            isInitialThemeApplied = true;
        }

        if (mode === 'light') {
            document.documentElement.classList.add('light-mode');
            document.documentElement.style.setProperty('--background', '#fbf8fd');
            document.documentElement.style.setProperty('--surface', '#f3eff4');
            document.documentElement.style.setProperty('--surface-variant', '#e7e0ec');
            document.documentElement.style.setProperty('--on-surface', '#1d1b20');
            document.documentElement.style.setProperty('--on-surface-variant', '#49454f');
            document.documentElement.style.setProperty('--outline', '#79747e');
            document.documentElement.style.setProperty('--card-icon-bg', 'rgba(0, 0, 0, 0.05)');
        } else {
            document.documentElement.classList.remove('light-mode');
            document.documentElement.style.setProperty('--background', '#121016');
            document.documentElement.style.setProperty('--surface', '#1d1b20');
            document.documentElement.style.setProperty('--surface-variant', '#2d2a33');
            document.documentElement.style.setProperty('--on-surface', '#e6e1e5');
            document.documentElement.style.setProperty('--on-surface-variant', '#cac4d0');
            document.documentElement.style.setProperty('--outline', '#49454f');
            document.documentElement.style.setProperty('--card-icon-bg', 'rgba(255, 255, 255, 0.05)');
        }

        const themes = {
            dark: {
                red: { primary: '#eb3f56', container: '#801323', onPrimary: '#ffffff', onPrimaryContainer: '#ffffff' },
                orange: { primary: '#ff7524', container: '#8c3000', onPrimary: '#ffffff', onPrimaryContainer: '#ffffff' },
                yellow: { primary: '#f5b500', container: '#5f4600', onPrimary: '#ffffff', onPrimaryContainer: '#ffffff' },
                green: { primary: '#00c853', container: '#1b5e20', onPrimary: '#ffffff', onPrimaryContainer: '#ffffff' },
                blue: { primary: '#00b0ff', container: '#005780', onPrimary: '#ffffff', onPrimaryContainer: '#ffffff' },
                purple: { primary: '#8859ff', container: '#4527a0', onPrimary: '#ffffff', onPrimaryContainer: '#ffffff' },
                white: { primary: '#ffffff', container: '#444444', onPrimary: '#121016', onPrimaryContainer: '#ffffff' }
            },
            light: {
                red: { primary: '#b32638', container: '#fce8ea', onPrimary: '#ffffff', onPrimaryContainer: '#74101c' },
                orange: { primary: '#ad4b03', container: '#fff0e6', onPrimary: '#ffffff', onPrimaryContainer: '#591e00' },
                yellow: { primary: '#8f6a00', container: '#fff5cc', onPrimary: '#ffffff', onPrimaryContainer: '#2f2300' },
                green: { primary: '#155229', container: '#e5f7eb', onPrimary: '#ffffff', onPrimaryContainer: '#06160b' },
                blue: { primary: '#0b579c', container: '#e3f2fd', onPrimary: '#ffffff', onPrimaryContainer: '#05225c' },
                purple: { primary: '#6536ec', container: '#f2edff', onPrimary: '#ffffff', onPrimaryContainer: '#21005d' },
                white: { primary: '#1d1b20', container: '#e6e1e5', onPrimary: '#ffffff', onPrimaryContainer: '#1d1b20' }
            }
        };
        const theme = (themes[mode] && themes[mode][accent]) ? themes[mode][accent] : themes['dark']['purple'];
        if (theme) {
            document.documentElement.style.setProperty('--primary', theme.primary);
            document.documentElement.style.setProperty('--primary-container', theme.container);
            document.documentElement.style.setProperty('--on-primary', theme.onPrimary);
            document.documentElement.style.setProperty('--on-primary-container', theme.onPrimaryContainer);
            console.log(`[Theme] Applied "${accent}" accent in ${mode} mode`);
        }

        try {
            if (!isSubdomainHost) {
                if (localStorage.getItem('astrong_accent') !== accent) {
                    localStorage.setItem('astrong_accent', accent);
                }
                if (localStorage.getItem('astrong_mode') !== mode) {
                    localStorage.setItem('astrong_mode', mode);
                }
            }
            if (getThemeCookie('astrong_accent') !== accent) {
                setThemeCookie('astrong_accent', accent);
            }
            if (getThemeCookie('astrong_mode') !== mode) {
                setThemeCookie('astrong_mode', mode);
            }
        } catch (e) {
            console.error('[Theme] Error syncing theme settings:', e);
        }

        syncSettingsUI(accent, mode);
    }

    function syncSettingsUI(accent, mode) {
        if (!accent) {
            accent = getThemeCookie('astrong_accent') || localStorage.getItem('astrong_accent') || 'purple';
        }
        if (!mode) {
            mode = getThemeCookie('astrong_mode') || localStorage.getItem('astrong_mode') || 'dark';
        }

        const themeTogglePill = document.getElementById('theme-toggle-pill');
        if (themeTogglePill) {
            themeTogglePill.setAttribute('data-active', mode);
        }

        const accentSelect = document.getElementById('accent-select');
        if (accentSelect) {
            const optionsEl = document.querySelector('.select-options');
            const optionsScope = optionsEl || accentSelect;

            const whiteOption = optionsScope.querySelector('.option-white');
            if (whiteOption) {
                whiteOption.textContent = mode === 'light' ? 'Black' : 'White';
            }

            const options = optionsScope.querySelectorAll('.select-option');
            options.forEach(opt => {
                if (opt.getAttribute('data-value') === accent) {
                    opt.classList.add('selected');
                } else {
                    opt.classList.remove('selected');
                }
            });

            const activeOption = optionsScope.querySelector(`.select-option[data-value="${accent}"]`);
            const triggerText = accentSelect.querySelector('.select-trigger-text');
            if (activeOption && triggerText) {
                triggerText.textContent = activeOption.textContent;
                setTimeout(() => {
                    if (activeOption && triggerText) {
                        triggerText.style.color = window.getComputedStyle(activeOption).color;
                    }
                }, 0);
            }
        }
    }
    window.applyTheme = applyTheme;
    window.syncSettingsUI = syncSettingsUI;

    // 2. Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
        // Allow Cmd+K or Ctrl+K for Command Palette anywhere
        if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyK' || (e.key && e.key.toLowerCase() === 'k'))) {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Shortcuts] Command Palette shortcut (Ctrl+K/Cmd+K) triggered');
            if (typeof initCommandPalette === 'function') {
                initCommandPalette();
            }
            if (window.toggleCommandPalette) {
                window.toggleCommandPalette();
            }
            return;
        }

        if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
            return; // Ignore shortcuts if any modifier key is held
        }

        const activeEl = document.activeElement;
        if (activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable
        )) {
            return; // Ignore shortcuts when typing in inputs
        }

        if (e.key === 'Escape') {
            const backLink = document.querySelector('.back-link');
            if (backLink) {
                backLink.click();
            }
        }
    }, true);

    function cycleThemeAccent() {
        const isSubHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
        const currentAccent = getThemeCookie('astrong_accent') || (!isSubHost ? localStorage.getItem('astrong_accent') : null) || 'purple';
        const order = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white'];
        const nextIdx = (order.indexOf(currentAccent) + 1) % order.length;
        const nextAccent = order[nextIdx];

        if (!isSubHost) {
            try { localStorage.setItem('astrong_accent', nextAccent); } catch (e) { }
        }
        setThemeCookie('astrong_accent', nextAccent);
        console.log(`[Theme] Cycled accent to "${nextAccent}"`);
        applyTheme(nextAccent);

        // Update dot selection UI on homepage if we are on it
        const dots = document.querySelectorAll('.theme-dot');
        dots.forEach(dot => {
            if (dot.getAttribute('data-theme') === nextAccent) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    // 3. Toast / Snackbar Notification System
    window.showToast = function (message, type = 'info', duration = 2500) {
        if (typeof type === 'number') {
            duration = type;
            type = 'info';
        }

        const existingToast = document.querySelector('.astrong-toast');
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement('div');
        toast.className = `astrong-toast astrong-toast-${type}`;
        toast.textContent = message;

        // Color palettes for semantic feedback
        let bg = 'var(--surface-variant, #2d2a33)';
        let border = 'var(--primary, #8859ff)';
        let textColor = 'var(--on-surface, #e6e1e5)';

        if (type === 'success') {
            bg = '#14532d';
            border = '#22c55e';
            textColor = '#dcfce7';
        } else if (type === 'error' || type === 'failure') {
            bg = '#7f1d1d';
            border = '#ef4444';
            textColor = '#fee2e2';
        } else if (type === 'warning') {
            bg = '#78350f';
            border = '#f59e0b';
            textColor = '#fef3c7';
        }

        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%) translateY(16px)',
            maxWidth: 'min(90vw, 460px)',
            width: 'max-content',
            background: bg,
            color: textColor,
            border: `1px solid ${border}`,
            borderRadius: '12px',
            padding: '0.65rem 1.25rem',
            fontSize: '0.85rem',
            fontWeight: '600',
            textAlign: 'center',
            boxSizing: 'border-box',
            zIndex: '2147483647',
            opacity: '0',
            transition: 'opacity 0.22s cubic-bezier(0.2, 0, 0, 1), transform 0.22s cubic-bezier(0.2, 0, 0, 1)',
            pointerEvents: 'auto',
            touchAction: 'pan-y',
            cursor: 'grab',
            userSelect: 'none',
            webkitUserSelect: 'none'
        });

        // Swipe away functionality (left or right)
        let touchStartX = 0;
        let currentDeltaX = 0;
        let isSwiping = false;
        let dismissTimer = null;

        const dismissToast = (direction = 0) => {
            if (dismissTimer) clearTimeout(dismissTimer);
            toast.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease';
            toast.style.opacity = '0';
            if (direction !== 0) {
                toast.style.transform = `translateX(calc(-50% + ${direction * 120}px)) translateY(0)`;
            } else {
                toast.style.transform = 'translateX(-50%) translateY(-8px)';
            }
            setTimeout(() => toast.remove(), 200);
        };

        toast.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            touchStartX = e.touches[0].clientX;
            currentDeltaX = 0;
            isSwiping = true;
            toast.style.transition = 'none';
            if (dismissTimer) clearTimeout(dismissTimer);
        }, { passive: true });

        toast.addEventListener('touchmove', (e) => {
            if (!isSwiping || e.touches.length !== 1) return;
            currentDeltaX = e.touches[0].clientX - touchStartX;
            const progress = Math.min(Math.abs(currentDeltaX) / 100, 1);
            toast.style.transform = `translateX(calc(-50% + ${currentDeltaX}px)) translateY(0)`;
            toast.style.opacity = String(1 - progress * 0.7);
        }, { passive: true });

        toast.addEventListener('touchend', () => {
            if (!isSwiping) return;
            isSwiping = false;
            if (Math.abs(currentDeltaX) > 40) {
                dismissToast(currentDeltaX > 0 ? 1 : -1);
            } else {
                toast.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease';
                toast.style.transform = 'translateX(-50%) translateY(0)';
                toast.style.opacity = '1';
                dismissTimer = setTimeout(() => dismissToast(0), 1800);
            }
        });

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 10);

        dismissTimer = setTimeout(() => {
            dismissToast(0);
        }, duration);
    };

    // Initialize Click to Copy Device ID immediately for both loading screen and help menu
    initDeviceIdCopyHandler();

    // 4. Initialize DOM Features
    function initUniversalDomFeatures() {
        syncSettingsUI();



        // B. Context Menu
        initContextMenu();

        // C. Triple Click Version Tag Control Panel Trigger
        initVersionTagControlTrigger();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUniversalDomFeatures);
    } else {
        initUniversalDomFeatures();
    }

    function initDeviceIdCopyHandler() {
        document.addEventListener('click', (e) => {
            const target = e.target.closest('#help-device-id, #loading-device-id, .loading-device-id, .debug-item code, .device-id-display');
            if (!target) return;

            let devId = target.textContent.trim();
            if (!devId || devId === '--------') {
                devId = window.__ASTRONG_DEVICE_ID__ || localStorage.getItem('astrong_device_id') || '';
            }

            if (devId && devId !== '--------') {
                console.log(`[Device] Copied Device ID to clipboard: ${devId}`);
                const notify = () => {
                    if (window.showToast) {
                        window.showToast('Copied Device ID to clipboard', 'success');
                    }
                };

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(devId).then(notify).catch(() => {
                        fallbackCopyText(devId, notify);
                    });
                } else {
                    fallbackCopyText(devId, notify);
                }
            }
        });
    }

    function fallbackCopyText(text, callback) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            if (callback) callback();
        } catch (err) { }
        document.body.removeChild(textArea);
    }

    function initVersionTagControlTrigger() {
        let versionClickCount = 0;
        let versionClickTimer = null;

        document.addEventListener('click', (e) => {
            const versionTag = e.target.closest('.version-tag');
            if (!versionTag) return;

            versionClickCount++;
            if (versionClickTimer) clearTimeout(versionClickTimer);

            if (versionClickCount >= 3) {
                versionClickCount = 0;
                console.log('[Navigation] Triple click detected on version tag. Opening control panel...');
                window.location.href = 'https://control.astrong.xyz';
            } else {
                versionClickTimer = setTimeout(() => {
                    versionClickCount = 0;
                }, 500);
            }
        });
    }

    function initContextMenu() {
        let menu = document.querySelector('.custom-context-menu');
        if (!menu) {
            menu = document.createElement('div');
            menu.className = 'custom-context-menu';
            Object.assign(menu.style, {
                position: 'fixed',
                background: 'var(--surface-variant, #2d2a33)',
                border: '1px solid var(--outline, #49454f)',
                borderRadius: '14px',
                padding: '6px',
                minWidth: '170px',
                zIndex: '10000',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                backdropFilter: 'blur(12px)',
                webkitBackdropFilter: 'blur(12px)',
                display: 'none',
                flexDirection: 'column',
                gap: '2px',
                userSelect: 'none',
                webkitUserSelect: 'none'
            });
            document.body.appendChild(menu);
        }

        function deleteSelectedText(el) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const start = el.selectionStart;
                const end = el.selectionEnd;
                const val = el.value;
                el.value = val.substring(0, start) + val.substring(end);
                el.setSelectionRange(start, start);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                const sel = window.getSelection();
                if (sel) {
                    sel.deleteFromDocument();
                }
            }
        }

        function insertTextAtCursor(el, text) {
            if (!text) return;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                const start = el.selectionStart;
                const end = el.selectionEnd;
                const val = el.value;
                el.value = val.substring(0, start) + text + val.substring(end);
                const newCursorPos = start + text.length;
                el.setSelectionRange(newCursorPos, newCursorPos);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else if (el.isContentEditable) {
                el.focus();
                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    const textNode = document.createTextNode(text);
                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.setEndAfter(textNode);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        }

        function createMenuItem(it) {
            if (it.type === 'separator') {
                const sep = document.createElement('div');
                Object.assign(sep.style, {
                    height: '1px',
                    background: 'var(--outline, #49454f)',
                    margin: '6px 4px'
                });
                return sep;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'menu-item-wrapper';
            Object.assign(wrapper.style, {
                position: 'relative',
                width: '100%'
            });

            const container = document.createElement('div');
            container.className = 'menu-item-container';
            Object.assign(container.style, {
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '8px',
                transition: 'background-color 0.12s ease, color 0.12s ease',
                color: 'var(--on-surface, #e6e1e5)',
                position: 'relative',
                boxSizing: 'border-box'
            });

            const mainBtn = document.createElement('button');
            mainBtn.className = 'menu-item-main-btn';
            Object.assign(mainBtn.style, {
                flex: '1',
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                padding: '7px 12px',
                fontSize: '0.85rem',
                fontWeight: '500',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                userSelect: 'none',
                webkitUserSelect: 'none',
                borderRadius: '8px 0 0 8px',
                outline: 'none',
                fontFamily: 'inherit'
            });

            const labelSpan = document.createElement('span');
            labelSpan.textContent = it.label;
            mainBtn.appendChild(labelSpan);
            container.appendChild(mainBtn);

            let submenu = null;
            let submenuInner = null;
            let leaveTimeout = null;
            let chevronBtn = null;

            function positionSubmenu() {
                if (!submenu || !submenuInner) return;
                submenu.style.display = 'block';

                const menuRect = menu.getBoundingClientRect();
                const wrapperRect = wrapper.getBoundingClientRect();
                const submenuWidth = submenuInner.offsetWidth || 170;
                const submenuHeight = submenuInner.offsetHeight || 180;

                const VISIBLE_GAP = 8;

                const menuRight = menuRect.width > 0 ? menuRect.right : wrapperRect.right + 6;
                const menuLeft = menuRect.width > 0 ? menuRect.left : wrapperRect.left - 6;

                let opensRight = true;
                if (menuRight + VISIBLE_GAP + submenuWidth > window.innerWidth - 8) {
                    opensRight = false;
                }

                let left = opensRight ? (menuRight + VISIBLE_GAP) : Math.max(8, menuLeft - VISIBLE_GAP - submenuWidth);

                let top = wrapperRect.top - 6;
                if (top + submenuHeight > window.innerHeight - 8) {
                    top = window.innerHeight - submenuHeight - 8;
                }
                if (top < 8) top = 8;

                Object.assign(submenu.style, {
                    position: 'fixed',
                    left: `${left}px`,
                    top: `${top}px`,
                    padding: '0'
                });
            }

            const keepSubmenuAlive = () => {
                if (leaveTimeout) {
                    clearTimeout(leaveTimeout);
                    leaveTimeout = null;
                }
                container.style.backgroundColor = 'var(--primary, #8859ff)';
                container.style.color = '#ffffff';
            };

            let mouseMoveHandler = null;

            function startMouseTracking() {
                stopMouseTracking();
                mouseMoveHandler = (e) => {
                    if (!submenu || submenu.style.display === 'none') {
                        stopMouseTracking();
                        return;
                    }
                    const mx = e.clientX, my = e.clientY;

                    const wr = wrapper.getBoundingClientRect();
                    const inWrapper = mx >= wr.left && mx <= wr.right && my >= wr.top && my <= wr.bottom;

                    const sr = submenuInner ? submenuInner.getBoundingClientRect() : null;
                    const inSubmenu = sr && mx >= sr.left && mx <= sr.right && my >= sr.top && my <= sr.bottom;

                    if (inWrapper || inSubmenu) {
                        keepSubmenuAlive();
                    } else {
                        if (!leaveTimeout) {
                            leaveTimeout = setTimeout(() => {
                                container.style.backgroundColor = 'transparent';
                                container.style.color = 'var(--on-surface, #e6e1e5)';
                                if (submenu) submenu.style.display = 'none';
                                stopMouseTracking();
                            }, 300);
                        }
                    }
                };
                document.addEventListener('mousemove', mouseMoveHandler);
            }

            function stopMouseTracking() {
                if (mouseMoveHandler) {
                    document.removeEventListener('mousemove', mouseMoveHandler);
                    mouseMoveHandler = null;
                }
            }

            function toggleSubmenu() {
                const isVisible = submenu && submenu.style.display === 'block';

                document.querySelectorAll('.custom-context-submenu').forEach(s => {
                    if (s !== submenu) s.style.display = 'none';
                });

                if (isVisible) {
                    if (submenu) submenu.style.display = 'none';
                    container.style.backgroundColor = 'transparent';
                    container.style.color = 'var(--on-surface, #e6e1e5)';
                    stopMouseTracking();
                } else {
                    keepSubmenuAlive();
                    positionSubmenu();
                    startMouseTracking();
                }
            }

            if (it.children && it.children.length > 0) {
                chevronBtn = document.createElement('button');
                chevronBtn.className = 'menu-item-chevron-btn';
                chevronBtn.setAttribute('aria-label', `Toggle ${it.label} submenu`);
                Object.assign(chevronBtn.style, {
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    padding: '7px 10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    userSelect: 'none',
                    webkitUserSelect: 'none',
                    borderRadius: '0 8px 8px 0',
                    outline: 'none',
                    flexShrink: '0'
                });

                const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                chevron.setAttribute('width', '14');
                chevron.setAttribute('height', '14');
                chevron.setAttribute('viewBox', '0 0 24 24');
                chevron.setAttribute('fill', 'none');
                chevron.setAttribute('stroke', 'currentColor');
                chevron.setAttribute('stroke-width', '2.5');
                chevron.setAttribute('stroke-linecap', 'round');
                chevron.setAttribute('stroke-linejoin', 'round');
                chevron.style.opacity = '0.7';

                const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                polyline.setAttribute('points', '9 18 15 12 9 6');
                chevron.appendChild(polyline);
                chevronBtn.appendChild(chevron);
                container.appendChild(chevronBtn);

                chevronBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSubmenu();
                });

                submenu = document.createElement('div');
                submenu.className = 'custom-context-submenu';
                Object.assign(submenu.style, {
                    position: 'fixed',
                    zIndex: '10001',
                    display: 'none',
                    userSelect: 'none',
                    webkitUserSelect: 'none'
                });

                submenuInner = document.createElement('div');
                submenuInner.className = 'custom-context-submenu-inner';
                Object.assign(submenuInner.style, {
                    background: 'var(--surface-variant, #2d2a33)',
                    border: '1px solid var(--outline, #49454f)',
                    borderRadius: '14px',
                    padding: '6px',
                    minWidth: '170px',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                    backdropFilter: 'blur(12px)',
                    webkitBackdropFilter: 'blur(12px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                });

                it.children.forEach(child => {
                    const childEl = createMenuItem(child);
                    submenuInner.appendChild(childEl);
                });

                submenu.appendChild(submenuInner);
                document.body.appendChild(submenu);
            } else {
                mainBtn.style.borderRadius = '8px';
            }

            mainBtn.addEventListener('click', (e) => {
                if (it.action) {
                    it.action(e);
                    menu.style.display = 'none';
                    document.querySelectorAll('.custom-context-submenu').forEach(s => s.style.display = 'none');
                    stopMouseTracking();
                } else if (it.children && it.children.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSubmenu();
                }
            });

            wrapper.addEventListener('mouseenter', () => {
                keepSubmenuAlive();

                if (submenu) {
                    document.querySelectorAll('.custom-context-submenu').forEach(s => {
                        if (s !== submenu) s.style.display = 'none';
                    });
                }
                const parent = wrapper.parentElement;
                if (parent) {
                    parent.querySelectorAll(':scope > .menu-item-wrapper').forEach(sibling => {
                        if (sibling !== wrapper) {
                            const sibContainer = sibling.querySelector('.menu-item-container');
                            if (sibContainer) {
                                sibContainer.style.backgroundColor = 'transparent';
                                sibContainer.style.color = 'var(--on-surface, #e6e1e5)';
                            }
                        }
                    });
                }

                if (submenu) {
                    positionSubmenu();
                    startMouseTracking();
                }
            });

            wrapper.addEventListener('mouseleave', () => {
                if (!submenu || submenu.style.display !== 'block') {
                    container.style.backgroundColor = 'transparent';
                    container.style.color = 'var(--on-surface, #e6e1e5)';
                }
            });

            wrapper.appendChild(container);
            return wrapper;
        }

        let lastRightClickTime = 0;
        window.addEventListener('contextmenu', (e) => {
            const now = Date.now();
            if (now - lastRightClickTime < 600) {
                menu.style.display = 'none';
                lastRightClickTime = 0;
                return;
            }
            lastRightClickTime = now;
            e.preventDefault();

            // Clear the menu content so we can rebuild dynamically
            menu.innerHTML = '';

            const isMobile = window.matchMedia('(max-width: 768px)').matches ||
                ('ontouchstart' in window && window.innerWidth <= 1024) ||
                (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024);

            const scheduleChildren = [
                ...(isMobile ? [{ label: 'Schedule Portal', action: () => window.location.href = 'https://schedule.astrong.xyz' }] : []),
                { label: 'Availability', action: () => window.location.href = 'https://schedule.astrong.xyz/availability' },
                { label: 'Starbucks Schedule', action: () => window.location.href = 'https://schedule.astrong.xyz/starbucks' },
                { label: 'School Classes', action: () => window.location.href = 'https://schedule.astrong.xyz/school/' },
                { label: 'Find a Time', action: () => window.open('https://calendar.app.google/j4EnNgkWWep23ZZC7', '_blank') }
            ];

            const utilityChildren = [
                ...(isMobile ? [{ label: 'Utility Portal', action: () => window.location.href = 'https://utility.astrong.xyz' }] : []),
                { label: 'Color Contrast', action: () => window.location.href = 'https://utility.astrong.xyz/contrast' },
                { label: 'Lorem Ipsum', action: () => window.location.href = 'https://utility.astrong.xyz/lorem' },
                { label: 'METAR Weather', action: () => window.location.href = 'https://utility.astrong.xyz/metar' },
                { label: 'Password Generator', action: () => window.location.href = 'https://utility.astrong.xyz/password' },
                { label: 'Progress Tracker', action: () => window.location.href = 'https://utility.astrong.xyz/progress' },
                { label: 'QR Code Generator', action: () => window.location.href = 'https://utility.astrong.xyz/qrcode' },
                { label: 'Text Tools', action: () => window.location.href = 'https://utility.astrong.xyz/text' },
                { label: 'Time Converter', action: () => window.location.href = 'https://utility.astrong.xyz/time' }
            ];

            const items = [
                { label: 'Home', action: () => window.location.href = 'https://astrong.xyz' },
                {
                    label: 'Schedule',
                    action: () => window.location.href = 'https://schedule.astrong.xyz',
                    children: scheduleChildren
                },
                {
                    label: 'Utilities',
                    action: () => window.location.href = 'https://utility.astrong.xyz',
                    children: utilityChildren
                },
                {
                    label: 'About',
                    action: () => window.location.href = 'https://about.astrong.xyz'
                }
            ];

            const selection = window.getSelection();
            const selectedText = selection ? selection.toString() : '';
            const hasSelection = selectedText.length > 0;
            const target = e.target;
            const isEditable = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            const editItems = [];

            if (hasSelection) {
                editItems.push({
                    label: 'Copy',
                    action: () => {
                        navigator.clipboard.writeText(selectedText).catch(() => {
                            document.execCommand('copy');
                        });
                    }
                });
            }

            if (isEditable) {
                if (hasSelection) {
                    editItems.push({
                        label: 'Cut',
                        action: () => {
                            navigator.clipboard.writeText(selectedText).then(() => {
                                deleteSelectedText(target);
                            }).catch(() => {
                                document.execCommand('cut');
                            });
                        }
                    });
                }

                editItems.push({
                    label: 'Paste',
                    action: async () => {
                        try {
                            const text = await navigator.clipboard.readText();
                            insertTextAtCursor(target, text);
                        } catch (err) {
                            console.error('[Context Menu] Failed to paste:', err);
                            document.execCommand('paste');
                        }
                    }
                });

                if (hasSelection) {
                    editItems.push({
                        label: 'Delete',
                        action: () => {
                            deleteSelectedText(target);
                        }
                    });
                }
            }

            if (editItems.length > 0) {
                items.push({ type: 'separator' });
                items.push(...editItems);
            }

            // Build DOM elements for the items
            items.forEach(it => {
                menu.appendChild(createMenuItem(it));
            });

            menu.style.display = 'flex';

            let x = e.clientX;
            let y = e.clientY;

            const menuWidth = 180;
            const menuHeight = menu.offsetHeight || 190;

            if (x + menuWidth > window.innerWidth) {
                x = window.innerWidth - menuWidth - 8;
            }
            if (y + menuHeight > window.innerHeight) {
                y = window.innerHeight - menuHeight - 8;
            }

            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
        });

        window.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !e.target.closest('.custom-context-submenu')) {
                menu.style.display = 'none';
                document.querySelectorAll('.custom-context-submenu').forEach(s => s.style.display = 'none');
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                menu.style.display = 'none';
                document.querySelectorAll('.custom-context-submenu').forEach(s => s.style.display = 'none');
            }
        });
    }

    // 5. Command Palette (Cmd+K / Ctrl+K) Implementation
    function initCommandPalette() {
        if (document.getElementById('astrong-cmd-palette')) return;

        if (!document.getElementById('jetbrains-mono-font-link')) {
            const fontLink = document.createElement('link');
            fontLink.id = 'jetbrains-mono-font-link';
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap';
            document.head.appendChild(fontLink);
        }

        const style = document.createElement('style');
        style.id = 'astrong-cmd-palette-style';
        style.textContent = `
            @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap');

            .cmd-palette-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: 100000;
                display: none;
                align-items: flex-start;
                justify-content: center;
                padding-top: 12vh;
                padding-left: 1rem;
                padding-right: 1rem;
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            .cmd-palette-modal *:not(input) {
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            .cmd-palette-modal input {
                user-select: text !important;
                -webkit-user-select: text !important;
            }
            .cmd-palette-modal.active {
                display: flex;
            }
            .cmd-palette-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(18, 16, 22, 0.75);
                backdrop-filter: blur(4px);
                user-select: none;
                -webkit-user-select: none;
            }
            :root.light-mode .cmd-palette-overlay {
                background-color: rgba(253, 251, 255, 0.75);
            }
            .cmd-palette-container {
                position: relative;
                width: 100%;
                max-width: 580px;
                background-color: var(--surface, #1d1b20);
                border: 1px solid var(--outline, #49454f);
                border-radius: 16px;
                z-index: 100001;
                overflow: hidden;
                box-shadow: none;
                animation: cmdPaletteFadeIn 0.22s cubic-bezier(0.2, 0, 0, 1);
                font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, sans-serif;
            }
            @keyframes cmdPaletteFadeIn {
                from { opacity: 0; transform: translateY(-6px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .cmd-palette-header {
                display: flex;
                align-items: center;
                padding: 0.85rem 1.1rem;
                border-bottom: 1px solid var(--outline, #49454f);
                gap: 0.75rem;
            }
            .cmd-palette-search-icon {
                color: var(--on-surface-variant, #cac4d0);
                flex-shrink: 0;
            }
            .cmd-palette-input {
                flex: 1;
                background: transparent;
                border: none;
                outline: none;
                font-family: inherit;
                font-size: 1rem;
                color: var(--on-surface, #e6e1e5);
            }
            .cmd-palette-input::placeholder {
                color: var(--on-surface-variant, #cac4d0);
                opacity: 0.7;
            }
            .cmd-palette-badge {
                font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 0.7rem;
                padding: 2px 6px;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 4px;
                color: var(--on-surface-variant, #cac4d0);
                user-select: none;
                -webkit-user-select: none;
            }
            .cmd-palette-results {
                max-height: 340px;
                overflow-y: auto;
                padding: 0.5rem;
            }
            .cmd-palette-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.65rem 0.85rem;
                border-radius: 8px;
                cursor: pointer;
                user-select: none;
                -webkit-user-select: none;
                transition: background-color 0.1s ease, color 0.1s ease;
                color: var(--on-surface, #e6e1e5);
            }
            .cmd-palette-item-left {
                display: flex;
                align-items: center;
                gap: 0.75rem;
            }
            .cmd-palette-item-icon {
                font-size: 1.1rem;
                width: 24px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .cmd-palette-item-title {
                font-size: 0.9rem;
                font-weight: 500;
                font-family: inherit;
            }
            .cmd-palette-item-category {
                font-size: 0.75rem;
                color: var(--on-surface-variant, #cac4d0);
                opacity: 0.8;
                background: var(--surface-variant, #2d2a33);
                padding: 2px 8px;
                border-radius: 12px;
                font-family: inherit;
            }
            .cmd-palette-item.selected {
                background-color: var(--primary-container, #4527a0);
                color: var(--on-primary-container, #ffffff);
            }
            .cmd-palette-item.selected .cmd-palette-item-category {
                background-color: rgba(255, 255, 255, 0.15);
                color: var(--on-primary-container, #ffffff);
            }
            :root.light-mode .cmd-palette-item.selected .cmd-palette-item-category {
                background-color: rgba(0, 0, 0, 0.08);
                color: var(--on-primary-container, #1d1b20);
            }
            .cmd-palette-no-results {
                padding: 1.5rem;
                text-align: center;
                font-size: 0.88rem;
                color: var(--on-surface-variant, #cac4d0);
                font-family: inherit;
            }
            .cmd-palette-footer {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 1.25rem;
                padding: 0.5rem 1rem;
                border-top: 1px solid var(--outline, #49454f);
                font-size: 0.75rem;
                color: var(--on-surface-variant, #cac4d0);
                user-select: none;
                -webkit-user-select: none;
                font-family: inherit;
            }
            .cmd-palette-footer kbd, .cmd-palette-container kbd {
                font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                padding: 1px 4px;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 3px;
                margin-right: 3px;
            }
            @media (max-width: 768px) {
                .cmd-palette-footer {
                    display: none !important;
                }
                .cmd-palette-badge {
                    display: none !important;
                }
            }
        `;
        document.head.appendChild(style);

        const modal = document.createElement('div');
        modal.id = 'astrong-cmd-palette';
        modal.className = 'cmd-palette-modal';
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML = `
            <div class="cmd-palette-overlay"></div>
            <div class="cmd-palette-container">
                <div class="cmd-palette-header">
                    <svg class="cmd-palette-search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input type="text" id="cmd-palette-input" class="cmd-palette-input" placeholder="Type a command or search pages..." autocomplete="off" spellcheck="false" />
                    <kbd class="cmd-palette-badge">ESC</kbd>
                </div>
                <div class="cmd-palette-results" id="cmd-palette-results"></div>
                <div class="cmd-palette-footer">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> select</span>
                    <span><kbd>esc</kbd> close</span>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = modal.querySelector('#cmd-palette-input');
        const resultsContainer = modal.querySelector('#cmd-palette-results');
        const overlay = modal.querySelector('.cmd-palette-overlay');

        let selectedIndex = 0;
        let filteredItems = [];

        const icons = {
            home: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-home"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
            schedule: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`,
            availability: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-check"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`,
            school: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-graduation-cap"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
            starbucks: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coffee"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12Z"/><path d="M6 2v2"/><path d="M17 12h1a3 3 0 0 1 0 6h-1"/></svg>`,
            utility: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-wrench"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
            contrast: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.7-.74 1.7-1.67 0-.42-.16-.82-.44-1.12-.27-.3-.43-.7-.43-1.13 0-.93.75-1.68 1.68-1.68h2.09c3.04 0 5.4-2.46 5.4-5.5 0-4.97-4.48-9-10-9z"/></svg>`,
            metar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plane"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
            password: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-key-round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>`,
            lorem: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-text"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>`,
            progress: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-activity"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
            qrcode: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-qr-code"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>`,
            text: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-type"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
            time: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
            terms: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`,
            privacy: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
            about: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
            control: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
            theme: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
            accent: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.7-.74 1.7-1.67 0-.42-.16-.82-.44-1.12-.27-.3-.43-.7-.43-1.13 0-.93.75-1.68 1.68-1.68h2.09c3.04 0 5.4-2.46 5.4-5.5 0-4.97-4.48-9-10-9z"/></svg>`,
            settings: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
            help: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-help-circle"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
        };

        const itemsList = [
            { id: 'home', title: 'Home', category: 'Navigation', icon: icons.home, url: 'https://astrong.xyz' },
            { id: 'schedule', title: 'Schedule Portal', category: 'Navigation', icon: icons.schedule, url: 'https://schedule.astrong.xyz' },
            { id: 'availability', title: 'Availability', category: 'Schedule', icon: icons.availability, url: 'https://schedule.astrong.xyz/availability/' },
            { id: 'starbucks', title: 'Starbucks Schedule', category: 'Schedule', icon: icons.starbucks, url: 'https://schedule.astrong.xyz/starbucks/' },
            { id: 'school', title: 'School Classes', category: 'Schedule', icon: icons.school, url: 'https://schedule.astrong.xyz/school/' },
            { id: 'utility', title: 'Utility Portal', category: 'Navigation', icon: icons.utility, url: 'https://utility.astrong.xyz' },
            { id: 'contrast', title: 'Color Contrast', category: 'Utilities', icon: icons.contrast, url: 'https://utility.astrong.xyz/contrast/' },
            { id: 'metar', title: 'METAR Aviation Weather', category: 'Utilities', icon: icons.metar, url: 'https://utility.astrong.xyz/metar/' },
            { id: 'password', title: 'Password Generator', category: 'Utilities', icon: icons.password, url: 'https://utility.astrong.xyz/password/' },
            { id: 'lorem', title: 'Lorem Ipsum Generator', category: 'Utilities', icon: icons.lorem, url: 'https://utility.astrong.xyz/lorem/' },
            { id: 'progress', title: 'Progress Tracker', category: 'Utilities', icon: icons.progress, url: 'https://utility.astrong.xyz/progress/' },
            { id: 'qrcode', title: 'QR Code Generator', category: 'Utilities', icon: icons.qrcode, url: 'https://utility.astrong.xyz/qrcode/' },
            { id: 'text', title: 'Text Toolkit', category: 'Utilities', icon: icons.text, url: 'https://utility.astrong.xyz/text/' },
            { id: 'time', title: 'Time', category: 'Utilities', icon: icons.time, url: 'https://utility.astrong.xyz/time/' },
            { id: 'about', title: 'About Austin', category: 'Navigation', icon: icons.about, url: 'https://about.astrong.xyz/' },
            { id: 'terms', title: 'Terms of Service', category: 'Navigation', icon: icons.terms, url: 'https://astrong.xyz/terms' },
            { id: 'privacy', title: 'Privacy Policy', category: 'Navigation', icon: icons.privacy, url: 'https://astrong.xyz/privacy' },
            {
                id: 'theme-toggle', title: 'Toggle Light / Dark Mode', category: 'Actions', icon: icons.theme, action: () => {
                    const isSubHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
                    const currentMode = getThemeCookie('astrong_mode') || (!isSubHost ? localStorage.getItem('astrong_mode') : null) || 'dark';
                    const newMode = currentMode === 'light' ? 'dark' : 'light';
                    applyTheme(null, newMode);
                    if (window.showToast) window.showToast(`Switched to ${newMode} mode`);
                }
            },
            { id: 'accent-cycle', title: 'Cycle Theme', category: 'Actions', icon: icons.accent, action: () => cycleThemeAccent() },
            {
                id: 'settings', title: 'Open Settings', category: 'Actions', icon: icons.settings, action: () => {
                    if (typeof window.openSettingsModal === 'function') {
                        window.openSettingsModal();
                    } else {
                        const btn = document.getElementById('settings-btn') || document.getElementById('settings-toggle');
                        if (btn) btn.click();
                    }
                }
            },
            {
                id: 'help', title: 'Help & Shortcuts', category: 'Actions', icon: icons.help, action: () => {
                    if (typeof window.openHelpModal === 'function') {
                        window.openHelpModal();
                    } else {
                        const btn = document.getElementById('help-btn');
                        if (btn) btn.click();
                    }
                }
            }
        ];

        function renderResults() {
            resultsContainer.innerHTML = '';
            const query = input.value.trim().toLowerCase();
            filteredItems = itemsList.filter(item =>
                item.title.toLowerCase().includes(query) ||
                item.category.toLowerCase().includes(query)
            );

            if (filteredItems.length === 0) {
                resultsContainer.innerHTML = `<div class="cmd-palette-no-results">No matching commands or pages found.</div>`;
                return;
            }

            if (selectedIndex >= filteredItems.length) selectedIndex = 0;
            if (selectedIndex < 0) selectedIndex = filteredItems.length - 1;

            filteredItems.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = `cmd-palette-item ${index === selectedIndex ? 'selected' : ''}`;
                div.innerHTML = `
                    <div class="cmd-palette-item-left">
                        <span class="cmd-palette-item-icon">${item.icon}</span>
                        <span class="cmd-palette-item-title">${item.title}</span>
                    </div>
                    <span class="cmd-palette-item-category">${item.category}</span>
                `;
                div.addEventListener('click', () => {
                    executeItem(item);
                });
                div.addEventListener('mouseenter', () => {
                    selectedIndex = index;
                    updateSelection();
                });
                resultsContainer.appendChild(div);
            });

            const selectedEl = resultsContainer.children[selectedIndex];
            if (selectedEl) {
                selectedEl.scrollIntoView({ block: 'nearest' });
            }
        }

        function updateSelection() {
            const children = resultsContainer.children;
            for (let i = 0; i < children.length; i++) {
                if (i === selectedIndex) {
                    children[i].classList.add('selected');
                    children[i].scrollIntoView({ block: 'nearest' });
                } else {
                    children[i].classList.remove('selected');
                }
            }
        }

        function executeItem(item) {
            closeCommandPalette();
            if (item.url) {
                window.location.href = item.url;
            } else if (item.action) {
                item.action();
            }
        }

        input.addEventListener('input', () => {
            selectedIndex = 0;
            renderResults();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredItems.length > 0) {
                    selectedIndex = (selectedIndex + 1) % filteredItems.length;
                    updateSelection();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (filteredItems.length > 0) {
                    selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
                    updateSelection();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filteredItems[selectedIndex]) {
                    executeItem(filteredItems[selectedIndex]);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeCommandPalette();
            }
        });

        function openCommandPalette() {
            console.log('[Command Palette] Opened');
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');
            input.value = '';
            selectedIndex = 0;
            renderResults();
            setTimeout(() => input.focus(), 20);
        }

        function closeCommandPalette() {
            console.log('[Command Palette] Closed');
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }

        function toggleCommandPalette() {
            if (modal.classList.contains('active')) {
                closeCommandPalette();
            } else {
                openCommandPalette();
            }
        }

        window.openCommandPalette = openCommandPalette;
        window.closeCommandPalette = closeCommandPalette;
        window.toggleCommandPalette = toggleCommandPalette;

        overlay.addEventListener('click', closeCommandPalette);

        document.querySelectorAll('#search-btn, .search-btn, [data-action="cmd-palette"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                openCommandPalette();
            });
        });
    }

    function injectUniversalNavStyles() {
        if (document.getElementById('astrong-universal-nav-styles')) return;

        const navStyle = document.createElement('style');
        navStyle.id = 'astrong-universal-nav-styles';
        navStyle.textContent = `
            /* Universal Theme-Responsive Rounded Scrollbars */
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }
            ::-webkit-scrollbar-track {
                background: transparent;
            }
            ::-webkit-scrollbar-thumb {
                background: color-mix(in srgb, var(--on-surface, #e6e1e5) 18%, transparent);
                border-radius: 9999px;
                border: 2px solid transparent;
                background-clip: padding-box;
                transition: background-color 0.2s ease;
            }
            ::-webkit-scrollbar-thumb:hover {
                background: var(--primary, #8859ff);
                border: 1px solid transparent;
                background-clip: padding-box;
            }
            ::-webkit-scrollbar-corner {
                background: transparent;
            }
            :root.light-mode ::-webkit-scrollbar-thumb {
                background: color-mix(in srgb, var(--on-surface, #1d1b20) 22%, transparent);
                border: 2px solid transparent;
                background-clip: padding-box;
            }
            :root.light-mode ::-webkit-scrollbar-thumb:hover {
                background: var(--primary, #8859ff);
                border: 1px solid transparent;
                background-clip: padding-box;
            }
            * {
                scrollbar-width: thin;
                scrollbar-color: color-mix(in srgb, var(--on-surface, #e6e1e5) 18%, transparent) transparent;
            }
            :root.light-mode * {
                scrollbar-color: color-mix(in srgb, var(--on-surface, #1d1b20) 22%, transparent) transparent;
            }

            html {
                scrollbar-gutter: stable;
            }

            :root {
                --astrong-header-height: 61.6px;
                --astrong-header-spacing: 17.2px;
                --astrong-header-left: 1.5rem;
            }

            .back-link {
                position: absolute !important;
                top: calc(var(--astrong-header-height, 61.6px) + var(--astrong-header-spacing, 17.2px)) !important;
                left: var(--astrong-header-left, 1.5rem) !important;
                z-index: 1000 !important;
                display: inline-flex !important;
                align-items: center !important;
                gap: 0.5rem !important;
                color: var(--on-surface-variant, var(--text-secondary, #cac4d0));
                text-decoration: none !important;
                font-size: 0.95rem !important;
                font-weight: 500 !important;
                transition: color 0.15s ease !important;
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            .back-link:hover {
                color: var(--on-surface, var(--text-primary, #e6e1e5)) !important;
            }

            .top-controls-bar {
                position: relative;
                width: 100%;
                align-self: stretch;
                z-index: 1000;
                display: grid;
                grid-template-columns: 1fr auto 1fr;
                align-items: center;
                padding: 0.85rem 1.5rem;
                height: 61.6px !important;
                min-height: 61.6px !important;
                max-height: 61.6px !important;
                background: var(--background, #121016);
                border-bottom: 1px solid var(--outline, rgba(255, 255, 255, 0.08));
                user-select: none;
                -webkit-user-select: none;
                box-sizing: border-box !important;
                flex-shrink: 0;
            }
            :root.light-mode .top-controls-bar {
                background: #fdfbff;
                border-bottom-color: rgba(0, 0, 0, 0.08);
            }
            .brand-pill {
                display: inline-flex !important;
                align-items: center !important;
                gap: 0.55rem !important;
                font-size: 0.92rem !important;
                font-weight: 700 !important;
                color: var(--on-surface) !important;
                letter-spacing: -0.01em !important;
                justify-self: flex-start !important;
                text-decoration: none !important;
                flex-shrink: 0 !important;
                height: 28px !important;
                min-height: 28px !important;
                max-height: 28px !important;
                box-sizing: border-box !important;
            }
            .controls-group {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                justify-self: flex-end;
                flex-shrink: 0;
            }
            .control-btn {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                padding: 6px 12px;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 12px;
                color: var(--on-surface-variant, #cac4d0);
                cursor: pointer;
                font-size: 0.85rem;
                font-weight: 600;
                transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
                user-select: none;
                -webkit-user-select: none;
                flex-shrink: 0;
            }
            .control-btn:hover {
                background: var(--surface, #1d1b20);
                border-color: var(--primary, #8859ff);
                color: var(--primary, #8859ff);
            }
            :root.light-mode .control-btn {
                background: #e7e0ec;
                border-color: #79747e;
                color: #49454f;
            }
            :root.light-mode .control-btn:hover {
                background: #fdfbff;
                border-color: #8859ff;
                color: #8859ff;
            }
            .btn-kbd {
                display: inline-flex;
                align-items: center;
                gap: 2px;
            }
            .btn-kbd kbd {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.7rem;
                padding: 2px 4px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                color: var(--on-surface-variant, #cac4d0);
            }
            :root.light-mode .btn-kbd kbd {
                background: rgba(0, 0, 0, 0.05);
                border-color: rgba(0, 0, 0, 0.1);
                color: #49454f;
            }
            .hdr-nav {
                display: flex;
                align-items: center;
                gap: 0.25rem;
            }
            .hdr-dropdown-wrapper {
                position: relative;
                padding-bottom: 8px;
                margin-bottom: -8px;
            }
            .hdr-nav-btn {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 6px 12px;
                background: transparent;
                border: none;
                border-radius: 10px;
                color: var(--on-surface-variant, #cac4d0);
                font-size: 0.88rem;
                font-weight: 500;
                cursor: pointer;
                text-decoration: none;
                transition: background-color 0.15s ease, color 0.15s ease;
                user-select: none;
                -webkit-user-select: none;
                white-space: nowrap;
            }
            .hdr-nav-btn:hover, .hdr-dropdown-wrapper:hover .hdr-nav-btn {
                background: rgba(255, 255, 255, 0.08);
                color: var(--on-surface, #ffffff);
            }
            :root.light-mode .hdr-nav-btn:hover, :root.light-mode .hdr-dropdown-wrapper:hover .hdr-nav-btn {
                background: rgba(0, 0, 0, 0.06);
                color: #1d1b20;
            }
            .hdr-dropdown-menu {
                display: none;
                position: absolute;
                top: 100%;
                left: 0;
                margin-top: 0;
                min-width: 185px;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 14px;
                padding: 6px;
                z-index: 2000;
                box-shadow: none;
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                animation: m3DropdownBounce 0.2s cubic-bezier(0.2, 0, 0, 1);
            }
            @keyframes m3DropdownBounce {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .hdr-dropdown-menu::before {
                content: '';
                position: absolute;
                top: -12px;
                left: 0;
                right: 0;
                height: 14px;
            }
            .hdr-dropdown-item {
                display: flex;
                align-items: center;
                padding: 7px 12px;
                border-radius: 8px;
                color: var(--on-surface, #e6e1e5);
                text-decoration: none;
                font-size: 0.85rem;
                font-weight: 500;
                transition: background-color 0.12s ease, color 0.12s ease;
                user-select: none;
                -webkit-user-select: none;
                white-space: nowrap;
            }
            .hdr-dropdown-item:hover {
                background: var(--primary, #8859ff);
                color: #ffffff;
            }
            .mobile-menu-btn {
                display: none;
            }
            .mobile-drawer-overlay {
                display: none;
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                z-index: 9998;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
            }
            .mobile-drawer {
                position: fixed;
                top: 0;
                right: 0;
                bottom: 0;
                width: min(340px, 86vw);
                background: var(--surface, #1d1b20);
                border-left: 1px solid var(--outline, #49454f);
                border-radius: 28px 0 0 28px;
                z-index: 9999;
                transform: translateX(100%);
                transition: transform 0.35s cubic-bezier(0.2, 0, 0, 1);
                display: flex;
                flex-direction: column;
                user-select: none;
                -webkit-user-select: none;
                box-sizing: border-box;
                overflow: hidden;
            }
            :root.light-mode .mobile-drawer {
                background: #fdfbff;
                border-left-color: rgba(0, 0, 0, 0.1);
            }
            body.mobile-drawer-open {
                overflow: hidden !important;
            }
            body.mobile-drawer-open .mobile-drawer-overlay {
                display: block;
                opacity: 1;
                pointer-events: auto;
            }
            body.mobile-drawer-open .mobile-drawer {
                transform: translateX(0);
            }
            .mobile-drawer-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 1.1rem 1.25rem;
                border-bottom: 1px solid var(--outline, rgba(255, 255, 255, 0.08));
            }
            :root.light-mode .mobile-drawer-header {
                border-bottom-color: rgba(0, 0, 0, 0.08);
            }
            .mobile-drawer-body {
                flex: 1;
                overflow-y: auto;
                padding: 1rem 1rem 1.5rem;
                display: flex;
                flex-direction: column;
                gap: 1.25rem;
            }
            .mobile-drawer-section {
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
            }
            .mobile-drawer-section-title {
                font-size: 0.72rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: var(--on-surface-variant, #cac4d0);
                padding: 4px 12px 2px;
                opacity: 0.85;
            }
            :root.light-mode .mobile-drawer-section-title {
                color: #49454f;
            }
            .mobile-nav-group {
                display: flex;
                flex-direction: column;
                gap: 0.25rem;
            }
            .mobile-nav-link {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                min-height: 48px;
                padding: 0 16px;
                border-radius: 24px;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                color: var(--on-surface, #e6e1e5);
                text-decoration: none;
                font-size: 0.92rem;
                font-weight: 600;
                transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s cubic-bezier(0.2, 0, 0, 1), color 0.2s cubic-bezier(0.2, 0, 0, 1);
                box-sizing: border-box;
            }
            :root.light-mode .mobile-nav-link {
                background: #e7e0ec;
                border-color: #79747e;
                color: #1d1b20;
            }
            .mobile-nav-link:hover,
            .mobile-nav-link:active {
                border-color: var(--primary, #8859ff);
                color: var(--primary, #8859ff);
            }
            :root.light-mode .mobile-nav-link:hover,
            :root.light-mode .mobile-nav-link:active {
                border-color: var(--primary, #6536ec);
                color: var(--primary, #6536ec);
            }
            .mobile-nav-sublinks {
                display: flex;
                flex-direction: column;
                gap: 0.2rem;
                margin-left: 12px;
                padding-left: 8px;
                border-left: 2px solid var(--outline, rgba(255, 255, 255, 0.08));
            }
            :root.light-mode .mobile-nav-sublinks {
                border-left-color: rgba(0, 0, 0, 0.08);
            }
            .mobile-nav-sublink {
                display: flex;
                align-items: center;
                gap: 0.65rem;
                min-height: 40px;
                padding: 0 14px;
                border-radius: 20px;
                color: var(--on-surface-variant, #cac4d0);
                text-decoration: none;
                font-size: 0.85rem;
                font-weight: 500;
                transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1), color 0.2s cubic-bezier(0.2, 0, 0, 1);
                box-sizing: border-box;
            }
            :root.light-mode .mobile-nav-sublink {
                color: #49454f;
            }
            .mobile-nav-sublink:hover,
            .mobile-nav-sublink:active {
                background: rgba(136, 89, 255, 0.1);
                color: var(--on-surface, #ffffff);
            }
            :root.light-mode .mobile-nav-sublink:hover,
            :root.light-mode .mobile-nav-sublink:active {
                background: rgba(136, 89, 255, 0.1);
                color: #1d1b20;
            }
            .mobile-actions-list {
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
            }
            .mobile-action-item {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                min-height: 48px;
                padding: 0 16px;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 24px;
                color: var(--on-surface, #e6e1e5);
                font-size: 0.9rem;
                font-weight: 600;
                cursor: pointer;
                text-align: left;
                width: 100%;
                box-sizing: border-box;
                transition: background-color 0.2s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s cubic-bezier(0.2, 0, 0, 1), color 0.2s cubic-bezier(0.2, 0, 0, 1);
            }
            :root.light-mode .mobile-action-item {
                background: #e7e0ec;
                border-color: #79747e;
                color: #1d1b20;
            }
            .mobile-action-item:hover,
            .mobile-action-item:active {
                border-color: var(--primary, #8859ff);
                color: var(--primary, #8859ff);
            }
            :root.light-mode .mobile-action-item:hover,
            :root.light-mode .mobile-action-item:active {
                border-color: var(--primary, #6536ec);
                color: var(--primary, #6536ec);
            }
            .pfp-wrapper-small {
                width: 28px !important;
                height: 28px !important;
                min-width: 28px !important;
                min-height: 28px !important;
                max-width: 28px !important;
                max-height: 28px !important;
                border-radius: 50% !important;
                clip-path: none !important;
                -webkit-clip-path: none !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                flex-shrink: 0 !important;
                overflow: hidden !important;
                cursor: pointer !important;
            }
            .pfp-wrapper {
                border-radius: 0 !important;
                clip-path: url('#astrong-active-clip') !important;
                -webkit-clip-path: url('#astrong-active-clip') !important;
                overflow: visible !important;
                cursor: pointer !important;
                user-select: none !important;
                -webkit-user-select: none !important;
                touch-action: manipulation;
                will-change: transform;
            }
            .pfp-wrapper img,
            .pfp-wrapper .pfp,
            .pfp-wrapper .pfp-icon-content {
                border-radius: 0 !important;
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
                user-select: none !important;
                -webkit-user-select: none !important;
                -webkit-user-drag: none !important;
                will-change: transform;
            }
            .pfp-wrapper-small img,
            .pfp-wrapper-small .pfp {
                width: 100% !important;
                height: 100% !important;
                max-width: 28px !important;
                max-height: 28px !important;
                object-fit: cover !important;
                display: block !important;
                user-select: none;
                -webkit-user-select: none;
                -webkit-user-drag: none;
                cursor: pointer !important;
            }
            .top-controls-bar .pfp-wrapper-small,
            .site-footer .pfp-wrapper-small,
            .site-footer-brand .pfp-wrapper-small,
            .mobile-drawer .pfp-wrapper-small,
            .brand-pill .pfp-wrapper-small {
                cursor: pointer !important;
            }
            .top-controls-bar .pfp-wrapper-small img,
            .site-footer .pfp-wrapper-small img,
            .site-footer-brand .pfp-wrapper-small img,
            .mobile-drawer .pfp-wrapper-small img,
            .brand-pill .pfp-wrapper-small img {
                cursor: pointer !important;
            }
            .site-footer {
                width: 100%;
                background-color: rgba(18, 16, 22, 0.75);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border-top: 1px solid var(--outline, rgba(255, 255, 255, 0.08));
                padding: 2.5rem 1.5rem 1.5rem;
                margin-top: auto;
                box-sizing: border-box;
                font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, sans-serif;
                color: var(--on-surface-variant, #cac4d0);
                -webkit-user-select: none !important;
                user-select: none !important;
                -webkit-touch-callout: none !important;
            }
            .site-footer,
            .site-footer * {
                -webkit-user-select: none !important;
                user-select: none !important;
                -webkit-touch-callout: none !important;
            }
            .site-footer::selection,
            .site-footer *::selection {
                background: transparent !important;
                color: inherit !important;
            }
            :root.light-mode .site-footer {
                background-color: rgba(247, 245, 249, 0.75);
                border-top-color: rgba(0, 0, 0, 0.08);
                color: #49454f;
            }
            .site-footer-inner {
                max-width: 1000px;
                margin: 0 auto;
                display: flex;
                flex-direction: column;
                gap: 2rem;
            }
            .site-footer-top {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                align-items: flex-start;
                gap: 2rem;
            }
            .site-footer-brand {
                display: flex;
                flex-direction: column;
                gap: 0.4rem;
                max-width: 320px;
            }
            .site-footer-brand-title {
                display: flex;
                align-items: center;
                gap: 0.55rem;
            }
            .site-footer-logo {
                font-weight: 700;
                font-size: 1.15rem;
                color: var(--on-surface, #e6e1e5);
                letter-spacing: -0.02em;
                user-select: none;
                -webkit-user-select: none;
            }
            :root.light-mode .site-footer-logo {
                color: #1d1b20;
            }
            .site-footer-tagline {
                font-size: 0.88rem;
                opacity: 0.8;
                line-height: 1.4;
            }
            .site-footer-device {
                font-family: 'Google Sans Flex', 'Google Sans', system-ui, -apple-system, sans-serif !important;
                font-size: 0.8rem;
                margin-top: 0.4rem;
                opacity: 0.8;
                user-select: none;
                -webkit-user-select: none;
                color: var(--on-surface-variant, #cac4d0);
            }
            .site-footer-device .device-id-display {
                font-family: 'JetBrains Mono', monospace !important;
                font-variant-numeric: tabular-nums;
                letter-spacing: 0.02rem;
                color: var(--on-surface-variant, #a1a1aa);
                font-weight: 600;
                cursor: pointer;
                transition: color 0.15s ease;
            }
            .site-footer-device .device-id-display:hover {
                color: var(--on-surface, #ffffff);
            }
            .site-footer-nav {
                display: flex;
                gap: 3.5rem;
                flex-wrap: wrap;
            }
            .site-footer-col {
                display: flex;
                flex-direction: column;
                gap: 0.6rem;
            }
            .site-footer-col-title {
                font-size: 0.75rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                color: var(--on-surface-variant, #cac4d0);
                opacity: 0.8;
                margin-bottom: 0.2rem;
            }
            :root.light-mode .site-footer-col-title {
                color: #49454f;
            }
            .site-footer-col a {
                color: var(--on-surface-variant, #cac4d0);
                text-decoration: none;
                font-size: 0.88rem;
                transition: color 0.15s ease;
            }
            :root.light-mode .site-footer-col a {
                color: #49454f;
            }
            .site-footer-col a:hover {
                color: var(--primary, #8859ff);
            }
            .site-footer-email-highlight {
                color: var(--primary, #8859ff) !important;
                font-weight: 600;
            }
            :root.light-mode .site-footer-email-highlight {
                color: var(--primary, #8859ff) !important;
            }
            .site-footer-bottom {
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 1rem;
                padding-top: 1.5rem;
                border-top: 1px solid var(--outline, rgba(255, 255, 255, 0.06));
                font-size: 0.8rem;
                opacity: 0.85;
            }
            :root.light-mode .site-footer-bottom {
                border-top-color: rgba(0, 0, 0, 0.06);
            }
            .site-footer-copyright {
                user-select: none;
                -webkit-user-select: none;
            }
            .site-footer-github {
                display: inline-flex;
                align-items: center;
                gap: 0.4rem;
                color: var(--on-surface-variant, #cac4d0);
                text-decoration: none;
                transition: color 0.15s ease;
                user-select: none;
                -webkit-user-select: none;
            }
            .site-footer-github:hover {
                color: var(--primary, #8859ff);
            }
            @media (max-width: 768px) {
                .hdr-nav {
                    display: none !important;
                }
                #settings-btn, #help-btn {
                    display: none !important;
                }
                .mobile-menu-btn {
                    display: inline-flex !important;
                }
                .top-controls-bar {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    padding: 0.6rem 0.85rem !important;
                    gap: 0.4rem !important;
                    width: 100% !important;
                    max-width: 100vw !important;
                    height: 48px !important;
                    min-height: 48px !important;
                    max-height: 48px !important;
                    box-sizing: border-box !important;
                }
                .brand-pill {
                    gap: 0.4rem !important;
                    font-size: 0.85rem !important;
                    flex-shrink: 0 !important;
                    height: 28px !important;
                    min-height: 28px !important;
                    max-height: 28px !important;
                }
                .controls-group {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                    flex-shrink: 0;
                }
                .control-btn {
                    padding: 6px 9px;
                    font-size: 0.85rem;
                    gap: 0;
                    border-radius: 10px;
                }
                .btn-kbd {
                    display: none !important;
                }
                .back-link {
                    position: relative !important;
                    top: auto !important;
                    left: auto !important;
                    margin: 0.6rem 0.85rem 0.4rem !important;
                    display: inline-flex !important;
                    align-self: flex-start !important;
                }
            }
            @media (max-width: 480px) {
                .top-controls-bar {
                    padding: 0.5rem 0.65rem !important;
                    gap: 0.3rem !important;
                    height: 44px !important;
                    min-height: 44px !important;
                    max-height: 44px !important;
                    box-sizing: border-box !important;
                }
                .control-btn {
                    padding: 5px 8px;
                }
                .back-link {
                    margin: 0.5rem 0.65rem 0.4rem !important;
                }
            }

            /* Universal Settings & Help Modals */
            .settings-modal, .help-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                z-index: 10000;
                display: none;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            .settings-modal.active, .help-modal.active {
                display: flex !important;
            }
            .settings-modal *, .help-modal * {
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            .settings-modal-overlay, .help-modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(18, 16, 22, 0.75);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                transition: opacity 0.2s ease;
                user-select: none;
                -webkit-user-select: none;
            }
            :root.light-mode .settings-modal-overlay,
            :root.light-mode .help-modal-overlay {
                background-color: rgba(253, 251, 255, 0.75);
            }
            .settings-modal-container, .help-modal-container {
                position: relative;
                width: 100%;
                max-width: 420px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                background-color: var(--surface, #1d1b20);
                border: 1px solid var(--outline, #49454f);
                border-radius: 24px;
                z-index: 10001;
                overflow: visible;
                animation: astrongModalFadeIn 0.2s ease-out;
                box-sizing: border-box;
            }
            .help-modal-container {
                overflow: hidden;
            }
            @keyframes astrongModalFadeIn {
                from { opacity: 0; transform: scale(0.95); }
                to { opacity: 1; transform: scale(1); }
            }
            .settings-modal-header, .help-modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1.25rem 1.5rem 0.75rem 1.5rem;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                flex-shrink: 0;
            }
            :root.light-mode .settings-modal-header,
            :root.light-mode .help-modal-header {
                border-bottom: 1px solid rgba(0, 0, 0, 0.05);
            }
            .settings-modal-title, .help-modal-title {
                font-size: 1.1rem;
                font-weight: 700;
                color: var(--on-surface, #e6e1e5);
                margin: 0;
                user-select: none;
                -webkit-user-select: none;
                font-family: inherit;
            }
            .settings-close-btn, .help-close-btn {
                background: transparent;
                border: none;
                color: var(--on-surface-variant, #cac4d0);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 6px;
                border-radius: 50%;
                transition: color 0.2s ease, background-color 0.2s ease;
                user-select: none;
                -webkit-user-select: none;
            }
            .settings-close-btn:hover, .help-close-btn:hover {
                color: var(--primary, #8859ff);
                background-color: rgba(255, 255, 255, 0.05);
            }
            :root.light-mode .settings-close-btn:hover,
            :root.light-mode .help-close-btn:hover {
                background-color: rgba(0, 0, 0, 0.05);
            }
            .settings-modal-body, .help-modal-body {
                padding: 1.5rem;
                display: flex;
                flex-direction: column;
                gap: 1.5rem;
                box-sizing: border-box;
            }
            .settings-modal-body {
                overflow: visible;
            }
            .help-modal-body {
                overflow-y: auto;
                flex: 1;
                min-height: 0;
            }
            .settings-section, .help-section {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }
            .settings-section h4, .help-section h4 {
                font-size: 0.9rem;
                font-weight: 700;
                color: var(--primary, #8859ff);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin: 0;
                user-select: none;
                -webkit-user-select: none;
                font-family: inherit;
            }
            .help-section p {
                font-size: 0.85rem;
                line-height: 1.5;
                color: var(--on-surface-variant, #cac4d0);
                margin: 0;
            }
            .custom-select {
                position: relative;
                width: 100%;
                user-select: none;
                -webkit-user-select: none;
            }
            .select-trigger {
                background-color: var(--surface, #1d1b20);
                border: 1px solid var(--outline, #49454f);
                border-radius: 12px;
                padding: 0.75rem 1rem;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                transition: border-color 0.2s ease, background-color 0.2s ease;
                color: var(--on-surface, #e6e1e5);
            }
            .select-trigger:hover {
                border-color: var(--primary, #8859ff);
                background-color: var(--surface-variant, #2d2a33);
            }
            .select-trigger-text {
                font-size: 0.95rem;
                font-weight: 600;
            }
            .select-arrow {
                color: var(--on-surface-variant, #cac4d0);
                transition: transform 0.2s ease;
            }
            .custom-select.open .select-arrow {
                transform: rotate(180deg);
            }
            .select-options {
                position: fixed;
                background-color: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 14px;
                z-index: 99999;
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                max-height: 260px;
                overflow-y: auto;
                display: none;
                padding: 6px;
                flex-direction: column;
                gap: 4px;
                box-sizing: border-box;
            }
            .select-option {
                padding: 0.6rem 0.85rem;
                font-size: 0.9rem;
                font-weight: 600;
                border-radius: 8px;
                cursor: pointer;
                transition: background-color 0.2s ease;
            }
            .select-option:hover {
                background-color: rgba(255, 255, 255, 0.08);
            }
            :root.light-mode .select-option:hover {
                background-color: rgba(0, 0, 0, 0.05);
            }
            .select-option.selected {
                background-color: color-mix(in srgb, var(--primary-container, #4527a0) 25%, transparent);
            }
            .option-red { color: #eb3f56 !important; }
            :root.light-mode .option-red { color: #b32638 !important; }
            .option-orange { color: #ff7524 !important; }
            :root.light-mode .option-orange { color: #bf4100 !important; }
            .option-yellow { color: #f5b500 !important; }
            :root.light-mode .option-yellow { color: #bf8d00 !important; }
            .option-green { color: #00c853 !important; }
            :root.light-mode .option-green { color: #1f793c !important; }
            .option-blue { color: #00b0ff !important; }
            :root.light-mode .option-blue { color: #1976d2 !important; }
            .option-purple { color: #8859ff !important; }
            :root.light-mode .option-purple { color: #6536ec !important; }
            .option-white { color: #ffffff !important; }
            :root.light-mode .option-white { color: #121016 !important; }
            .appearance-toggle-container {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0.25rem 0;
                user-select: none;
                -webkit-user-select: none;
            }
            .appearance-toggle-label {
                font-size: 0.95rem;
                font-weight: 600;
                color: var(--on-surface, #e6e1e5);
            }
            .theme-toggle-pill {
                position: relative;
                display: flex;
                align-items: center;
                background-color: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                border-radius: 30px;
                padding: 4px;
                cursor: pointer;
                width: 96px;
                height: 48px;
                user-select: none;
                -webkit-user-select: none;
                outline: none;
                box-sizing: border-box;
            }
            .toggle-pill-thumb {
                position: absolute;
                top: 4px;
                left: 4px;
                width: 42px;
                height: 38px;
                background-color: var(--surface, #1d1b20);
                border-radius: 20px;
                transition: transform 0.35s cubic-bezier(0.34, 1.4, 0.64, 1), background-color 0.25s ease;
                z-index: 1;
            }
            .toggle-pill-option {
                position: relative;
                flex: 1;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100%;
                z-index: 2;
                color: var(--on-surface-variant, #cac4d0);
                opacity: 0.4;
                transition: color 0.25s ease, opacity 0.25s ease;
            }
            .theme-toggle-pill:hover .toggle-pill-option {
                opacity: 0.7;
            }
            .theme-toggle-pill[data-active="light"] .option-light {
                color: var(--on-surface, #121016);
                opacity: 1;
            }
            .theme-toggle-pill[data-active="dark"] .option-dark {
                color: #ffffff;
                opacity: 1;
            }
            .theme-toggle-pill[data-active="dark"] .toggle-pill-thumb {
                transform: translateX(44px);
            }
            .shortcut-list {
                display: flex;
                flex-direction: column;
                gap: 0.75rem;
            }
            .shortcut-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 0.85rem;
                color: var(--on-surface, #e6e1e5);
                user-select: none;
                -webkit-user-select: none;
            }
            .shortcut-keys {
                display: inline-flex;
                align-items: center;
                gap: 2px;
            }
            .shortcut-keys .plus-sign {
                color: var(--on-surface-variant, #cac4d0);
                font-size: 0.75rem;
                margin: 0 1px;
            }
            .shortcut-item kbd, .shortcut-keys kbd {
                font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
                font-size: 0.75rem;
                background: var(--surface-variant, #2d2a33);
                border: 1px solid var(--outline, #49454f);
                padding: 2px 6px;
                border-radius: 4px;
                color: var(--on-surface, #e6e1e5);
            }
            .help-modal-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 1rem 1.5rem 1.5rem 1.5rem;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                flex-shrink: 0;
            }
            :root.light-mode .help-modal-footer {
                border-top: 1px solid rgba(0, 0, 0, 0.05);
            }
            .github-btn {
                display: inline-flex;
                align-items: center;
                gap: 0.5rem;
                color: var(--on-surface-variant, #cac4d0);
                text-decoration: none;
                font-size: 0.8rem;
                font-weight: 600;
                padding: 6px 12px;
                border: 1px solid var(--outline, #49454f);
                border-radius: 8px;
                background: transparent;
                transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
                user-select: none;
                -webkit-user-select: none;
                cursor: pointer;
            }
            .github-btn:hover {
                color: var(--primary, #8859ff);
                border-color: var(--primary, #8859ff);
                background-color: rgba(255, 255, 255, 0.04);
            }
        `;
        (document.head || document.documentElement).appendChild(navStyle);
    }

    // Inject navigation and header styles immediately
    injectUniversalNavStyles();

    function initMobileDrawer() {
        let overlay = document.getElementById('astrong-mobile-drawer-overlay');
        let drawer = document.getElementById('astrong-mobile-drawer');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'astrong-mobile-drawer-overlay';
            overlay.className = 'mobile-drawer-overlay';
            document.body.appendChild(overlay);
        }

        if (!drawer) {
            drawer = document.createElement('aside');
            drawer.id = 'astrong-mobile-drawer';
            drawer.className = 'mobile-drawer';
            drawer.setAttribute('aria-label', 'Mobile Navigation Drawer');
            drawer.innerHTML = `
                <div class="mobile-drawer-header">
                    <a href="https://astrong.xyz" class="brand-pill" style="color: inherit; text-decoration: none;">
                        <div class="pfp-wrapper-small">
                            <img src="https://astrong.xyz/assets/images/pfp.png" alt="Austin Cookie Profile" class="pfp">
                        </div>
                        <span class="brand-name">astrong.xyz</span>
                    </a>
                    <button id="mobile-drawer-close" class="control-btn" aria-label="Close Navigation Menu">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
                <div class="mobile-drawer-body">
                    <div class="mobile-drawer-section">
                        <span class="mobile-drawer-section-title">Schedule</span>
                        <div class="mobile-nav-group">
                            <a href="https://schedule.astrong.xyz" class="mobile-nav-link">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                                <span>Schedule Hub</span>
                            </a>
                            <div class="mobile-nav-sublinks">
                                <a href="https://schedule.astrong.xyz/availability" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-check"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>
                                    <span>Availability</span>
                                </a>
                                <a href="https://schedule.astrong.xyz/starbucks" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-coffee"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12Z"/><path d="M6 2v2"/><path d="M17 12h1a3 3 0 0 1 0 6h-1"/></svg>
                                    <span>Starbucks Shifts</span>
                                </a>
                                <a href="https://schedule.astrong.xyz/school/" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-graduation-cap"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                                    <span>School Classes</span>
                                </a>
                                <a href="https://calendar.app.google/j4EnNgkWWep23ZZC7" target="_blank" rel="noopener noreferrer" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M10 16h4"/><path d="M12 14v4"/></svg>
                                    <span>Find a Time</span>
                                </a>
                            </div>
                        </div>
                    </div>

                    <div class="mobile-drawer-section">
                        <span class="mobile-drawer-section-title">Utilities</span>
                        <div class="mobile-nav-group">
                            <a href="https://utility.astrong.xyz" class="mobile-nav-link">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                                <span>Utilities Hub</span>
                            </a>
                            <div class="mobile-nav-sublinks">
                                <a href="https://utility.astrong.xyz/contrast" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-palette"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.92 0 1.7-.74 1.7-1.67 0-.42-.16-.82-.44-1.12-.27-.3-.43-.7-.43-1.13 0-.93.75-1.68 1.68-1.68h2.09c3.04 0 5.4-2.46 5.4-5.5 0-4.97-4.48-9-10-9z"/></svg>
                                    <span>Color Contrast</span>
                                </a>
                                <a href="https://utility.astrong.xyz/metar" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plane"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
                                    <span>METAR Weather</span>
                                </a>
                                <a href="https://utility.astrong.xyz/password" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-key-round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>
                                    <span>Password Generator</span>
                                </a>
                                <a href="https://utility.astrong.xyz/qrcode" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-qr-code"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/></svg>
                                    <span>QR Code</span>
                                </a>
                                <a href="https://utility.astrong.xyz/lorem" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-text"><path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/></svg>
                                    <span>Lorem Ipsum</span>
                                </a>
                                <a href="https://utility.astrong.xyz/progress" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-activity"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                                    <span>Progress Tracker</span>
                                </a>
                                <a href="https://utility.astrong.xyz/text" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-type"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
                                    <span>Text Toolkit</span>
                                </a>
                                <a href="https://utility.astrong.xyz/time" class="mobile-nav-sublink">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    <span>Exact Time</span>
                                </a>
                            </div>
                        </div>
                    </div>

                    <div class="mobile-drawer-section">
                        <span class="mobile-drawer-section-title">About</span>
                        <div class="mobile-nav-group">
                            <a href="https://about.astrong.xyz" class="mobile-nav-link">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                <span>About Austin</span>
                            </a>
                        </div>
                    </div>

                    <div class="mobile-drawer-section mobile-drawer-actions">
                        <span class="mobile-drawer-section-title">More</span>
                        <div class="mobile-actions-list">
                            <button id="mobile-drawer-settings-btn" class="mobile-action-item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                <span>Settings</span>
                            </button>
                            <button id="mobile-drawer-help-btn" class="mobile-action-item">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                <span>Help & Shortcuts</span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(drawer);
        }

        function openDrawer() {
            console.log('[Navigation] Mobile drawer opened');
            document.body.classList.add('mobile-drawer-open');
        }

        function closeDrawer() {
            console.log('[Navigation] Mobile drawer closed');
            document.body.classList.remove('mobile-drawer-open');
        }

        // Connect hamburger button(s)
        document.querySelectorAll('#mobile-menu-btn, .mobile-menu-btn').forEach(btn => {
            if (!btn.dataset.drawerBound) {
                btn.dataset.drawerBound = 'true';
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    openDrawer();
                });
            }
        });

        // Close button
        const closeBtn = drawer.querySelector('#mobile-drawer-close');
        if (closeBtn && !closeBtn.dataset.bound) {
            closeBtn.dataset.bound = 'true';
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeDrawer();
            });
        }

        // Overlay click
        if (overlay && !overlay.dataset.bound) {
            overlay.dataset.bound = 'true';
            overlay.addEventListener('click', closeDrawer);
        }

        // ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.body.classList.contains('mobile-drawer-open')) {
                closeDrawer();
            }
        });

        // Close on navigation link click
        drawer.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                closeDrawer();
            });
        });

        // Settings & Help actions
        const settingsAction = drawer.querySelector('#mobile-drawer-settings-btn');
        if (settingsAction && !settingsAction.dataset.bound) {
            settingsAction.dataset.bound = 'true';
            settingsAction.addEventListener('click', (e) => {
                e.preventDefault();
                closeDrawer();
                if (typeof window.openSettingsModal === 'function') {
                    window.openSettingsModal();
                } else {
                    const btn = document.getElementById('settings-btn') || document.getElementById('settings-toggle');
                    if (btn) btn.click();
                }
            });
        }

        const helpAction = drawer.querySelector('#mobile-drawer-help-btn');
        if (helpAction && !helpAction.dataset.bound) {
            helpAction.dataset.bound = 'true';
            helpAction.addEventListener('click', (e) => {
                e.preventDefault();
                closeDrawer();
                if (typeof window.openHelpModal === 'function') {
                    window.openHelpModal();
                } else {
                    const btn = document.getElementById('help-btn');
                    if (btn) btn.click();
                }
            });
        }
    }

    function initUniversalModals() {
        let settingsModal = document.getElementById('settings-modal');
        if (!settingsModal) {
            settingsModal = document.createElement('div');
            settingsModal.id = 'settings-modal';
            settingsModal.className = 'settings-modal';
            settingsModal.setAttribute('aria-hidden', 'true');
            settingsModal.innerHTML = `
                <div class="settings-modal-overlay"></div>
                <div class="settings-modal-container">
                    <div class="settings-modal-header">
                        <h3 class="settings-modal-title">Settings</h3>
                        <button id="settings-close-btn" class="settings-close-btn" aria-label="Close dialog">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                    </div>
                    <div class="settings-modal-body">
                        <section class="settings-section">
                            <h4>Accent Color</h4>
                            <div class="custom-select" id="accent-select">
                                <div class="select-trigger" role="button" aria-haspopup="listbox">
                                    <span class="select-trigger-text">Select Accent</span>
                                    <svg class="select-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                </div>
                                <div class="select-options" role="listbox">
                                    <div class="select-option option-red" data-value="red" role="option">Red</div>
                                    <div class="select-option option-orange" data-value="orange" role="option">Orange</div>
                                    <div class="select-option option-yellow" data-value="yellow" role="option">Yellow</div>
                                    <div class="select-option option-green" data-value="green" role="option">Green</div>
                                    <div class="select-option option-blue" data-value="blue" role="option">Blue</div>
                                    <div class="select-option option-purple" data-value="purple" role="option">Purple</div>
                                    <div class="select-option option-white" data-value="white" role="option">White</div>
                                </div>
                            </div>
                        </section>
                        <section class="settings-section">
                            <h4>Appearance</h4>
                            <div class="appearance-toggle-container">
                                <span class="appearance-toggle-label">Theme Mode</span>
                                <div class="theme-toggle-pill" id="theme-toggle-pill" role="button" aria-label="Toggle theme" data-active="dark">
                                    <div class="toggle-pill-thumb"></div>
                                    <div class="toggle-pill-option option-light" data-mode="light">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                                    </div>
                                    <div class="toggle-pill-option option-dark" data-mode="dark">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            `;
            document.body.appendChild(settingsModal);
        }

        let helpModal = document.getElementById('help-modal');
        if (!helpModal) {
            helpModal = document.createElement('div');
            helpModal.id = 'help-modal';
            helpModal.className = 'help-modal';
            helpModal.setAttribute('aria-hidden', 'true');
            helpModal.innerHTML = `
                <div class="help-modal-overlay"></div>
                <div class="help-modal-container">
                    <div class="help-modal-header">
                        <h3 class="help-modal-title">Help & Info</h3>
                        <button id="help-close-btn" class="help-close-btn" aria-label="Close dialog">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                    </div>
                    <div class="help-modal-body">
                        <section class="help-section context-menu-help">
                            <h4>Custom Context Menu</h4>
                            <p>Right-click or long-press anywhere to open the custom menu. Right-click twice in quick succession to open the default browser menu.</p>
                        </section>
                        <section class="help-section shortcuts-section">
                            <h4>Keyboard Shortcuts</h4>
                            <div class="shortcut-list">
                                <div class="shortcut-item">
                                    <span class="shortcut-keys"><kbd>Ctrl</kbd><span class="plus-sign">+</span><kbd>K</kbd></span>
                                    <span>Open Command Palette</span>
                                </div>
                                <div class="shortcut-item">
                                    <kbd>Esc</kbd>
                                    <span>Close menu / Go back</span>
                                </div>
                            </div>
                        </section>
                    </div>
                    <div class="help-modal-footer">
                        <a href="https://github.com/austinkden/austinkden.github.io" target="_blank" rel="noopener noreferrer" class="github-btn" aria-label="View Source on GitHub">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
                            Source Code
                        </a>
                        <a href="javascript:void(0)" class="github-btn help-device-btn" title="Click to copy Device ID">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
                            Device: <span class="device-id-display">--------</span>
                        </a>
                    </div>
                </div>
            `;
            document.body.appendChild(helpModal);
        }

        function openSettingsModal() {
            const modal = document.getElementById('settings-modal');
            if (!modal) return;
            console.log('[Modal] Settings modal opened');
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');

            const isSubHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
            const savedAccent = getThemeCookie('astrong_accent') || (!isSubHost ? localStorage.getItem('astrong_accent') : null) || 'purple';
            const savedMode = getThemeCookie('astrong_mode') || (!isSubHost ? localStorage.getItem('astrong_mode') : null) || 'dark';

            syncSettingsUI(savedAccent, savedMode);
        }

        function closeSettingsModal() {
            const modal = document.getElementById('settings-modal');
            if (modal) {
                console.log('[Modal] Settings modal closed');
                modal.classList.remove('active');
                modal.setAttribute('aria-hidden', 'true');
            }
            const accentSelect = document.getElementById('accent-select');
            const optionsEl = document.querySelector('.select-options');
            if (accentSelect) accentSelect.classList.remove('open');
            if (optionsEl) optionsEl.style.display = 'none';
        }

        function openHelpModal() {
            const modal = document.getElementById('help-modal');
            if (!modal) return;
            console.log('[Modal] Help & shortcuts modal opened');
            modal.classList.add('active');
            modal.setAttribute('aria-hidden', 'false');

            const deviceSpans = modal.querySelectorAll('.device-id-display');
            deviceSpans.forEach(span => {
                span.textContent = window.__ASTRONG_DEVICE_ID__ || '--------';
            });
        }

        function closeHelpModal() {
            const modal = document.getElementById('help-modal');
            if (modal) {
                console.log('[Modal] Help & shortcuts modal closed');
                modal.classList.remove('active');
                modal.setAttribute('aria-hidden', 'true');
            }
        }

        // Export globally so all handlers can reach them
        window.openSettingsModal = openSettingsModal;
        window.closeSettingsModal = closeSettingsModal;
        window.openHelpModal = openHelpModal;
        window.closeHelpModal = closeHelpModal;

        // Wire Settings Modal controls if not already bound
        if (!settingsModal.dataset.bound) {
            settingsModal.dataset.bound = 'true';
            const closeBtn = settingsModal.querySelector('#settings-close-btn');
            if (closeBtn) closeBtn.addEventListener('click', closeSettingsModal);

            const overlay = settingsModal.querySelector('.settings-modal-overlay');
            if (overlay) overlay.addEventListener('click', closeSettingsModal);

            const themeTogglePill = settingsModal.querySelector('#theme-toggle-pill');
            if (themeTogglePill) {
                themeTogglePill.addEventListener('click', () => {
                    const isSubHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
                    const currentMode = getThemeCookie('astrong_mode') || (!isSubHost ? localStorage.getItem('astrong_mode') : null) || 'dark';
                    const nextMode = currentMode === 'dark' ? 'light' : 'dark';

                    setThemeCookie('astrong_mode', nextMode);
                    try { localStorage.setItem('astrong_mode', nextMode); } catch (e) {}

                    const savedAccent = getThemeCookie('astrong_accent') || (!isSubHost ? localStorage.getItem('astrong_accent') : null) || 'purple';
                    applyTheme(savedAccent, nextMode);
                });
            }

            const accentSelect = settingsModal.querySelector('#accent-select');
            if (accentSelect) {
                const trigger = accentSelect.querySelector('.select-trigger');
                const triggerText = accentSelect.querySelector('.select-trigger-text');
                const optionsEl = accentSelect.querySelector('.select-options');
                const options = accentSelect.querySelectorAll('.select-option');

                if (trigger && optionsEl) {
                    // Move options panel to document.body so it escapes any clipping
                    document.body.appendChild(optionsEl);
                    optionsEl.style.position = 'fixed';
                    optionsEl.style.zIndex = '99999';

                    function positionDropdown() {
                        const rect = trigger.getBoundingClientRect();
                        optionsEl.style.top = (rect.bottom + 6) + 'px';
                        optionsEl.style.left = rect.left + 'px';
                        optionsEl.style.width = rect.width + 'px';
                    }

                    let isOpen = false;
                    function openDropdown() {
                        isOpen = true;
                        accentSelect.classList.add('open');
                        optionsEl.style.display = 'flex';
                        positionDropdown();
                    }
                    function closeDropdown() {
                        isOpen = false;
                        accentSelect.classList.remove('open');
                        optionsEl.style.display = 'none';
                    }

                    trigger.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (isOpen) closeDropdown();
                        else openDropdown();
                    });

                    options.forEach(option => {
                        option.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const themeName = option.getAttribute('data-value');

                            options.forEach(opt => opt.classList.remove('selected'));
                            option.classList.add('selected');

                            if (triggerText) {
                                triggerText.textContent = option.textContent;
                                triggerText.style.color = window.getComputedStyle(option).color;
                            }

                            setThemeCookie('astrong_accent', themeName);
                            try { localStorage.setItem('astrong_accent', themeName); } catch (e) {}

                            const isSubHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
                            const currentMode = getThemeCookie('astrong_mode') || (!isSubHost ? localStorage.getItem('astrong_mode') : null) || 'dark';
                            applyTheme(themeName, currentMode);
                            closeDropdown();
                        });
                    });

                    document.addEventListener('click', (e) => {
                        if (!trigger.contains(e.target) && !optionsEl.contains(e.target)) {
                            closeDropdown();
                        }
                    });

                    window.addEventListener('scroll', () => { if (isOpen) positionDropdown(); }, true);
                    window.addEventListener('resize', () => { if (isOpen) positionDropdown(); });
                }
            }
        }

        // Wire Help Modal controls if not already bound
        if (!helpModal.dataset.bound) {
            helpModal.dataset.bound = 'true';
            const helpCloseBtn = helpModal.querySelector('#help-close-btn');
            if (helpCloseBtn) helpCloseBtn.addEventListener('click', closeHelpModal);

            const helpOverlay = helpModal.querySelector('.help-modal-overlay');
            if (helpOverlay) helpOverlay.addEventListener('click', closeHelpModal);

            const helpDeviceBtn = helpModal.querySelector('.help-device-btn');
            if (helpDeviceBtn) {
                helpDeviceBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (window.__ASTRONG_DEVICE_ID__) {
                        navigator.clipboard.writeText(window.__ASTRONG_DEVICE_ID__).then(() => {
                            if (typeof window.showToast === 'function') {
                                window.showToast('Device ID copied to clipboard');
                            }
                        }).catch(() => {});
                    }
                });
            }
        }

        // Esc key closes modals
        if (!document.body.dataset.universalModalEscBound) {
            document.body.dataset.universalModalEscBound = 'true';
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
                    const cp = document.getElementById('astrong-cmd-palette');
                    const sm = document.getElementById('settings-modal');
                    const hm = document.getElementById('help-modal');
                    if (cp && cp.classList.contains('active')) {
                        if (typeof closeCommandPalette === 'function') {
                            closeCommandPalette();
                        } else {
                            cp.classList.remove('active');
                            cp.setAttribute('aria-hidden', 'true');
                        }
                        e.stopImmediatePropagation();
                    } else if (sm && sm.classList.contains('active')) {
                        closeSettingsModal();
                        e.stopImmediatePropagation();
                    } else if (hm && hm.classList.contains('active')) {
                        closeHelpModal();
                        e.stopImmediatePropagation();
                    }
                }
            }, true);
        }
    }

    function initUniversalHeader() {
        injectUniversalNavStyles();
        let existingHeader = document.querySelector('.top-controls-bar');
        
        if (!existingHeader) {
            existingHeader = document.createElement('div');
            existingHeader.className = 'top-controls-bar';
            existingHeader.id = 'astrong-universal-header';
            existingHeader.innerHTML = `
                <a href="https://astrong.xyz" class="brand-pill" style="color: inherit; text-decoration: none;">
                    <div class="pfp-wrapper-small">
                        <img src="https://astrong.xyz/assets/images/pfp.png" alt="Austin Cookie Profile" class="pfp">
                    </div>
                    <span class="brand-name">astrong.xyz</span>
                </a>
                <div class="controls-group">
                    <button id="search-btn" class="control-btn" aria-label="Command Palette" title="Command Palette (Ctrl+K)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <span class="btn-kbd"><kbd>Ctrl</kbd><kbd>K</kbd></span>
                    </button>
                    <button id="settings-btn" class="control-btn" aria-label="Settings" title="Settings">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    </button>
                    <button id="help-btn" class="control-btn" aria-label="Help" title="Help & Shortcuts">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    </button>
                    <button id="mobile-menu-btn" class="control-btn mobile-menu-btn" aria-label="Open Navigation Menu" title="Menu">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
                    </button>
                </div>
            `;
            document.body.prepend(existingHeader);
        }

        if (!existingHeader.querySelector('#mobile-menu-btn')) {
            const controlsGroup = existingHeader.querySelector('.controls-group');
            if (controlsGroup) {
                const mobBtn = document.createElement('button');
                mobBtn.id = 'mobile-menu-btn';
                mobBtn.className = 'control-btn mobile-menu-btn';
                mobBtn.setAttribute('aria-label', 'Open Navigation Menu');
                mobBtn.setAttribute('title', 'Menu');
                mobBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;
                controlsGroup.appendChild(mobBtn);
            }
        }

        initMobileDrawer();
        initUniversalModals();

        if (!existingHeader.querySelector('.hdr-nav')) {
            const brandPill = existingHeader.querySelector('.brand-pill');
            const navContainer = document.createElement('nav');
            navContainer.className = 'hdr-nav';
            navContainer.innerHTML = `
                <div class="hdr-dropdown-wrapper">
                    <a href="https://schedule.astrong.xyz" class="hdr-nav-btn">
                        <span>Schedule</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </a>
                    <div class="hdr-dropdown-menu">
                        <a href="https://schedule.astrong.xyz/availability" class="hdr-dropdown-item">Availability</a>
                        <a href="https://schedule.astrong.xyz/starbucks" class="hdr-dropdown-item">Starbucks Shifts</a>
                        <a href="https://schedule.astrong.xyz/school/" class="hdr-dropdown-item">School Classes</a>
                        <a href="https://calendar.app.google/j4EnNgkWWep23ZZC7" target="_blank" rel="noopener noreferrer" class="hdr-dropdown-item">Find a Time</a>
                    </div>
                </div>
                <div class="hdr-dropdown-wrapper">
                    <a href="https://utility.astrong.xyz" class="hdr-nav-btn">
                        <span>Utilities</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </a>
                    <div class="hdr-dropdown-menu">
                        <a href="https://utility.astrong.xyz/contrast" class="hdr-dropdown-item">Color Contrast</a>
                        <a href="https://utility.astrong.xyz/metar" class="hdr-dropdown-item">METAR Weather</a>
                        <a href="https://utility.astrong.xyz/password" class="hdr-dropdown-item">Password Generator</a>
                        <a href="https://utility.astrong.xyz/qrcode" class="hdr-dropdown-item">QR Code Generator</a>
                        <a href="https://utility.astrong.xyz/lorem" class="hdr-dropdown-item">Lorem Ipsum</a>
                        <a href="https://utility.astrong.xyz/progress" class="hdr-dropdown-item">Progress Tracker</a>
                        <a href="https://utility.astrong.xyz/text" class="hdr-dropdown-item">Text Tools</a>
                        <a href="https://utility.astrong.xyz/time" class="hdr-dropdown-item">Time Converter</a>
                    </div>
                </div>
                <div class="hdr-dropdown-wrapper">
                    <a href="https://about.astrong.xyz" class="hdr-nav-btn">
                        <span>About</span>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </a>
                    <div class="hdr-dropdown-menu">
                        <a href="https://about.astrong.xyz" class="hdr-dropdown-item">About Austin</a>
                    </div>
                </div>
            `;

            if (brandPill) {
                brandPill.insertAdjacentElement('afterend', navContainer);
            } else {
                existingHeader.prepend(navContainer);
            }

            // Portal-based dropdown: move each menu to body so CSS :hover can never interfere
            existingHeader.querySelectorAll('.hdr-dropdown-wrapper').forEach(wrapper => {
                const menu = wrapper.querySelector('.hdr-dropdown-menu');
                if (!menu) return;

                // Move menu to body as a portal
                document.body.appendChild(menu);
                menu.style.position = 'fixed';
                menu.style.display = 'none';
                menu.style.flexDirection = 'column';
                menu.style.gap = '2px';

                let closeTimer = null;
                let isOpen = false;

                function positionMenu() {
                    const triggerRect = wrapper.getBoundingClientRect();
                    let left = triggerRect.left;
                    const menuWidth = menu.offsetWidth || 185;
                    if (left + menuWidth > window.innerWidth - 8) {
                        left = window.innerWidth - menuWidth - 8;
                    }
                    if (left < 8) {
                        left = 8;
                    }
                    menu.style.left = left + 'px';
                    menu.style.top = (triggerRect.bottom + 2) + 'px';
                }

                function openMenu() {
                    isOpen = true;
                    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
                    // Close all other portal dropdowns
                    document.querySelectorAll('.hdr-dropdown-menu').forEach(m => {
                        if (m !== menu) { m.style.display = 'none'; }
                    });
                    menu.style.display = 'flex';
                    positionMenu();
                }

                function closeMenu(delay) {
                    if (closeTimer) clearTimeout(closeTimer);
                    closeTimer = setTimeout(() => {
                        isOpen = false;
                        menu.style.display = 'none';
                    }, delay || 0);
                }

                wrapper.addEventListener('mouseenter', openMenu);
                wrapper.addEventListener('mouseleave', () => closeMenu(200));
                wrapper.addEventListener('click', (e) => {
                    const isTouch = window.matchMedia('(hover: none)').matches || window.innerWidth <= 768;
                    if (isTouch) {
                        if (!isOpen) {
                            e.preventDefault();
                            openMenu();
                        }
                    }
                });

                menu.addEventListener('mouseenter', () => {
                    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
                });
                menu.addEventListener('mouseleave', () => closeMenu(200));

                document.addEventListener('click', (e) => {
                    if (!wrapper.contains(e.target) && !menu.contains(e.target)) {
                        closeMenu(0);
                    }
                });

                window.addEventListener('resize', () => { if (isOpen) positionMenu(); });
                window.addEventListener('scroll', () => { if (isOpen) positionMenu(); }, true);
            });
        }

        // Re-attach header control buttons if dynamically created
        const searchBtn = existingHeader.querySelector('#search-btn');
        if (searchBtn && !searchBtn.dataset.bound) {
            searchBtn.dataset.bound = 'true';
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openCommandPalette();
            });
        }

        const settingsBtn = existingHeader.querySelector('#settings-btn');
        if (settingsBtn && !settingsBtn.dataset.bound) {
            settingsBtn.dataset.bound = 'true';
            settingsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof window.openSettingsModal === 'function') {
                    window.openSettingsModal();
                }
            });
        }

        const helpBtn = existingHeader.querySelector('#help-btn');
        if (helpBtn && !helpBtn.dataset.bound) {
            helpBtn.dataset.bound = 'true';
            helpBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof window.openHelpModal === 'function') {
                    window.openHelpModal();
                }
            });
        }

        function updateHeaderSpacing() {
            const header = document.querySelector('.top-controls-bar');
            const brandPill = header ? header.querySelector('.brand-pill') : null;
            if (header && brandPill) {
                const headerRect = header.getBoundingClientRect();
                const brandRect = brandPill.getBoundingClientRect();
                const spacing = Math.max(headerRect.bottom - brandRect.bottom, 0);
                const headerHeight = headerRect.height;
                document.documentElement.style.setProperty('--astrong-header-height', `${headerHeight}px`);
                document.documentElement.style.setProperty('--astrong-header-spacing', `${spacing}px`);
                document.documentElement.style.setProperty('--astrong-header-left', `${brandRect.left}px`);
            }
        }
        updateHeaderSpacing();
        window.addEventListener('resize', updateHeaderSpacing);
        window.addEventListener('orientationchange', updateHeaderSpacing);
    }

    function initUniversalFooter() {
        injectUniversalNavStyles();
        if (document.getElementById('astrong-site-footer')) return;

        const footer = document.createElement('footer');
        footer.id = 'astrong-site-footer';
        footer.className = 'site-footer';
        footer.innerHTML = `
            <div class="site-footer-inner">
                <div class="site-footer-top">
                    <div class="site-footer-brand">
                        <div class="site-footer-brand-title">
                            <a href="https://astrong.xyz" class="brand-pill" style="color: inherit; text-decoration: none; display: flex; align-items: center; gap: 0.55rem;">
                                <div class="pfp-wrapper-small">
                                    <img src="https://astrong.xyz/assets/images/pfp.png" alt="Austin Cookie Profile" class="pfp">
                                </div>
                                <span class="site-footer-logo">astrong.xyz</span>
                            </a>
                        </div>
                        <span class="site-footer-device">Device ID: <span class="device-id-display" id="footer-device-id-display" title="Click to copy Device ID">${window.__ASTRONG_DEVICE_ID__ || '--------'}</span></span>
                    </div>
                    <div class="site-footer-nav">
                        <div class="site-footer-col">
                            <span class="site-footer-col-title">Navigation</span>
                            <a href="https://astrong.xyz">Home</a>
                            <a href="https://schedule.astrong.xyz">Schedule</a>
                            <a href="https://utility.astrong.xyz">Utilities</a>
                            <a href="https://about.astrong.xyz">About</a>
                        </div>
                        <div class="site-footer-col">
                            <span class="site-footer-col-title">CONTACT & LEGAL</span>
                            <a href="mailto:austin@astrong.xyz" class="site-footer-email-highlight">austin@astrong.xyz</a>
                            <a href="https://astrong.xyz/terms">Terms of Service</a>
                            <a href="https://astrong.xyz/privacy">Privacy Policy</a>
                        </div>
                    </div>
                </div>
                <div class="site-footer-bottom">
                    <span class="site-footer-copyright">&copy; 2026 Austin Strong. All rights reserved.</span>
                </div>
            </div>
        `;
        document.body.appendChild(footer);
    }

    // Global Header & Footer Profile Picture Cookie Navigation
    document.addEventListener('click', (e) => {
        const pfpCookie = e.target.closest('.top-controls-bar .pfp-wrapper-small, .site-footer .pfp-wrapper-small, .site-footer-brand .pfp-wrapper-small, .mobile-drawer .pfp-wrapper-small, .brand-pill .pfp-wrapper-small');
        if (pfpCookie) {
            e.preventDefault();
            const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
            const isSubHost = window.location.hostname !== 'astrong.xyz' && window.location.hostname.endsWith('astrong.xyz');
            const isHomePath = window.location.pathname === '/' || window.location.pathname === '/index.html' || window.location.pathname === '';
            
            if (!isSubHost && isHomePath) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const target = (isLocal || !isSubHost) ? '/' : 'https://astrong.xyz';
                window.location.href = target;
            }
        }
    });

    // -------------------------------------------------------------------------
    // Universal Interactive Rotating Cookie Clip & SVG Morph System
    // -------------------------------------------------------------------------
    function initCookieAvatarClip() {
        const SHAPES = [
            {
                id: 'nine-sided-cookie',
                name: '9-sided cookie',
                d: 'M0.3955 0.0590C0.4007 0.0547 0.4033 0.0526 0.4057 0.0508C0.4615 0.0081 0.5385 0.0081 0.5943 0.0508C0.5967 0.0526 0.5993 0.0547 0.6045 0.0590C0.6068 0.0609 0.6079 0.0619 0.6091 0.0628C0.6354 0.0837 0.6675 0.0955 0.7010 0.0966C0.7024 0.0966 0.7039 0.0966 0.7069 0.0967C0.7136 0.0968 0.7170 0.0968 0.7199 0.0970C0.7898 0.1005 0.8488 0.1506 0.8644 0.2195C0.8651 0.2224 0.8657 0.2257 0.8670 0.2324C0.8675 0.2353 0.8678 0.2368 0.8681 0.2383C0.8749 0.2713 0.8921 0.3013 0.9170 0.3238C0.9181 0.3248 0.9192 0.3258 0.9215 0.3277C0.9265 0.3321 0.9291 0.3343 0.9313 0.3364C0.9825 0.3845 0.9959 0.4612 0.9640 0.5241C0.9627 0.5267 0.9610 0.5297 0.9577 0.5356C0.9563 0.5382 0.9556 0.5396 0.9549 0.5409C0.9391 0.5706 0.9331 0.6047 0.9379 0.6381C0.9381 0.6396 0.9383 0.6411 0.9388 0.6440C0.9399 0.6507 0.9404 0.6541 0.9408 0.6570C0.9495 0.7272 0.9109 0.7946 0.8465 0.8221C0.8438 0.8232 0.8406 0.8244 0.8343 0.8268C0.8315 0.8279 0.8301 0.8284 0.8288 0.8290C0.7978 0.8415 0.7715 0.8638 0.7539 0.8925C0.7531 0.8937 0.7524 0.8950 0.7508 0.8976C0.7474 0.9034 0.7457 0.9063 0.7441 0.9089C0.7061 0.9682 0.6337 0.9948 0.5668 0.9740C0.5640 0.9732 0.5608 0.9720 0.5545 0.9698C0.5517 0.9688 0.5503 0.9683 0.5489 0.9679C0.5171 0.9573 0.4829 0.9573 0.4511 0.9679C0.4497 0.9683 0.4483 0.9688 0.4455 0.9698C0.4392 0.9720 0.4360 0.9732 0.4332 0.9740C0.3663 0.9948 0.2939 0.9682 0.2559 0.9089C0.2543 0.9063 0.2526 0.9034 0.2492 0.8976C0.2476 0.8950 0.2469 0.8937 0.2461 0.8925C0.2285 0.8638 0.2022 0.8415 0.1712 0.8290C0.1699 0.8284 0.1685 0.8279 0.1657 0.8268C0.1594 0.8244 0.1562 0.8232 0.1535 0.8221C0.0891 0.7946 0.0505 0.7272 0.0592 0.6570C0.0596 0.6541 0.0601 0.6507 0.0612 0.6440C0.0617 0.6411 0.0619 0.6396 0.0621 0.6381C0.0669 0.6047 0.0609 0.5706 0.0451 0.5409C0.0444 0.5396 0.0437 0.5382 0.0423 0.5356C0.0390 0.5297 0.0373 0.5267 0.0360 0.5241C0.0041 0.4612 0.0175 0.3845 0.0687 0.3364C0.0709 0.3343 0.0735 0.3321 0.0785 0.3277C0.0808 0.3258 0.0819 0.3248 0.0830 0.3238C0.1079 0.3013 0.1251 0.2713 0.1319 0.2383C0.1322 0.2368 0.1325 0.2353 0.1330 0.2324C0.1343 0.2257 0.1349 0.2224 0.1356 0.2195C0.1512 0.1506 0.2102 0.1005 0.2801 0.0970C0.2830 0.0968 0.2864 0.0968 0.2931 0.0967C0.2961 0.0966 0.2976 0.0966 0.2990 0.0966C0.3325 0.0955 0.3646 0.0837 0.3909 0.0628C0.3921 0.0619 0.3932 0.0609 0.3955 0.0590Z'
            },
            {
                id: 'twelve-sided-cookie',
                name: '12-sided cookie',
                d: 'M0.4272 0.0308C0.4289 0.0291 0.4297 0.0283 0.4304 0.0276C0.4695 -0.0092 0.5305 -0.0092 0.5696 0.0276C0.5703 0.0283 0.5711 0.0291 0.5728 0.0308C0.5738 0.0318 0.5743 0.0323 0.5748 0.0327C0.5998 0.0566 0.6353 0.0661 0.6688 0.0579C0.6695 0.0578 0.6702 0.0576 0.6715 0.0572C0.6738 0.0566 0.6750 0.0563 0.6760 0.0561C0.7282 0.0438 0.7810 0.0743 0.7964 0.1257C0.7967 0.1266 0.7970 0.1278 0.7977 0.1300C0.7981 0.1314 0.7983 0.1321 0.7984 0.1327C0.8082 0.1659 0.8341 0.1918 0.8673 0.2016C0.8679 0.2017 0.8686 0.2019 0.8700 0.2023C0.8722 0.2030 0.8734 0.2033 0.8743 0.2036C0.9257 0.2190 0.9562 0.2718 0.9439 0.3240C0.9437 0.3250 0.9434 0.3262 0.9428 0.3285C0.9424 0.3298 0.9422 0.3305 0.9421 0.3312C0.9339 0.3647 0.9434 0.4002 0.9673 0.4252C0.9677 0.4257 0.9682 0.4262 0.9692 0.4272C0.9709 0.4289 0.9717 0.4297 0.9724 0.4304C1.0092 0.4695 1.0092 0.5305 0.9724 0.5696C0.9717 0.5703 0.9709 0.5711 0.9692 0.5728C0.9682 0.5738 0.9677 0.5743 0.9673 0.5748C0.9434 0.5998 0.9339 0.6353 0.9421 0.6688C0.9422 0.6695 0.9424 0.6702 0.9428 0.6715C0.9434 0.6738 0.9437 0.6750 0.9439 0.6760C0.9562 0.7282 0.9257 0.7810 0.8743 0.7964C0.8734 0.7967 0.8722 0.7970 0.8700 0.7977C0.8686 0.7981 0.8679 0.7983 0.8673 0.7984C0.8341 0.8082 0.8082 0.8341 0.7984 0.8673C0.7983 0.8679 0.7981 0.8686 0.7977 0.8700C0.7970 0.8722 0.7967 0.8734 0.7964 0.8743C0.7810 0.9257 0.7282 0.9562 0.6760 0.9439C0.6750 0.9437 0.6738 0.9434 0.6715 0.9428C0.6702 0.9424 0.6695 0.9422 0.6688 0.9421C0.6353 0.9339 0.5998 0.9434 0.5748 0.9673C0.5743 0.9677 0.5738 0.9682 0.5728 0.9692C0.5711 0.9709 0.5703 0.9717 0.5696 0.9724C0.5305 1.0092 0.4695 1.0092 0.4304 0.9724C0.4297 0.9717 0.4289 0.9709 0.4272 0.9692C0.4262 0.9682 0.4257 0.9677 0.4252 0.9673C0.4002 0.9434 0.3647 0.9339 0.3312 0.9421C0.3305 0.9422 0.3298 0.9424 0.3285 0.9428C0.3262 0.9434 0.3250 0.9437 0.3240 0.9439C0.2718 0.9562 0.2190 0.9257 0.2036 0.8743C0.2033 0.8734 0.2030 0.8722 0.2023 0.8700C0.2019 0.8686 0.2017 0.8679 0.2016 0.8673C0.1918 0.8341 0.1659 0.8082 0.1327 0.7984C0.1321 0.7983 0.1314 0.7981 0.1300 0.7977C0.1278 0.7970 0.1266 0.7967 0.1257 0.7964C0.0743 0.7810 0.0438 0.7282 0.0561 0.6760C0.0563 0.6750 0.0566 0.6738 0.0572 0.6715C0.0576 0.6702 0.0578 0.6695 0.0579 0.6688C0.0661 0.6353 0.0566 0.5998 0.0327 0.5748C0.0323 0.5743 0.0318 0.5738 0.0308 0.5728C0.0291 0.5711 0.0283 0.5703 0.0276 0.5696C-0.0092 0.5305 -0.0092 0.4695 0.0276 0.4304C0.0283 0.4297 0.0291 0.4289 0.0308 0.4272C0.0318 0.4262 0.0323 0.4257 0.0327 0.4252C0.0566 0.4002 0.0661 0.3647 0.0579 0.3312C0.0578 0.3305 0.0576 0.3298 0.0572 0.3285C0.0566 0.3262 0.0563 0.3250 0.0561 0.3240C0.0438 0.2718 0.0743 0.2190 0.1257 0.2036C0.1266 0.2033 0.1278 0.2030 0.1300 0.2023C0.1314 0.2019 0.1321 0.2017 0.1327 0.2016C0.1659 0.1918 0.1918 0.1659 0.2016 0.1327C0.2017 0.1321 0.2019 0.1314 0.2023 0.1300C0.2030 0.1278 0.2033 0.1266 0.2036 0.1257C0.2190 0.0743 0.2718 0.0438 0.3240 0.0561C0.3250 0.0563 0.3262 0.0566 0.3285 0.0572C0.3298 0.0576 0.3305 0.0578 0.3312 0.0579C0.3647 0.0661 0.4002 0.0566 0.4252 0.0327C0.4257 0.0323 0.4262 0.0318 0.4272 0.0308Z'
            },
            {
                id: 'sunny',
                name: 'sunny',
                d: 'M0.7702 0.1213C0.8013 0.1234 0.8168 0.1245 0.8294 0.1300C0.8476 0.1379 0.8621 0.1524 0.8700 0.1706C0.8755 0.1832 0.8766 0.1987 0.8787 0.2298L0.8835 0.3008C0.8844 0.3134 0.8848 0.3197 0.8862 0.3257C0.8882 0.3344 0.8916 0.3427 0.8963 0.3502C0.8996 0.3554 0.9038 0.3602 0.9121 0.3696L0.9588 0.4232C0.9793 0.4467 0.9896 0.4585 0.9946 0.4713C1.0018 0.4897 1.0018 0.5103 0.9946 0.5287C0.9896 0.5415 0.9793 0.5533 0.9588 0.5768L0.9121 0.6303C0.9038 0.6399 0.8996 0.6446 0.8963 0.6498C0.8916 0.6573 0.8882 0.6656 0.8862 0.6743C0.8848 0.6803 0.8844 0.6866 0.8835 0.6992L0.8787 0.7702C0.8766 0.8013 0.8755 0.8168 0.8700 0.8294C0.8621 0.8476 0.8476 0.8621 0.8294 0.8700C0.8168 0.8755 0.8013 0.8766 0.7702 0.8787L0.6992 0.8835C0.6866 0.8844 0.6803 0.8848 0.6743 0.8862C0.6656 0.8882 0.6573 0.8916 0.6498 0.8963C0.6446 0.8996 0.6399 0.9038 0.6303 0.9121L0.5768 0.9588C0.5533 0.9793 0.5415 0.9896 0.5287 0.9946C0.5103 1.0018 0.4897 1.0018 0.4713 0.9946C0.4585 0.9896 0.4467 0.9793 0.4232 0.9588L0.3696 0.9121C0.3602 0.9038 0.3554 0.8996 0.3502 0.8963C0.3427 0.8916 0.3344 0.8882 0.3257 0.8862C0.3197 0.8848 0.3134 0.8844 0.3008 0.8835L0.2298 0.8787C0.1987 0.8766 0.1832 0.8755 0.1706 0.8700C0.1524 0.8621 0.1379 0.8476 0.1300 0.8294C0.1245 0.8168 0.1234 0.8013 0.1213 0.7702L0.1165 0.6992C0.1156 0.6866 0.1152 0.6803 0.1138 0.6743C0.1118 0.6656 0.1084 0.6573 0.1037 0.6498C0.1004 0.6446 0.0962 0.6399 0.0879 0.6303L0.0412 0.5768C0.0207 0.5533 0.0104 0.5415 0.0054 0.5287C-0.0018 0.5103 -0.0018 0.4897 0.0054 0.4713C0.0104 0.4585 0.0207 0.4467 0.0412 0.4232L0.0879 0.3696C0.0962 0.3602 0.1004 0.3554 0.1037 0.3502C0.1084 0.3427 0.1118 0.3344 0.1138 0.3257C0.1152 0.3197 0.1156 0.3134 0.1165 0.3008L0.1213 0.2298C0.1234 0.1987 0.1245 0.1832 0.1300 0.1706C0.1379 0.1524 0.1524 0.1379 0.1706 0.1300C0.1832 0.1245 0.1987 0.1234 0.2298 0.1213L0.3008 0.1165C0.3134 0.1156 0.3197 0.1152 0.3257 0.1138C0.3344 0.1118 0.3427 0.1084 0.3502 0.1037C0.3554 0.1004 0.3602 0.0962 0.3696 0.0879L0.4232 0.0412C0.4467 0.0207 0.4585 0.0104 0.4713 0.0054C0.4897 -0.0018 0.5103 -0.0018 0.5287 0.0054C0.5415 0.0104 0.5533 0.0207 0.5768 0.0412L0.6303 0.0879C0.6399 0.0962 0.6446 0.1004 0.6498 0.1037C0.6573 0.1084 0.6656 0.1118 0.6743 0.1138C0.6803 0.1152 0.6866 0.1156 0.6992 0.1165L0.7702 0.1213Z'
            },
            {
                id: 'four-sided-cookie',
                name: '4-sided cookie',
                d: 'M0.6154 0.1012C0.7947 0.0233 0.9767 0.2053 0.8988 0.3846L0.8859 0.4142C0.8622 0.4689 0.8622 0.5311 0.8859 0.5858L0.8988 0.6154C0.9767 0.7947 0.7947 0.9767 0.6154 0.8988L0.5858 0.8859C0.5311 0.8622 0.4689 0.8622 0.4142 0.8859L0.3846 0.8988C0.2053 0.9767 0.0233 0.7947 0.1012 0.6154L0.1141 0.5858C0.1378 0.5311 0.1378 0.4689 0.1141 0.4142L0.1012 0.3846C0.0233 0.2053 0.2053 0.0233 0.3846 0.1012L0.4142 0.1141C0.4689 0.1378 0.5311 0.1378 0.5858 0.1141L0.6154 0.1012Z'
            },
            {
                id: 'pentagon',
                name: 'pentagon',
                d: 'M0.4023 0.1144C0.4606 0.0720 0.5394 0.0720 0.5977 0.1144L0.8674 0.3103C0.9256 0.3526 0.9500 0.4276 0.9277 0.4961L0.8247 0.8131C0.8025 0.8816 0.7387 0.9280 0.6667 0.9280H0.3333C0.2613 0.9280 0.1975 0.8816 0.1753 0.8131L0.0723 0.4961C0.0500 0.4276 0.0744 0.3526 0.1326 0.3103L0.4023 0.1144Z'
            },
            {
                id: 'six-sided-cookie',
                name: '6-sided cookie',
                d: 'M0.3314 0.0909C0.4253 0.0000 0.5747 0.0000 0.6686 0.0909C0.6973 0.1187 0.7325 0.1390 0.7711 0.1499C0.8970 0.1855 0.9717 0.3145 0.9397 0.4410C0.9299 0.4797 0.9299 0.5203 0.9397 0.5590C0.9717 0.6855 0.8970 0.8145 0.7711 0.8501C0.7325 0.8610 0.6973 0.8813 0.6686 0.9091C0.5747 1.0000 0.4253 1.0000 0.3314 0.9091C0.3027 0.8813 0.2675 0.8610 0.2289 0.8501C0.1030 0.8145 0.0283 0.6855 0.0603 0.5590C0.0701 0.5203 0.0701 0.4797 0.0603 0.4410C0.0283 0.3145 0.1030 0.1855 0.2289 0.1499C0.2675 0.1390 0.3027 0.1187 0.3314 0.0909Z'
            }
        ];

        // Master clipPath SVG container
        const svgNS = 'http://www.w3.org/2000/svg';
        let defsSvg = document.getElementById('astrong-cookie-defs');
        let activePathEl = document.getElementById('astrong-active-clip-path');

        if (!defsSvg) {
            defsSvg = document.createElementNS(svgNS, 'svg');
            defsSvg.setAttribute('id', 'astrong-cookie-defs');
            defsSvg.setAttribute('width', '0');
            defsSvg.setAttribute('height', '0');
            defsSvg.setAttribute('aria-hidden', 'true');
            defsSvg.setAttribute('style', 'position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none;');

            const defsEl = document.createElementNS(svgNS, 'defs');
            const clipPathEl = document.createElementNS(svgNS, 'clipPath');
            clipPathEl.setAttribute('id', 'astrong-active-clip');
            clipPathEl.setAttribute('clipPathUnits', 'objectBoundingBox');

            activePathEl = document.createElementNS(svgNS, 'path');
            activePathEl.setAttribute('id', 'astrong-active-clip-path');
            clipPathEl.appendChild(activePathEl);
            defsEl.appendChild(clipPathEl);
            defsSvg.appendChild(defsEl);
            (document.body || document.documentElement).appendChild(defsSvg);
        } else if (!activePathEl) {
            activePathEl = defsSvg.querySelector('#astrong-active-clip-path');
        }

        // Sample and align perimeter points for all 6 shapes
        const numPoints = 160;
        const shapePoints = {};
        const tempSvg = document.createElementNS(svgNS, 'svg');
        tempSvg.setAttribute('style', 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;');
        const tempPath = document.createElementNS(svgNS, 'path');
        tempSvg.appendChild(tempPath);
        (document.body || document.documentElement).appendChild(tempSvg);

        SHAPES.forEach(shape => {
            tempPath.setAttribute('d', shape.d);
            const totalLen = tempPath.getTotalLength();
            const raw = [];
            for (let i = 0; i < numPoints; i++) {
                const pt = tempPath.getPointAtLength((i / numPoints) * totalLen);
                raw.push({ x: pt.x, y: pt.y });
            }
            // Align start index to point closest to top-center (0.5, 0.0)
            let minD = Infinity;
            let startIdx = 0;
            for (let i = 0; i < raw.length; i++) {
                const dx = raw[i].x - 0.5;
                const dy = raw[i].y - 0.0;
                const d = dx * dx + dy * dy;
                if (d < minD) {
                    minD = d;
                    startIdx = i;
                }
            }
            shapePoints[shape.id] = [...raw.slice(startIdx), ...raw.slice(0, startIdx)];
        });

        if (tempSvg.parentNode) {
            tempSvg.parentNode.removeChild(tempSvg);
        }

        function buildPathString(pts) {
            return 'M' + pts.map(p => `${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' L') + 'Z';
        }

        // Retrieve persisted shape selection & direction (or defaults)
        let savedShapeIdx = parseInt(getRootCookie('astrong_cookie_shape'), 10);
        if (isNaN(savedShapeIdx) || savedShapeIdx < 0 || savedShapeIdx >= SHAPES.length) {
            savedShapeIdx = 0; // Default to 'nine-sided-cookie'
        }
        let currentShapeIndex = savedShapeIdx;

        let savedDir = parseInt(getRootCookie('astrong_cookie_dir'), 10);
        let targetDirection = (savedDir === -1) ? -1 : 1; // 1 = clockwise, -1 = counter-clockwise

        // Initialize current points
        let currentPoints = shapePoints[SHAPES[currentShapeIndex].id].map(p => ({ x: p.x, y: p.y }));
        if (activePathEl) {
            activePathEl.setAttribute('d', buildPathString(currentPoints));
        }

        // Shape morph animation controller
        let morphFrameId = null;
        function animateMorph(targetPts, duration = 360) {
            if (morphFrameId) cancelAnimationFrame(morphFrameId);
            const startPts = currentPoints.map(p => ({ x: p.x, y: p.y }));
            const startTime = performance.now();
            const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

            function tickMorph(now) {
                const elapsed = now - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = easeOutCubic(progress);

                for (let i = 0; i < numPoints; i++) {
                    currentPoints[i].x = startPts[i].x + (targetPts[i].x - startPts[i].x) * eased;
                    currentPoints[i].y = startPts[i].y + (targetPts[i].y - startPts[i].y) * eased;
                }

                if (activePathEl) {
                    activePathEl.setAttribute('d', buildPathString(currentPoints));
                }

                if (progress < 1) {
                    morphFrameId = requestAnimationFrame(tickMorph);
                } else {
                    morphFrameId = null;
                }
            }

            morphFrameId = requestAnimationFrame(tickMorph);
        }

        // Cycle to next shape
        let lastCycleTime = 0;
        function cycleShape() {
            const now = performance.now();
            if (now - lastCycleTime < 220) return;
            lastCycleTime = now;

            currentShapeIndex = (currentShapeIndex + 1) % SHAPES.length;
            setRootCookie('astrong_cookie_shape', currentShapeIndex, 365);

            const targetPts = shapePoints[SHAPES[currentShapeIndex].id];
            if (targetPts) {
                animateMorph(targetPts, 360);
            }
        }

        // Rotation physics & instant direction reversal
        const baseSpeed = 30; // 30 deg/sec = 12s per full 360deg rotation
        let currentAngularVelocity = targetDirection * baseSpeed;

        function reverseRotationDirection() {
            targetDirection = -targetDirection;
            setRootCookie('astrong_cookie_dir', targetDirection, 365);
            currentAngularVelocity = targetDirection * baseSpeed;
        }

        // Continuous physics loop: wrapper rotates, inner image/icon counter-rotates
        let currentAngle = 0;
        let lastFrameTime = performance.now();

        function tickRotation(now) {
            const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
            lastFrameTime = now;

            currentAngularVelocity = targetDirection * baseSpeed;
            currentAngle = (currentAngle + currentAngularVelocity * dt) % 360;
            if (currentAngle < 0) currentAngle += 360;

            const wrappers = document.querySelectorAll('.pfp-wrapper:not(.pfp-wrapper-small)');
            if (wrappers.length > 0) {
                const rotStr = `rotate(${currentAngle.toFixed(3)}deg)`;
                const counterRotStr = `rotate(${(-currentAngle).toFixed(3)}deg)`;
                for (let i = 0; i < wrappers.length; i++) {
                    const w = wrappers[i];
                    w.style.transform = rotStr;
                    const inner = w.querySelector('img, .pfp, .pfp-icon-content');
                    if (inner) {
                        inner.style.transform = counterRotStr;
                    }
                }
            }

            requestAnimationFrame(tickRotation);
        }

        requestAnimationFrame(tickRotation);

        // Interaction Event Listeners (Delegated on document)
        let longPressTimer = null;
        let isLongPressTriggered = false;
        let pointerStartX = 0;
        let pointerStartY = 0;

        document.addEventListener('pointerdown', (e) => {
            const wrapper = e.target.closest('.pfp-wrapper');
            if (!wrapper || wrapper.classList.contains('pfp-wrapper-small')) return;

            if (e.pointerType === 'mouse' && e.button === 2) {
                e.preventDefault();
                return;
            }

            isLongPressTriggered = false;
            pointerStartX = e.clientX;
            pointerStartY = e.clientY;

            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = setTimeout(() => {
                isLongPressTriggered = true;
                reverseRotationDirection();
                if (navigator.vibrate) {
                    try { navigator.vibrate(40); } catch (_) {}
                }
            }, 400);
        });

        document.addEventListener('pointermove', (e) => {
            if (longPressTimer) {
                const dx = e.clientX - pointerStartX;
                const dy = e.clientY - pointerStartY;
                if (dx * dx + dy * dy > 100) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            }
        });

        function cancelLongPress() {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }

        document.addEventListener('pointerup', cancelLongPress);
        document.addEventListener('pointercancel', cancelLongPress);

        document.addEventListener('contextmenu', (e) => {
            const wrapper = e.target.closest('.pfp-wrapper');
            if (wrapper && !wrapper.classList.contains('pfp-wrapper-small')) {
                e.preventDefault();
                e.stopPropagation();
                reverseRotationDirection();
            }
        });

        document.addEventListener('click', (e) => {
            const wrapper = e.target.closest('.pfp-wrapper');
            if (wrapper && !wrapper.classList.contains('pfp-wrapper-small')) {
                if (isLongPressTriggered) {
                    isLongPressTriggered = false;
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                cycleShape();
            }
        }, true);
    }

    function initCookieNotice() {
        const CONSENT_KEY = 'astrong_cookie_consent';
        if (getRootCookie(CONSENT_KEY) || localStorage.getItem(CONSENT_KEY)) {
            return;
        }

        const notice = document.createElement('div');
        notice.id = 'astrong-cookie-banner';
        notice.className = 'astrong-cookie-banner';
        notice.setAttribute('role', 'region');
        notice.setAttribute('aria-label', 'Cookie and Telemetry Notice');

        notice.innerHTML = `
            <div class="astrong-cookie-content">
                <span class="astrong-cookie-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 13v.01"/></svg>
                </span>
                <p class="astrong-cookie-text">
                    This site uses essential cookies and automated telemetry to maintain session state, track performance, and diagnose security issues. See our <a href="https://astrong.xyz/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
                </p>
            </div>
            <div class="astrong-cookie-actions">
                <button type="button" id="astrong-cookie-accept" class="astrong-cookie-btn">Got it</button>
            </div>
        `;

        if (!document.getElementById('astrong-cookie-styles')) {
            const style = document.createElement('style');
            style.id = 'astrong-cookie-styles';
            style.textContent = `
                .astrong-cookie-banner {
                    position: fixed;
                    bottom: 1.25rem;
                    right: 1.25rem;
                    max-width: 440px;
                    width: calc(100% - 2.5rem);
                    background-color: #15131b;
                    border: 1px solid #383442;
                    border-radius: 10px;
                    padding: 1rem 1.15rem;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 1rem;
                    z-index: 999999;
                    box-shadow: none !important;
                    font-family: 'Google Sans Flex', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    animation: astrongCookieSlideIn 0.3s ease forwards;
                    box-sizing: border-box;
                }
                @keyframes astrongCookieSlideIn {
                    from { opacity: 0; transform: translateY(12px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .astrong-cookie-banner.closing {
                    opacity: 0;
                    transform: translateY(12px);
                    transition: opacity 0.25s ease, transform 0.25s ease;
                }
                .astrong-cookie-content {
                    display: flex;
                    align-items: flex-start;
                    gap: 0.75rem;
                    flex: 1;
                    min-width: 0;
                }
                .astrong-cookie-icon {
                    color: #8859ff;
                    flex-shrink: 0;
                    margin-top: 2px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    user-select: none;
                    -webkit-user-select: none;
                }
                .astrong-cookie-text {
                    font-size: 0.82rem;
                    line-height: 1.45;
                    color: #cac4d0;
                    margin: 0;
                }
                .astrong-cookie-text a {
                    color: #8859ff;
                    text-decoration: underline;
                    text-underline-offset: 3px;
                    transition: color 0.15s ease;
                }
                .astrong-cookie-text a:hover {
                    color: #a782ff;
                }
                .astrong-cookie-actions {
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                }
                .astrong-cookie-btn {
                    background-color: #8859ff;
                    color: #ffffff;
                    border: 1px solid #8859ff;
                    border-radius: 6px;
                    padding: 0.45rem 0.95rem;
                    font-size: 0.82rem;
                    font-weight: 600;
                    font-family: inherit;
                    cursor: pointer;
                    user-select: none;
                    -webkit-user-select: none;
                    transition: background-color 0.15s ease, border-color 0.15s ease;
                    box-shadow: none !important;
                    white-space: nowrap;
                }
                .astrong-cookie-btn:hover {
                    background-color: #7743f5;
                    border-color: #7743f5;
                }
                @media (max-width: 580px) {
                    .astrong-cookie-banner {
                        bottom: 0.75rem;
                        right: 0.75rem;
                        left: 0.75rem;
                        width: auto;
                        flex-direction: column;
                        align-items: stretch;
                        gap: 0.85rem;
                    }
                    .astrong-cookie-actions {
                        justify-content: flex-end;
                    }
                    .astrong-cookie-btn {
                        width: 100%;
                        text-align: center;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        const dismiss = () => {
            setRootCookie(CONSENT_KEY, 'true', 365);
            try { localStorage.setItem(CONSENT_KEY, 'true'); } catch (e) {}
            notice.classList.add('closing');
            setTimeout(() => {
                if (notice && notice.parentNode) notice.parentNode.removeChild(notice);
            }, 260);
        };

        const acceptBtn = notice.querySelector('#astrong-cookie-accept');
        if (acceptBtn) {
            acceptBtn.addEventListener('click', dismiss);
        }

        document.body.appendChild(notice);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initCommandPalette();
            initUniversalHeader();
            initUniversalModals();
            initUniversalFooter();
            initCookieAvatarClip();
            initCookieNotice();
        });
    } else {
        initCommandPalette();
        initUniversalHeader();
        initUniversalModals();
        initUniversalFooter();
        initCookieAvatarClip();
        initCookieNotice();
    }
})();