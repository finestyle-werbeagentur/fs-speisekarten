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
    t.textContent = anyClosed ? t.getAttribute('data-close') : t.getAttribute('data-open');
  });

  // Sprungmarke (#fs-sk-…) öffnet den Bereich
  function openHash() {
    if (!location.hash || location.hash.indexOf('#fs-sk-') !== 0) return;
    var el = document.getElementById(location.hash.slice(1));
    if (el && el.tagName === 'DETAILS') { el.open = true; el.scrollIntoView({ block: 'start' }); }
  }
  window.addEventListener('hashchange', openHash);
  document.addEventListener('DOMContentLoaded', openHash);
})();
