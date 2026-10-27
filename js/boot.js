// Runs before the page draws. Same as the site: SDC shows script-dependent pieces, like the
// theme toggle, only under html.js. Also applies the saved theme early, so there is no flash.
document.documentElement.classList.add("js");
try { const t = localStorage.getItem("dash-theme"); if (t) document.documentElement.setAttribute("data-theme", t); } catch (e) { /* private mode */ }
// The Adobe Fonts kit from Settings, if one is set, loads before the page draws. app.js keeps
// this copy in step with the saved setting.
try {
  const kit = localStorage.getItem("dash-font-kit");
  if (kit && /^[a-z0-9]{5,12}$/.test(kit)) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `https://use.typekit.net/${kit}.css`; l.id = "font-kit";
    document.head.appendChild(l);
  }
} catch (e) { /* private mode */ }
