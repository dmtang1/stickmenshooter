# Stick Royale

A minimalist stickman battle royale you can host for free. One friend’s browser is the server. Everyone else connects peer-to-peer. No paid game server.

## Play locally

```bash
npm install
npm run dev
```

Open the printed local URL. Click the game view to lock the mouse.

## Play with friends (no hosting bill)

1. Deploy the static build to any free host (GitHub Pages, Cloudflare Pages, Netlify, itch.io).
2. You click **Host Match** and share the 6-character room code.
3. Friends open the same site, click **Join Friend**, and enter the code.
4. Keep the host tab open for the whole match. If the host leaves, the room dies.

```bash
npm run build
```

Upload the `dist/` folder, or from the repo on GitHub: Settings → Pages → deploy from GitHub Actions / `dist`.

Because this uses WebRTC, the site must be served over HTTPS (all of the free hosts above do that). Same-wifi friends always work. Most home internet connections work via free STUN. Strict school/office firewalls may block P2P.

## Controls

- **WASD** move, **Shift** sprint, **Space** jump / slow fall while dropping
- **Mouse** look, **Click** shoot or place a build, **Right-click** aim (zoom)
- **Q** wall, **Z** floor, **C** ramp, **B** toggle build mode
- **R** reload, **Esc** pause / release mouse

Shoot trees for wood. Walk over floating stick guns to pick them up. Stay inside the purple storm ring. Last stick standing wins.
