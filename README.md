# Fizzy for Gmail

<img src="assets/icon.png" width="64" align="right" alt="Fizzy for Gmail icon">

Turn the email you're reading into a card on your [Fizzy](https://fizzy.do) board, in two clicks, without leaving Gmail.

- Open an email → the Fizzy side panel pre-fills the **title** with the subject.
- Pick a **board** (it remembers your last choice) and an optional **tag**.
- Click **Create Fizzy Card**. The card's description links back to the original email.

It's a small Google Apps Script project (one file, no dependencies). It's free, open source, and runs entirely in **your own Google account**, with no server and no third party in the middle.

> **Unofficial.** This is a community project, not affiliated with or endorsed by 37signals. "Fizzy" is their product and name.

---

## Install (about 5 minutes)

You'll make your own private copy of the add-on. Nobody else can see or use it.

### 1. Create a Fizzy access token

In Fizzy: open your **profile → API → Personal access tokens → Generate new access token**. Choose **Read + Write** permission and copy the token. (You'll paste it into the add-on in step 5.)

### 2. Create the Apps Script project

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Rename it to something like *Fizzy for Gmail*.
3. Open `Code.gs` in the editor, delete everything in it, and paste in the contents of [`Code.gs`](Code.gs) from this repo.

### 3. Add the manifest

1. Click the **⚙ Project Settings** icon (left sidebar).
2. Tick **Show "appsscript.json" manifest file in editor**.
3. Go back to the **Editor**, open `appsscript.json`, delete its contents, and paste in [`appsscript.json`](appsscript.json) from this repo.
4. Save (Ctrl/Cmd + S).

### 4. Install it in your Gmail

1. Click **Deploy → Test deployments**.
2. Click **Install** next to *Gmail*, then **Done**.
3. Reload Gmail.

### 5. Connect Fizzy

1. Open any email and click the Fizzy icon in the right-hand side panel (the first time, you may need to click the little ▸ at the very right edge of Gmail to show the panel).
2. Google will ask you to authorize the add-on. Because it's your own unpublished script, you'll see *"Google hasn't verified this app"*. Click **Advanced → Go to Fizzy for Gmail (unsafe)** and allow. This is expected: you are the author and only user.
3. On the Fizzy settings screen, paste your token and click **Save**. The add-on checks the token with Fizzy and finds your account automatically.

That's it. Open an email and click **Create Fizzy Card**.

---

## Settings

Open **Settings** from the add-on panel at any time.

| Setting | What it does |
|---|---|
| **Fizzy access token** | Your personal access token. Leave blank to keep the saved one. |
| **Fizzy account** | Appears once a token is saved. Lets you switch if your token can access more than one Fizzy account. |
| **Default tag** | Pre-filled on every card. Defaults to `from_email`. Empty means no tag. You can still edit it per card. |
| **Fizzy URL** | Defaults to `https://app.fizzy.do`. Change it only if you self-host Fizzy. |

Everything is stored in your Google account's *user properties* for this script. It's private to you and never written into the code, so it's safe to publish or share your copy of the code.

One thing to know: Gmail add-on forms have no password field, so the token is visible while you paste it. After saving, only its last 4 characters are ever shown.

## Updating

Paste the new `Code.gs` (and `appsscript.json` if it changed) over your copy and save. Test deployments always run the latest saved code; reload Gmail to pick it up.

## Using clasp instead of copy/paste (optional)

If you'd rather use the command line:

```bash
npm install -g @google/clasp
clasp login                       # also enable the Apps Script API at script.google.com/home/usersettings
git clone <this repo> && cd fizzy-gmail-addon
clasp create --type standalone --title "Fizzy for Gmail"
clasp push                        # accept the manifest overwrite prompt
```

Then continue from step 4 above.

## What it can access

The add-on asks for three permissions (see `appsscript.json`):

| Scope | Why |
|---|---|
| `gmail.addons.execute` | Required to run as a Gmail add-on. |
| `gmail.addons.current.message.readonly` | Reads the **currently open** email's subject, sender and link. Only when you open it. |
| `script.external_request` | Talks to Fizzy's API. |

What gets sent to Fizzy when you create a card: the title you typed, the sender's name and address, a link to the email, and the tag. The code never reads the email body.

Your token is sent only to the Fizzy URL you configured. The add-on never logs tokens or response bodies.

## Troubleshooting

| Problem | Fix |
|---|---|
| Fizzy icon doesn't show in Gmail | Make sure step 4 shows it as installed, reload Gmail, and check you're signed in with the same Google account that owns the script. |
| "Fizzy rejected your access token" | Open Settings and paste a fresh token. |
| "This token isn't allowed to do that" | Your token is read-only. Generate one with **Read + Write**. |
| "Couldn't find that account or board" | Open Settings and check the account, then tap **Refresh boards**. |
| A new board isn't in the list | Boards are cached for 5 minutes. Tap **Refresh boards**. |
| "Authorization required" | Open the add-on again and go through the authorization prompt (step 5.2). |
| The email link opens the wrong Gmail account | Gmail permalinks include an account index (`/u/0/`). If you use several accounts at once, links may open under the wrong one. This is a Gmail limitation. |

For anything else, open **Executions** in the Apps Script editor (left sidebar) to see error logs.

## Customizing

- **Description content**: edit the `description` string in `createFizzyCard` in `Code.gs`.
- **Icon**: swap `logoUrl` in `appsscript.json` for any public HTTPS image URL. A ready-made icon is in [`assets/`](assets); if you push your fork to GitHub, the "raw" URL of `assets/icon.png` works.
- **Locking down network access** (optional): add `"urlFetchWhitelist": ["https://app.fizzy.do/"]` to `appsscript.json` (use your own URL if you self-host).

## Limitations

- Built for personal use: each person installs their own copy. It is not published on the Google Workspace Marketplace.
- Works on a single email at a time; it doesn't create cards from whole conversations.
- Cards land wherever Fizzy puts new cards on the board (its default). Choosing a column isn't supported yet.

## Contributing

Issues and pull requests are welcome. The code is a single file with plain section headers. Ideas that would be nice: choose a column, include a snippet of the email, create cards from Gmail's compose view.

## License

[MIT](LICENSE)
