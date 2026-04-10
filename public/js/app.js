/**
 * Deckspace — Minimal Client JS
 *
 * Goals:
 *   - Progressive enhancement only — the product works without this
 *   - Improve UX under bad connectivity (retry, pending states, feedback)
 *   - Never block page load or critical text content
 *
 * No framework. Vanilla JS only. Target bundle: < 8KB unminified.
 */

(function () {
  'use strict';

  /* ============================================================
     RETRY-AWARE FORM SUBMISSION
     Forms with data-retry="true" get auto-retry on network failure.
     Shows pending state, clear error, and retry button on failure.
     ============================================================ */
  function initRetryForms() {
    document.querySelectorAll('form[data-retry]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitWithRetry(form);
      });
    });
  }

  function submitWithRetry(form, attempt) {
    attempt = attempt || 1;
    var maxAttempts = 3;
    var data = new FormData(form);
    var method = (form.method || 'POST').toUpperCase();
    var action = form.action || window.location.href;
    var enctype = (form.enctype || '').toLowerCase();
    var isMultipart = enctype === 'multipart/form-data';
    var timeoutId = 0;
    var controller = null;
    var signal;

    if (window.AbortSignal && typeof window.AbortSignal.timeout === 'function') {
      signal = window.AbortSignal.timeout(12000);
    } else if (window.AbortController) {
      controller = new AbortController();
      signal = controller.signal;
      timeoutId = window.setTimeout(function () {
        controller.abort();
      }, 12000);
    }

    // Mark as pending
    setFormPending(form, true);
    clearFormError(form);

    var requestInit = {
      method: method,
      body: method === 'POST'
        ? (isMultipart ? data : new URLSearchParams(data))
        : undefined
    };
    if (!isMultipart && method === 'POST') {
      requestInit.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    }
    if (signal) {
      requestInit.signal = signal;
    }

    fetch(action, requestInit)
      .then(function (res) {
        if (timeoutId) window.clearTimeout(timeoutId);
        if (res.redirected) {
          window.location.href = res.url;
          return;
        }
        if (!res.ok) {
          return res.text().then(function (text) {
            // Parse the response HTML to find the flash/error message.
            // DOMParser handles full HTML documents reliably.
            var msg;
            try {
              var doc = (new DOMParser()).parseFromString(text, 'text/html');
              var el = doc.querySelector('.ds-flash.error, .ds-flash, .error-message');
              if (el) msg = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 300);
            } catch (e) {}
            throw new Error(msg || ('Error ' + res.status + ' — please try again.'));
          });
        }
        // For fragment responses (htmx-style), swap if target specified
        var target = form.dataset.target;
        if (target) {
          return res.text().then(function (html) {
            var el = document.querySelector(target);
            if (el) el.innerHTML = html;
            setFormPending(form, false);
          });
        }
        // Default: reload the page
        window.location.reload();
      })
      .catch(function (err) {
        if (timeoutId) window.clearTimeout(timeoutId);
        setFormPending(form, false);
        var isNetworkErr = (err.name === 'TypeError' || err.name === 'AbortError');
        if (isNetworkErr && attempt < maxAttempts) {
          var delay = Math.pow(2, attempt) * 500; // 1s, 2s, 4s
          showFormRetrying(form, attempt, delay);
          setTimeout(function () {
            submitWithRetry(form, attempt + 1);
          }, delay);
        } else {
          showFormError(form, isNetworkErr
            ? 'Network error — check your connection and try again.'
            : (err.message || 'Something went wrong. Please try again.'));
        }
      });
  }

  function setFormPending(form, pending) {
    var btns = form.querySelectorAll('button[type=submit], input[type=submit]');
    btns.forEach(function (btn) {
      btn.disabled = pending;
      if (pending) {
        btn.dataset.origText = btn.textContent;
        btn.textContent = btn.dataset.loadingText || 'Saving...';
      } else if (btn.dataset.origText) {
        btn.textContent = btn.dataset.origText;
      }
    });
  }

  function clearFormError(form) {
    var el = form.querySelector('.ds-form-error');
    if (el) el.remove();
    var retrying = form.querySelector('.ds-form-retrying');
    if (retrying) retrying.remove();
  }

  function showFormError(form, msg) {
    clearFormError(form);
    var el = document.createElement('div');
    el.className = 'ds-flash error ds-form-error';
    el.innerHTML = msg + ' <a href="#" class="retry-link">Retry</a>';
    el.querySelector('.retry-link').addEventListener('click', function (e) {
      e.preventDefault();
      clearFormError(form);
      submitWithRetry(form);
    });
    form.prepend(el);
  }

  function showFormRetrying(form, attempt, delay) {
    clearFormError(form);
    var el = document.createElement('div');
    el.className = 'ds-retry-block ds-form-retrying';
    el.textContent = 'Connection issue — retrying (' + attempt + '/3)...';
    form.prepend(el);
  }

  /* ============================================================
     PHOTO PREVIEW
     Show a preview of selected image before upload.
     ============================================================ */
  function initPhotoPreview() {
    document.querySelectorAll('input[type=file][data-preview]').forEach(function (input) {
      var targetId = input.dataset.preview;
      var target = document.getElementById(targetId);
      if (!target) return;

      input.addEventListener('change', function () {
        var file = input.files[0];
        if (!file) {
          target.innerHTML = '';
          return;
        }
        if (!file.type.startsWith('image/')) {
          target.textContent = 'Not an image.';
          return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
          target.innerHTML = '';
          var img = document.createElement('img');
          img.src = e.target.result;
          img.style.maxWidth = '120px';
          img.style.maxHeight = '120px';
          img.style.border = '1px solid #ccc';
          target.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }

  /* ============================================================
     PROFILE SONG — tap to play only, never autoplay
     ============================================================ */
  function initSongPlayer() {
    document.querySelectorAll('[data-song-url]').forEach(function (btn) {
      var url = btn.dataset.songUrl;
      if (!url) return;
      var audio = null;

      btn.addEventListener('click', function () {
        if (!audio) {
          audio = new Audio(url);
          audio.addEventListener('ended', function () {
            btn.textContent = '▶ Play';
          });
        }
        if (audio.paused) {
          audio.play().catch(function () {
            btn.textContent = '▶ Play (error)';
          });
          btn.textContent = '⏸ Pause';
        } else {
          audio.pause();
          btn.textContent = '▶ Play';
        }
      });
    });
  }

  /* ============================================================
     FLASH MESSAGE AUTO-DISMISS
     Flash messages with data-dismiss="5000" auto-disappear.
     ============================================================ */
  function initFlashDismiss() {
    document.querySelectorAll('.ds-flash[data-dismiss]').forEach(function (el) {
      var delay = parseInt(el.dataset.dismiss, 10) || 5000;
      setTimeout(function () {
        el.style.transition = 'opacity 0.4s';
        el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 400);
      }, delay);
    });
  }

  /* ============================================================
     CONFIRM ACTIONS
     Buttons/links with data-confirm="Are you sure?" prompt before acting.
     ============================================================ */
  function initConfirmActions() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-confirm]');
      if (!el) return;
      var msg = el.dataset.confirm || 'Are you sure?';
      if (!window.confirm(msg)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  /* ============================================================
     CSRF AUTO-INJECTION
     Reads the meta[name="csrf-token"] and injects a hidden _csrf
     field into every non-multipart form before submission.
     ============================================================ */
  function initCsrf() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (!meta) return;
    var token = meta.getAttribute('content');
    if (!token) return;

    // Inject into already-present forms
    function injectIntoForm(form) {
      if (form.enctype === 'multipart/form-data') return; // file uploads excluded
      if (form.querySelector('input[name="_csrf"]')) return; // already has one
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = '_csrf';
      input.value = token;
      form.appendChild(input);
    }

    document.querySelectorAll('form').forEach(injectIntoForm);

    // Watch for dynamically added forms
    if (window.MutationObserver) {
      var obs = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          m.addedNodes.forEach(function(node) {
            if (node.nodeType !== 1) return;
            if (node.tagName === 'FORM') injectIntoForm(node);
            node.querySelectorAll && node.querySelectorAll('form').forEach(injectIntoForm);
          });
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  /* ============================================================
     MOBILE NAV HAMBURGER
     Toggle #ds-nav-links open/closed on mobile.
     ============================================================ */
  function initNavToggle() {
    var btn = document.getElementById('nav-toggle');
    var links = document.getElementById('ds-nav-links');
    if (!btn || !links) return;

    btn.addEventListener('click', function () {
      var isOpen = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    });

    // Close when a link is tapped
    links.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        links.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#ds-nav-inner')) {
        links.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ============================================================
     MARK NOTIFICATIONS READ
     On notifications page load, ping the read-all endpoint.
     ============================================================ */
  function initNotifRead() {
    var page = document.getElementById('notifications-page');
    if (!page) return;
    var meta = document.querySelector('meta[name="csrf-token"]');
    var token = meta ? meta.getAttribute('content') : '';
    fetch('/notifications/mark-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: token ? new URLSearchParams({ _csrf: token }) : undefined
    })
      .then(function (res) {
        if (!res.ok) return;
        var badge = document.querySelector('.nav-notif-badge');
        if (badge) badge.remove();
      })
      .catch(function () { /* silent — non-critical */ });
  }

  /* ============================================================
     LAZY LOAD IMAGES
     Images with data-src are loaded when they scroll into view.
     Falls back to immediate load if IntersectionObserver unavailable.
     ============================================================ */
  function initLazyImages() {
    var imgs = document.querySelectorAll('img[data-src]');
    if (!imgs.length) return;

    if (!('IntersectionObserver' in window)) {
      imgs.forEach(function (img) { img.src = img.dataset.src; });
      return;
    }

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var img = entry.target;
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          obs.unobserve(img);
        }
      });
    }, { rootMargin: '50px' });

    imgs.forEach(function (img) { obs.observe(img); });
  }

  /* ============================================================
     VIBE TAG INPUT
     Comma-separated tag input with visual chips.
     ============================================================ */
  function initTagInput() {
    document.querySelectorAll('[data-tag-input]').forEach(function (container) {
      var hidden = container.querySelector('input[type=hidden]');
      var text   = container.querySelector('input[type=text]');
      var chips  = container.querySelector('.tag-chips');
      if (!hidden || !text || !chips) return;

      var tags = hidden.value ? hidden.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];

      function renderChips() {
        chips.innerHTML = '';
        tags.forEach(function (tag) {
          var chip = document.createElement('span');
          chip.className = 'vibe-tag';
          chip.style.cursor = 'default';
          chip.innerHTML = tag + ' <button type="button" style="background:none;border:none;cursor:pointer;font-size:10px;color:#666;padding:0 0 0 3px">✕</button>';
          chip.querySelector('button').addEventListener('click', function () {
            tags = tags.filter(function (t) { return t !== tag; });
            hidden.value = tags.join(',');
            renderChips();
          });
          chips.appendChild(chip);
        });
        hidden.value = tags.join(',');
      }

      text.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          var val = text.value.trim().replace(/,/g, '');
          if (val && tags.length < 10 && !tags.includes(val)) {
            tags.push(val);
            renderChips();
          }
          text.value = '';
        }
      });

      renderChips();
    });
  }

  /* ============================================================
     USERNAME VALIDATION
     Live pattern check on [data-validate-username] fields.
     Shows ✓ or a specific error as the user types.
     ============================================================ */
  function initUsernameValidation() {
    var field = document.querySelector('[data-validate-username]');
    if (!field) return;

    var hint = document.createElement('div');
    hint.className = 'username-hint';
    hint.style.display = 'none';
    // Insert after the field (but before any existing .hint div)
    var existingHint = field.parentNode.querySelector('.hint');
    if (existingHint) {
      field.parentNode.insertBefore(hint, existingHint);
    } else {
      field.parentNode.appendChild(hint);
    }

    field.addEventListener('input', function () {
      var val = field.value.trim();
      if (!val) { hint.style.display = 'none'; return; }

      hint.style.display = 'block';
      if (val.length < 3) {
        hint.className = 'username-hint bad';
        hint.textContent = 'At least 3 characters required';
      } else if (/[^a-zA-Z0-9_]/.test(val)) {
        hint.className = 'username-hint bad';
        hint.textContent = 'Letters, numbers, and underscores only (no spaces)';
      } else if (val.length > 30) {
        hint.className = 'username-hint bad';
        hint.textContent = '30 character maximum';
      } else {
        hint.className = 'username-hint ok';
        hint.textContent = '\u2713 Looks good';
      }
    });
  }

  /* ============================================================
     PASSWORD MATCH INDICATOR
     Real-time check: does confirm field match the password field?
     ============================================================ */
  function initPasswordMatch() {
    var src     = document.querySelector('[data-pw-source]');
    var confirm = document.querySelector('[data-pw-confirm]');
    if (!src || !confirm) return;

    var hint = confirm.parentNode.querySelector('.pw-match-hint');
    if (!hint) return;

    function checkMatch() {
      var a = src.value;
      var b = confirm.value;
      if (!b) { hint.style.display = 'none'; return; }

      hint.style.display = 'block';
      if (a === b) {
        hint.className = 'pw-match-hint match';
        hint.textContent = '\u2713 Passwords match';
      } else {
        hint.className = 'pw-match-hint no-match';
        hint.textContent = '\u2717 Passwords do not match';
      }
    }

    confirm.addEventListener('input', checkMatch);
    src.addEventListener('input', checkMatch);
  }

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    initCsrf();
    initRetryForms();
    initPhotoPreview();
    initSongPlayer();
    initFlashDismiss();
    initConfirmActions();
    initNavToggle();
    initNotifRead();
    initLazyImages();
    initTagInput();
    initUsernameValidation();
    initPasswordMatch();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
