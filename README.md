# WxC Manager

Static HTML tool for managing and provisioning **Webex Calling** users and devices. Designed to run on **GitHub Pages** during development. It calls the Webex REST APIs in the browser using a **personal access token**.

The UI uses the [Momentum Design](https://momentum.design/en/) Webex dark-stable tokens (`@momentum-design/tokens`) so it follows the same language as Webex Control Hub.

Personal tokens are for testing only. They expire **12 hours** after you sign in to the Developer Portal. Production apps should use a [Webex Integration and OAuth](https://developer.webex.com/docs/integrations).

## What it can do

- Connect with a personal access token and validate it against `GET /people/me`
- Provision, search, update, and delete users (People API + calling licenses + location)
- Assign primary DID / extension and toggle DND, call waiting, and voicemail
- List devices, add a phone by MAC address, generate an activation code, remove devices
- List / create / delete locations
- List numbers, add numbers to a location, activate / deactivate / remove
- Create calling workspaces and attach devices
- CSV import for users (`email,firstName,lastName,location,extension`)
- API activity log of requests made from this tab

## Get a personal access token

1. Sign in to the [Webex Developer Portal token page](https://developer.webex.com/admin/docs/getting-your-personal-access-token) as an administrator of the org you want to manage.
2. Copy the Bearer token.
3. Open this app, paste the token, and click **Connect**.

You need a **full administrator** or **calling administrator** role. The token is kept in `sessionStorage` for this browser tab only and is sent only to `https://webexapis.com`.

## GitHub Pages

1. Push this repository to GitHub.
2. In the repo: **Settings → Pages**.
3. Source: **Deploy from a branch**, branch **main**, folder **/ (root)**.
4. Staging site: [https://moncovo.github.io/WxCManager/](https://moncovo.github.io/WxCManager/).

After Connect, pick the organization. Users, devices, locations, numbers, and workspaces are requested only when you click **Get**.

Because this is a static site, all API calls are made from the browser. Serve it over HTTPS (Pages) or `http://localhost` — opening `index.html` as `file://` will fail CORS.

## Local preview

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080`.

## API references

- [Webex Admin](https://developer.webex.com/admin/docs/admin)
- [Webex Calling overview](https://developer.webex.com/calling/docs/webex-calling-overview)
- [Provisioning APIs](https://developer.webex.com/admin/docs/api/guides/webex-calling-provisioning-apis)
- [Personal access tokens](https://developer.webex.com/admin/docs/getting-your-personal-access-token)
