/* Finestyle Speisekarten – kleine Helfer auf der Webseite (ohne jQuery) */
(function () {
  'use strict';

  // Allergene/Zusatzstoffe: Antippen zeigt die Erklärung
  function closeAll(except) {
    document.querySelectorAll('.fs-sk__sup--info.is-open').forEach(function (s) {
      if (s !== except) { s.classList.remove('is-open'); s.querySelector('.fs-sk__code').setAttribute('aria-expanded', 'false'); }
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.fs-sk__code') : null;
    if (!btn) { closeAll(null); return; }
    e.preventDefault();
    var sup = btn.parentNode;
    var open = !sup.classList.contains('is-open');
    closeAll(sup);
    sup.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var tip = sup.querySelector('.fs-sk__tip');
      tip.style.left = '';
      var r = tip.getBoundingClientRect();
      var over = r.right - (document.documentElement.clientWidth - 8);
      if (over > 0) tip.style.left = (-over) + 'px';
      if (r.left - (over > 0 ? over : 0) < 8) tip.style.left = (8 - r.left) + 'px';
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });

  // Alle Bereiche öffnen/schließen
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('.fs-sk__toggle') : null;
    if (!t) return;
    var box = t.closest('.fs-sk');
    var list = box.querySelectorAll('details.fs-sk__section');
    var anyClosed = Array.prototype.some.call(list, function (d) { return !d.open; });
    list.forEach(function (d) { d.open = anyClosed; });
    t.dataset.state = anyClosed ? 'close' : 'open';
    toggleText(t);
  });
  function toggleText(t) {
    var en = t.closest('.fs-sk').classList.contains('fs-sk--en');
    var key = 'data-' + (t.dataset.state || 'open') + (en ? '-en' : '');
    t.textContent = t.getAttribute(key) || t.getAttribute('data-' + (t.dataset.state || 'open'));
  }

  // Sprache umschalten (Flagge)
  var LS = 'fs_sk_lang';
  function setLang(box, en) {
    box.classList.toggle('fs-sk--en', en);
    var b = box.querySelector('.fs-sk__lang');
    if (b) b.setAttribute('aria-pressed', en ? 'true' : 'false');
    var t = box.querySelector('.fs-sk__toggle');
    if (t) toggleText(t);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.fs-sk__lang') : null;
    if (!b) return;
    var box = b.closest('.fs-sk');
    var en = !box.classList.contains('fs-sk--en');
    document.querySelectorAll('.fs-sk').forEach(function (x) { if (x.querySelector('.fs-sk__lang')) setLang(x, en); });
    try { localStorage.setItem(LS, en ? 'en' : 'de'); } catch (err) {}
  });
  function initLang() {
    var pref = null;
    try { pref = localStorage.getItem(LS); } catch (err) {}
    // Gäste mit nicht-deutschem Browser sehen direkt Englisch
    var en = pref ? pref === 'en' : !/^de\b/i.test(navigator.language || 'de');
    if (en) document.querySelectorAll('.fs-sk').forEach(function (x) { if (x.querySelector('.fs-sk__lang')) setLang(x, true); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initLang); else initLang();

  // Sprungmarke (#fs-sk-…) öffnet den Bereich
  function openHash() {
    if (!location.hash || location.hash.indexOf('#fs-sk-') !== 0) return;
    var el = document.getElementById(location.hash.slice(1));
    if (el && el.tagName === 'DETAILS') { el.open = true; el.scrollIntoView({ block: 'start' }); }
  }
  window.addEventListener('hashchange', openHash);
  document.addEventListener('DOMContentLoaded', openHash);
})();
