# Install Site Analytics with Claude

You do not need to use Terminal yourself. Claude Code can download the app, start it, and open
it in your browser. You then do the short setup in the app.

## 1. Open Claude Code

Use any of these:

- The **Claude desktop app**, in the **Code** tab.
- **Claude Code in Terminal:** open Terminal and type `claude`.
- **Claude Code in VS Code or Cursor,** from the Claude panel.

If you do not have Claude Code yet, see [claude.com/claude-code](https://claude.com/claude-code).

## 2. Paste this prompt

```text
Install the Site Analytics app for me from https://github.com/vandy1690/site-analytics.

1. Check that Node.js 20 or later is installed (node -v). If it is missing or older, tell me how to install the LTS version from nodejs.org, and wait for me.
2. Put the app in a folder named site-analytics in my home folder. Use git clone if git is installed. Otherwise download the ZIP of the main branch and unzip it there.
3. Read README.md and CLAUDE.md in that folder before doing anything else.
4. Start the app with "node server.mjs" from that folder, and open http://localhost:4340/ in my browser.
5. Ask me if the app should start on its own when I log in. Only if I say yes, run "scripts/login-item.sh install" (Mac only). If I say no, tell me the command to start it again later.
6. Then stop. The app walks me through the rest of the setup itself. Do not create Google Cloud projects, keys or accounts for me, and do not open, copy or change anything in the store or config folders.
```

Claude asks before it runs each command, unless you have told it not to. Read each one and
approve it.

## 3. What happens next

1. Your browser opens the app on its first-run setup: your name and city, the jobs you want, and
   your websites.
2. The last step opens Settings, where seven short steps connect your Google Analytics. Each step
   has a button that opens the right Google page and tells you what to click.
3. Add the jobs you applied to under **Applications**. Paste a job link and the details fill in.

## What Claude does and does not do

It does:

- Check for Node.js and tell you how to get it if it is missing.
- Download the app and start it.
- Set it to start at login, only if you say yes.

It does not:

- Sign in to Google for you, or make Google Cloud projects, robot accounts or keys. Those belong
  to you, so you make them in the app's setup.
- Look at your data. Your applications, contacts and Google key stay in the app's `store` and
  `config` folders.
- Send anything to anyone. The app writes outreach notes; you send them yourself.

## Later

- **Start it again:** in Terminal, `cd ~/site-analytics && node server.mjs`, or ask Claude to
  "start Site Analytics".
- **Update it:** ask Claude to "update Site Analytics with git pull and restart it".
- **Try the demo:** ask Claude to "run the Site Analytics demo", then open
  [http://localhost:4341/](http://localhost:4341/).
