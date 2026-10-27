// Runs before the page draws. Same as the site: SDC shows script-dependent pieces, like the
// theme toggle, only under html.js. Also applies the saved theme early, so there is no flash.
document.documentElement.classList.add("js");
try { const t = localStorage.getItem("dash-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) { /* private mode */ }
