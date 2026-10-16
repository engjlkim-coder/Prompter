(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const video = $('video');
  const statusEl = $('status');
  const btnStart = $('btnStart');
  const btnStop = $('btnStop');
  const btnFsHere = $('btnFsHere');
  const btnFsOther = $('btnFsOther');
  const btnInstall = $('btnInstall');
  const chkH = $('flipH');
  const chkV = $('flipV');
  const selFit = $('fit');
  const chkFps = $('fps60');

  // ---------- 설정 저장/복원 ----------
  const KEY = 'mirror-pwa-settings-v1';
  const FITS = ['contain', 'cover', 'fill'];
  const defaults = { flipH: true, flipV: false, fit: 'contain', fps60: true };
  let settings = { ...defaults };
  try {
    settings = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (_) { /* 저장소 사용 불가 시 기본값 */ }

  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) {}
  }

  function applySettings() {
    stage.style.setProperty('--fx', settings.flipH ? -1 : 1);
    stage.style.setProperty('--fy', settings.flipV ? -1 : 1);
    video.style.objectFit = settings.fit;
    chkH.checked = settings.flipH;
    chkV.checked = settings.flipV;
    selFit.value = settings.fit;
    chkFps.checked = settings.fps60;
  }

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  // ---------- 화면 캡처 ----------
  let stream = null;

  async function startCapture() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setStatus('이 브라우저는 화면 캡처를 지원하지 않습니다. 데스크톱 Chrome/Edge를 사용하세요.', true);
      return;
    }
    stopCapture(true);

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: settings.fps60 ? 60 : 30 },
          cursor: 'always',
        },
        audio: false,
        // 아래 옵션은 지원 브라우저에서만 적용됩니다.
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      });
    } catch (e) {
      stream = null;
      setStatus(
        e.name === 'NotAllowedError' ? '화면 선택이 취소되었거나 권한이 거부되었습니다.' : `캡처 실패: ${e.message}`,
        true
      );
      return;
    }

    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => stopCapture());
    video.srcObject = stream;
    try { await video.play(); } catch (_) {}

    const s = track.getSettings();
    document.body.classList.add('live');
    btnStart.hidden = true;
    btnStop.hidden = false;

    let msg = `송출 중 · ${s.width || '?'}×${s.height || '?'} @ ${Math.round(s.frameRate || 0)}fps`;
    if (s.displaySurface && s.displaySurface !== 'monitor') {
      msg += ' · ⚠ 전체 화면(모니터)이 아닌 창/탭을 선택하셨습니다';
    }
    setStatus(msg);

    requestWakeLock();
    wake();
  }

  function stopCapture(silent = false) {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    document.body.classList.remove('live', 'idle');
    btnStart.hidden = false;
    btnStop.hidden = true;
    releaseWakeLock();
    if (!silent) setStatus('중지됨');
  }

  // ---------- 화면 꺼짐 방지 ----------
  let wakeLock = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) {}
  }

  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (_) {}
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && stream) requestWakeLock();
  });

  // ---------- 전체화면 ----------
  async function toggleFullscreenHere() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (e) {
      setStatus(`전체화면 실패: ${e.message}`, true);
    }
  }

  let otherIndex = 0;

  async function fullscreenOnOtherMonitor() {
    if (!('getScreenDetails' in window)) {
      setStatus('이 브라우저는 모니터 선택을 지원하지 않습니다. 창을 모니터2로 옮긴 뒤 "현재 화면 전체화면"을 사용하세요.', true);
      return;
    }
    try {
      const details = await window.getScreenDetails();
      const others = details.screens.filter((s) => !s.isPrimary);
      const candidates = others.length ? others : details.screens.filter((s) => s !== details.currentScreen);
      if (!candidates.length) {
        setStatus('다른 모니터를 찾지 못했습니다. 디스플레이가 "확장" 모드인지 확인하세요.', true);
        return;
      }
      const target = candidates[otherIndex % candidates.length];
      otherIndex += 1; // 모니터가 3개 이상이면 누를 때마다 순환
      await document.documentElement.requestFullscreen({ screen: target, navigationUI: 'hide' });
    } catch (e) {
      setStatus(
        e.name === 'NotAllowedError'
          ? '모니터 접근 권한이 거부되었습니다. 주소창 자물쇠에서 "창 관리" 권한을 허용하세요.'
          : `전체화면 실패: ${e.message}`,
        true
      );
    }
  }

  // ---------- 패널 자동 숨김 ----------
  let idleTimer = null;

  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (stream) {
      idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
    }
  }

  ['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach((ev) =>
    window.addEventListener(ev, wake, { passive: true })
  );

  // ---------- UI 이벤트 ----------
  btnStart.addEventListener('click', startCapture);
  btnStop.addEventListener('click', () => stopCapture());
  btnFsHere.addEventListener('click', toggleFullscreenHere);
  btnFsOther.addEventListener('click', fullscreenOnOtherMonitor);
  stage.addEventListener('dblclick', toggleFullscreenHere);

  chkH.addEventListener('change', () => { settings.flipH = chkH.checked; applySettings(); saveSettings(); });
  chkV.addEventListener('change', () => { settings.flipV = chkV.checked; applySettings(); saveSettings(); });
  selFit.addEventListener('change', () => { settings.fit = selFit.value; applySettings(); saveSettings(); });
  chkFps.addEventListener('change', () => { settings.fps60 = chkFps.checked; saveSettings(); });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    switch (e.key.toLowerCase()) {
      case 'h': settings.flipH = !settings.flipH; break;
      case 'v': settings.flipV = !settings.flipV; break;
      case 'o': settings.fit = FITS[(FITS.indexOf(settings.fit) + 1) % FITS.length]; break;
      case 'f': toggleFullscreenHere(); return;
      case 'm': fullscreenOnOtherMonitor(); return;
      case 'c': startCapture(); return;
      case 'x': stopCapture(); return;
      case 't': document.body.classList.toggle('idle'); return;
      default: return;
    }
    applySettings();
    saveSettings();
  });

  // ---------- PWA 설치 / 서비스 워커 ----------
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btnInstall.hidden = false;
  });

  btnInstall.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btnInstall.hidden = true;
  });

  window.addEventListener('appinstalled', () => { btnInstall.hidden = true; });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  applySettings();
})();
