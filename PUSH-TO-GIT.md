# Push this project to Git (GitHub)

Run these in **Command Prompt** (cmd). First go to the project folder:

```
cd C:\Users\dnikh\Downloads\equinix\equinix\csv-reader
```

---

## Step 0: Set your Git identity (one-time, if not done before)

Git needs your name and email for commits. Run once (use your real name and the email tied to your GitHub account):

```
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## Step 1: See where Git is pointing

```
git remote -v
```

- If you see a URL (e.g. `https://github.com/yourname/csv-reader.git`) → that’s your remote. Go to **Step 3**.
- If you see nothing or the URL is wrong → do **Step 2** (create repo and connect).

---

## Step 2: Create a new repo on GitHub and connect (only if needed)

1. Open https://github.com/new
2. **Repository name:** e.g. `csv-reader` (or `equinix-csv-reader`)
3. Choose **Public**, leave “Add a README” **unchecked**
4. Click **Create repository**
5. On the new repo page, copy the **HTTPS** URL (e.g. `https://github.com/YOUR_USERNAME/csv-reader.git`)

Then in cmd (still in `csv-reader`):

**If you have no remote yet:**

```
git remote add origin https://github.com/YOUR_USERNAME/csv-reader.git
```

**If you already have `origin` and want to replace it:**

```
git remote set-url origin https://github.com/YOUR_USERNAME/csv-reader.git
```

(Replace `YOUR_USERNAME` and repo name with your real URL.)

---

## Step 3: Add, commit, and push

```
git add -A
git commit -m "Invoice/quote validation, Data Viewer consolidation, Netlify config"
git push -u origin main
```

- First time you push, Windows may open a browser or prompt for GitHub login (or ask for a **Personal Access Token** instead of password).
- If the branch is named `master` instead of `main`, use: `git push -u origin master`

---

## Summary (copy-paste in order)

**1. One-time: set your name and email (if you haven’t):**
```
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

**2. Go to project, then commit and push:**
```
cd C:\Users\dnikh\Downloads\equinix\equinix\csv-reader
git remote -v
git add -A
git commit -m "Invoice/quote validation, Data Viewer consolidation, Netlify config"
git push -u origin main
```

*(Your changes are already staged; you only need to run the config commands if needed, then `git commit` and `git push`.)*

If `git push` asks for login, use your GitHub username and a **Personal Access Token** (Settings → Developer settings → Personal access tokens) as the password.
